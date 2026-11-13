import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { FlagsService } from '../flags/flags.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';

/** fetch used for upstream free services (replaced in tests: the test environment has no internet). */
export const SERVICES_FETCH = Symbol('SERVICES_FETCH');
export const servicesFetchProvider = { provide: SERVICES_FETCH, useValue: (...a: Parameters<typeof fetch>) => fetch(...a) };

const FRANKFURTER = 'https://api.frankfurter.dev/v1';
const RATES_TTL_MS = 60 * 60_000; // ECB publishes once a working day; an hour keeps us well inside fair use
const CURRENCY = /^[A-Z]{3}$/;
/** Region codes that are not countries or are retired/reserved (Intl still names some of them). Kosovo (XK) is kept. */
const NOT_COUNTRIES = new Set('EU EZ QO UN XA XB ZZ AN BU CS DD FX NT SU TP YU ZR DY HV NH RH VD YD PZ PU PC MI JT WK NQ AC CP CQ DG EA IC TA UK CT FQ'.split(' '));
const MET = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const WEATHER_MAX_UPSTREAM_PER_SEC = 10; // MET Norway asks for < 20 requests/s in total
const WEATHER_CACHE_MAX = 5000;
const WEATHER_STALE_MAX_MS = 6 * 60 * 60_000;
const HOUR = 3_600_000;
const ATTRIBUTION = { text: 'Based on data from MET Norway', licence: 'CC BY 4.0', licenceUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: 'https://api.met.no/' };
type MetEntry = { time: string; data: { instant?: { details?: Record<string, number> }; next_1_hours?: MetPeriod; next_6_hours?: MetPeriod; next_12_hours?: MetPeriod } };
type MetPeriod = { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
type MetDoc = { properties: { meta: { updated_at: string }; timeseries: MetEntry[] } };
const WEATHER_WORDS: Record<string, [string, string]> = { clearsky: ['Clear sky', '☀️'], fair: ['Fair', '🌤️'], partlycloudy: ['Partly cloudy', '⛅'], cloudy: ['Cloudy', '☁️'], fog: ['Fog', '🌫️'] };
/** Plain-English summary and emoji for a MET Norway symbol code such as "lightrainshowers_day" or "heavysnowandthunder". */
export function describeSymbol(code?: string): { symbol: string | null; summary: string | null; emoji: string | null } {
  if (!code) return { symbol: null, summary: null, emoji: null };
  const base = code.replace(/_(day|night|polartwilight)$/, '');
  const thunder = base.endsWith('andthunder');
  const core = thunder ? base.slice(0, -'andthunder'.length) : base;
  const known = WEATHER_WORDS[core];
  if (known) return { symbol: code, summary: known[0], emoji: known[1] };
  const m = /^(light|heavy)?(rain|sleet|snow)(showers)?$/.exec(core);
  if (!m) return { symbol: code, summary: null, emoji: null };
  const words = [m[1], m[2], m[3]].filter(Boolean).join(' ');
  const summary = words[0]!.toUpperCase() + words.slice(1) + (thunder ? ' and thunder' : '');
  return { symbol: code, summary, emoji: thunder ? '⛈️' : m[2] === 'snow' ? '🌨️' : m[2] === 'sleet' ? '🌨️' : m[3] ? '🌦️' : '🌧️' };
}
const flag = (code: string) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

/**
 * Free services that generated full-stack apps can use through the `App` SDK, proxied by the platform so apps never
 * need keys or network access of their own. Only sources whose terms allow commercial use are included:
 * exchange rates from Frankfurter (European Central Bank reference rates, free, no key) and country data built
 * from the runtime's own locale data (no upstream at all).
 */
@Injectable()
export class AppServicesService {
  private readonly rates = new Map<string, { at: number; value: { base: string; date: string; rates: Record<string, number> } }>();
  private readonly countryCache = new Map<string, { code: string; name: string; flag: string }[]>();

  private readonly forecasts = new Map<string, { expires: number; fetchedAt: number; lastModified: string | null; doc: MetDoc }>();
  private readonly inflight = new Map<string, Promise<{ expires: number; fetchedAt: number; lastModified: string | null; doc: MetDoc }>>();
  private upstreamCalls: number[] = [];

  constructor(
    @Inject(SERVICES_FETCH) private readonly f: typeof fetch,
    @Inject(FlagsService) private readonly flags: FlagsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** MET Norway requires a User-Agent naming the app and a real contact (website or email); fake ones get banned. */
  private weatherIdentity(): string | null {
    const contact = this.config.WEATHER_CONTACT?.trim();
    if (contact) return contact;
    try {
      const u = new URL(this.config.WEB_APP_URL);
      if (u.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) return u.origin;
    } catch { /* fall through */ }
    return null;
  }

  /**
   * Forecast for a location from MET Norway (free, CC BY 4.0, commercial use allowed with credit). Coordinates are
   * rounded to 2 decimals (about 1 km) so nearby users share one cached forecast and exact end-user locations are
   * never sent upstream. Follows MET's terms: identifying User-Agent, cache until Expires, If-Modified-Since,
   * and a per-instance upstream ceiling well below their 20 requests/s.
   */
  async weather(latIn: number, lonIn: number, timezone = 'UTC') {
    await this.enabled();
    if (!Number.isFinite(latIn) || !Number.isFinite(lonIn) || Math.abs(latIn) > 90 || Math.abs(lonIn) > 180) {
      throw new BadRequestException({ message: 'Use latitude between -90 and 90 and longitude between -180 and 180.', code: 'invalid_location' });
    }
    let dateOf: Intl.DateTimeFormat;
    try { dateOf = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }); } catch {
      throw new BadRequestException({ message: 'Use a time zone such as Asia/Kolkata or Europe/London.', code: 'invalid_timezone' });
    }
    const identity = this.weatherIdentity();
    if (!identity) throw new HttpException({ message: "Weather isn't set up on this platform yet.", code: 'service_not_configured' }, HttpStatus.SERVICE_UNAVAILABLE);
    const lat = Math.round(latIn * 100) / 100;
    const lon = Math.round(lonIn * 100) / 100;
    const entry = await this.forecast(`${lat},${lon}`, lat, lon, identity);
    return this.shapeForecast(entry.doc, lat, lon, timezone, dateOf);
  }

  private async forecast(key: string, lat: number, lon: number, identity: string) {
    const hit = this.forecasts.get(key);
    if (hit && Date.now() < hit.expires) return hit;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const unavailable = () => {
      if (hit && Date.now() - hit.fetchedAt < WEATHER_STALE_MAX_MS) return hit;
      throw new HttpException({ message: 'Weather is unavailable right now. Try again soon.', code: 'service_unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
    };
    const now = Date.now();
    this.upstreamCalls = this.upstreamCalls.filter((t) => now - t < 1000);
    if (this.upstreamCalls.length >= WEATHER_MAX_UPSTREAM_PER_SEC) return unavailable();
    this.upstreamCalls.push(now);
    const run = (async () => {
      let res: Response;
      try {
        res = await this.f(`${MET}?lat=${lat}&lon=${lon}`, {
          headers: { 'User-Agent': `MakeYourAppAI/1.0 ${identity}`, Accept: 'application/json', ...(hit?.lastModified ? { 'If-Modified-Since': hit.lastModified } : {}) },
          signal: AbortSignal.timeout(8000),
        });
      } catch { return unavailable(); }
      const expiresAt = Date.parse(res.headers.get('expires') ?? '');
      const expires = Number.isFinite(expiresAt) && expiresAt > Date.now() ? expiresAt : Date.now() + 30 * 60_000;
      if (res.status === 304 && hit) {
        const next = { ...hit, expires, fetchedAt: Date.now() };
        this.store(key, next);
        return next;
      }
      const doc = (await res.json().catch(() => null)) as MetDoc | null;
      if (!res.ok || !Array.isArray(doc?.properties?.timeseries) || !doc.properties.timeseries.length) return unavailable();
      const next = { expires, fetchedAt: Date.now(), lastModified: res.headers.get('last-modified'), doc };
      this.store(key, next);
      return next;
    })();
    this.inflight.set(key, run);
    try { return await run; } finally { this.inflight.delete(key); }
  }

  private store(key: string, v: { expires: number; fetchedAt: number; lastModified: string | null; doc: MetDoc }) {
    this.forecasts.delete(key);
    this.forecasts.set(key, v);
    while (this.forecasts.size > WEATHER_CACHE_MAX) this.forecasts.delete(this.forecasts.keys().next().value!);
  }

  private shapeForecast(doc: MetDoc, latitude: number, longitude: number, timezone: string, fmt: Intl.DateTimeFormat) {
    const local = (iso: string) => {
      const p = Object.fromEntries(fmt.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
      return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
    };
    const now = Date.now();
    const series = doc.properties.timeseries.filter((e) => Date.parse(e.time) > now - HOUR);
    const all = series.length ? series : doc.properties.timeseries.slice(-1);
    const step = (i: number) => (i + 1 < all.length ? Date.parse(all[i + 1]!.time) - Date.parse(all[i]!.time) : 0);
    const point = (e: MetEntry) => {
      const d = e.data.instant?.details ?? {};
      const p = e.data.next_1_hours ?? e.data.next_6_hours ?? e.data.next_12_hours;
      return { temperature: d.air_temperature ?? null, ...describeSymbol(p?.summary?.symbol_code) };
    };
    const first = all[0]!;
    const fd = first.data.instant?.details ?? {};
    const current = {
      time: first.time, ...point(first),
      humidity: fd.relative_humidity ?? null, windSpeed: fd.wind_speed ?? null, windDirection: fd.wind_from_direction ?? null,
      cloudCover: fd.cloud_area_fraction ?? null, precipitationNextHour: first.data.next_1_hours?.details?.precipitation_amount ?? null,
    };
    const hourly = all.filter((_, i) => step(i) === HOUR || (i > 0 && step(i - 1) === HOUR && step(i) === 0)).slice(0, 24)
      .map((e) => ({ time: e.time, ...point(e), precipitation: e.data.next_1_hours?.details?.precipitation_amount ?? null }));
    const days = new Map<string, { min: number; max: number; precipitation: number; noon: { dist: number; code?: string } }>();
    all.forEach((e, i) => {
      const { date, hour } = local(e.time);
      const day = days.get(date) ?? { min: Infinity, max: -Infinity, precipitation: 0, noon: { dist: 99 } };
      const t = e.data.instant?.details?.air_temperature;
      if (typeof t === 'number') { day.min = Math.min(day.min, t); day.max = Math.max(day.max, t); }
      const s = step(i);
      const amount = s === HOUR ? e.data.next_1_hours?.details?.precipitation_amount : s === 6 * HOUR ? e.data.next_6_hours?.details?.precipitation_amount : undefined;
      if (typeof amount === 'number') day.precipitation += amount;
      const code = (e.data.next_6_hours ?? e.data.next_1_hours)?.summary?.symbol_code;
      if (code && Math.abs(hour - 12) < day.noon.dist) day.noon = { dist: Math.abs(hour - 12), code };
      days.set(date, day);
    });
    const daily = [...days.entries()].filter(([, d]) => Number.isFinite(d.min)).slice(0, 7)
      .map(([date, d]) => ({ date, min: d.min, max: d.max, precipitation: Math.round(d.precipitation * 10) / 10, ...describeSymbol(d.noon.code) }));
    return {
      latitude, longitude, timezone, updatedAt: doc.properties.meta?.updated_at ?? null,
      units: { temperature: '°C', windSpeed: 'm/s', precipitation: 'mm', humidity: '%', cloudCover: '%' },
      current, hourly, daily, attribution: ATTRIBUTION,
    };
  }

  private async enabled() {
    if (!(await this.flags.isEnabled('app_services'))) throw new HttpException({ message: 'This service is temporarily turned off.', code: 'feature_disabled' }, HttpStatus.SERVICE_UNAVAILABLE);
  }

  /** Latest ECB reference rates for a base currency (all of them, filtered after caching so one upstream call serves every app). */
  async latestRates(base: string, symbols?: string[]) {
    await this.enabled();
    base = base.toUpperCase();
    if (!CURRENCY.test(base)) throw new BadRequestException({ message: 'Use a 3-letter currency code such as USD or INR.', code: 'invalid_currency' });
    const wanted = (symbols ?? []).map((s) => s.toUpperCase());
    if (wanted.some((s) => !CURRENCY.test(s)) || wanted.length > 40) throw new BadRequestException({ message: 'Use 3-letter currency codes such as EUR,GBP.', code: 'invalid_currency' });
    let hit = this.rates.get(base);
    if (!hit || Date.now() - hit.at > RATES_TTL_MS) {
      let res: Response;
      try {
        res = await this.f(`${FRANKFURTER}/latest?base=${base}`, { signal: AbortSignal.timeout(8000) });
      } catch {
        if (hit) return this.pick(hit.value, wanted); // stale is better than nothing for daily rates
        throw new HttpException({ message: 'Exchange rates are unavailable right now. Try again soon.', code: 'service_unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
      }
      if (res.status === 404 || res.status === 422) throw new BadRequestException({ message: `${base} is not a supported currency.`, code: 'unsupported_currency' });
      const j = (await res.json().catch(() => null)) as { base?: string; date?: string; rates?: Record<string, number> } | null;
      if (!res.ok || !j?.rates || typeof j.date !== 'string') {
        if (hit) return this.pick(hit.value, wanted);
        throw new HttpException({ message: 'Exchange rates are unavailable right now. Try again soon.', code: 'service_unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
      }
      hit = { at: Date.now(), value: { base, date: j.date, rates: Object.fromEntries(Object.entries(j.rates).filter(([k, v]) => CURRENCY.test(k) && typeof v === 'number' && Number.isFinite(v))) } };
      this.rates.set(base, hit);
    }
    return this.pick(hit.value, wanted);
  }

  private pick(v: { base: string; date: string; rates: Record<string, number> }, wanted: string[]) {
    const unknown = wanted.filter((s) => s !== v.base && !(s in v.rates));
    if (unknown.length) throw new BadRequestException({ message: `Not supported: ${unknown.join(', ')}.`, code: 'unsupported_currency' });
    const rates = wanted.length ? Object.fromEntries(wanted.map((s) => [s, s === v.base ? 1 : v.rates[s]!])) : v.rates;
    return { base: v.base, date: v.date, rates, source: 'European Central Bank reference rates (via Frankfurter), updated each working day' };
  }

  /** Every country with its ISO code, name in the requested language and flag emoji, from built-in locale data. */
  async countries(lang = 'en') {
    await this.enabled();
    let locale: string;
    try { locale = Intl.getCanonicalLocales(lang)[0] ?? 'en'; } catch { throw new BadRequestException({ message: 'Use a language code such as en, hi or fr.', code: 'invalid_language' }); }
    const cached = this.countryCache.get(locale);
    if (cached) return cached;
    const dn = new Intl.DisplayNames([locale, 'en'], { type: 'region', fallback: 'none' });
    const out: { code: string; name: string; flag: string }[] = [];
    for (let a = 65; a < 91; a++) for (let b = 65; b < 91; b++) {
      const code = String.fromCharCode(a, b);
      if (NOT_COUNTRIES.has(code)) continue;
      const name = dn.of(code);
      if (name) out.push({ code, name, flag: flag(code) });
    }
    out.sort((x, y) => x.name.localeCompare(y.name, locale));
    if (this.countryCache.size < 50) this.countryCache.set(locale, out);
    return out;
  }
}
