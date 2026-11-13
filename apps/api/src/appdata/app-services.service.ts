import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { FlagsService } from '../flags/flags.service.js';

/** fetch used for upstream free services (replaced in tests: the test environment has no internet). */
export const SERVICES_FETCH = Symbol('SERVICES_FETCH');
export const servicesFetchProvider = { provide: SERVICES_FETCH, useValue: (...a: Parameters<typeof fetch>) => fetch(...a) };

const FRANKFURTER = 'https://api.frankfurter.dev/v1';
const RATES_TTL_MS = 60 * 60_000; // ECB publishes once a working day; an hour keeps us well inside fair use
const CURRENCY = /^[A-Z]{3}$/;
/** Region codes that are not countries or are retired/reserved (Intl still names some of them). Kosovo (XK) is kept. */
const NOT_COUNTRIES = new Set('EU EZ QO UN XA XB ZZ AN BU CS DD FX NT SU TP YU ZR DY HV NH RH VD YD PZ PU PC MI JT WK NQ AC CP CQ DG EA IC TA UK CT FQ'.split(' '));
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

  constructor(@Inject(SERVICES_FETCH) private readonly f: typeof fetch, @Inject(FlagsService) private readonly flags: FlagsService) {}

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
