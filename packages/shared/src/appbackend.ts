import { z } from 'zod';

/**
 * Built-in backend for generated apps. The app declares its data and access rules in `app.backend.json`; the platform
 * serves them (database, end-user accounts, permissions). Generated code never runs on our servers: it talks to the
 * platform through the small `App` SDK injected into the page.
 */
export const APP_BACKEND_FILE = 'app.backend.json';
export const APP_RECORD_MAX_BYTES = 16_384;
const RESERVED = new Set(['id', 'createdat', 'updatedat', 'mine', 'owner', 'ownerid', '__proto__', 'constructor', 'prototype']);

const FieldSchema = z.object({
  type: z.enum(['string', 'text', 'number', 'boolean', 'date', 'email', 'enum']),
  required: z.boolean().optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().positive().optional(),
  values: z.array(z.string().min(1).max(60)).min(1).max(30).optional(),
}).strict().superRefine((f, ctx) => {
  if (f.type === 'enum' && !f.values) ctx.addIssue({ code: 'custom', message: 'An enum field needs "values".' });
  if (f.type !== 'enum' && f.values) ctx.addIssue({ code: 'custom', message: '"values" is only for enum fields.' });
});
export type AppField = z.infer<typeof FieldSchema>;

const name = (what: string) => z.string().regex(/^[a-z][a-zA-Z0-9_]{0,39}$/, `${what} names start with a lowercase letter and use letters, digits or _ (max 40).`);

const CollectionSchema = z.object({
  fields: z.record(name('Field'), FieldSchema).refine((f) => Object.keys(f).length >= 1 && Object.keys(f).length <= 40, 'A collection needs 1–40 fields.')
    .refine((f) => Object.keys(f).every((k) => !RESERVED.has(k.toLowerCase())), `Field names can't be ${[...RESERVED].slice(0, 6).join(', ')} (they are added automatically).`),
  access: z.object({
    /** Who can read records: anyone, any signed-in user, or only the user who created the record. */
    read: z.enum(['public', 'users', 'owner']),
    /** Who can create records. */
    create: z.enum(['public', 'users']),
    /** Who can edit or delete a record: the user who created it, or nobody. */
    modify: z.enum(['owner', 'none']),
  }).strict(),
}).strict();

export const AppBackendSchema = z.object({
  auth: z.object({ enabled: z.boolean() }).strict(),
  collections: z.record(name('Collection'), CollectionSchema).refine((c) => Object.keys(c).length <= 20, 'At most 20 collections.'),
}).strict().superRefine((b, ctx) => {
  for (const [cname, c] of Object.entries(b.collections)) {
    const needsUsers = c.access.read !== 'public' || c.access.create === 'users' || c.access.modify === 'owner';
    if (needsUsers && !b.auth.enabled) ctx.addIssue({ code: 'custom', path: ['collections', cname, 'access'], message: `"${cname}" needs signed-in users, so set "auth": { "enabled": true }.` });
  }
});
export type AppBackend = z.infer<typeof AppBackendSchema>;

export function parseAppBackend(raw: string): { ok: true; backend: AppBackend } | { ok: false; errors: string[] } {
  let json: unknown;
  try { json = JSON.parse(raw); } catch (e) { return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}`] }; }
  const r = AppBackendSchema.safeParse(json);
  if (r.success) return { ok: true, backend: r.data };
  return { ok: false, errors: r.error.issues.slice(0, 10).map((i) => `${i.path.join('.') || 'file'}: ${i.message}`) };
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** Validates a record body against its collection. `partial` is used for updates (required fields may be omitted). */
export function validateAppRecord(fields: Record<string, AppField>, input: unknown, partial: boolean): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Send the record as a JSON object.' };
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const f = fields[k];
    if (!f) return { ok: false, error: `Unknown field "${k}".` };
    if (v === null || v === undefined || v === '') {
      if (f.required) return { ok: false, error: `"${k}" is required.` };
      data[k] = null;
      continue;
    }
    switch (f.type) {
      case 'string': case 'text': {
        if (typeof v !== 'string') return { ok: false, error: `"${k}" must be text.` };
        const max = f.max ?? (f.type === 'string' ? 200 : 5000);
        if (v.length > max) return { ok: false, error: `"${k}" can be at most ${max} characters.` };
        if (f.min !== undefined && v.length < f.min) return { ok: false, error: `"${k}" needs at least ${f.min} characters.` };
        data[k] = v;
        break;
      }
      case 'email':
        if (typeof v !== 'string' || !EMAIL.test(v) || v.length > 254) return { ok: false, error: `"${k}" must be an email address.` };
        data[k] = v.trim();
        break;
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) return { ok: false, error: `"${k}" must be a number.` };
        if (f.min !== undefined && v < f.min) return { ok: false, error: `"${k}" must be at least ${f.min}.` };
        if (f.max !== undefined && v > f.max) return { ok: false, error: `"${k}" must be at most ${f.max}.` };
        data[k] = v;
        break;
      case 'boolean':
        if (typeof v !== 'boolean') return { ok: false, error: `"${k}" must be true or false.` };
        data[k] = v;
        break;
      case 'date':
        if (typeof v !== 'string' || v.length > 40 || Number.isNaN(Date.parse(v))) return { ok: false, error: `"${k}" must be a date (for example 2026-11-13 or an ISO timestamp).` };
        data[k] = v;
        break;
      case 'enum':
        if (typeof v !== 'string' || !f.values!.includes(v)) return { ok: false, error: `"${k}" must be one of: ${f.values!.join(', ')}.` };
        data[k] = v;
        break;
    }
  }
  if (!partial) for (const [k, f] of Object.entries(fields)) if (f.required && (data[k] === undefined || data[k] === null)) return { ok: false, error: `"${k}" is required.` };
  if (new TextEncoder().encode(JSON.stringify(data)).length > APP_RECORD_MAX_BYTES) return { ok: false, error: 'This record is too large (16 KB max).' };
  return { ok: true, data };
}

/** Parses a query-string filter value according to the field type (`?f.done=true`). */
export function parseFilterValue(f: AppField, raw: string): unknown {
  if (f.type === 'boolean') return raw === 'true' ? true : raw === 'false' ? false : undefined;
  if (f.type === 'number') { const n = Number(raw); return raw.trim() !== '' && Number.isFinite(n) ? n : undefined; }
  if (f.type === 'enum') return f.values!.includes(raw) ? raw : undefined;
  return raw.length <= 5000 ? raw : undefined;
}

/**
 * The SDK every full-stack app gets as `window.App`. Injected by the platform (never written by the AI), so it is the
 * only code in the page allowed to make network requests, and only to this app's own data endpoint.
 */
export const APP_SDK_SOURCE = `(function () {
  'use strict';
  var cfg = window.__APP_BACKEND__ || {};
  var base = cfg.api || '';
  var storeKey = 'app.session.' + (cfg.env || 'x');
  var token = null, user = null, listeners = [];
  try { token = window.localStorage.getItem(storeKey); } catch (e) { /* sandboxed preview: memory only */ }
  function AppError(message, status, code) { var e = new Error(message); e.name = 'AppError'; e.status = status; e.code = code || null; return e; }
  function save(t) { token = t; try { if (t) window.localStorage.setItem(storeKey, t); else window.localStorage.removeItem(storeKey); } catch (e) {} }
  function emit() { listeners.slice().forEach(function (cb) { try { cb(user); } catch (e) { console.error(e); } }); }
  function req(method, path, body) {
    if (!base) return Promise.reject(AppError('This app has no backend configured.', 0, 'not_configured'));
    var headers = { 'content-type': 'application/json' };
    if (token) headers['x-app-session'] = token;
    return fetch(base + path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body) }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
        if (!r.ok) {
          if (r.status === 401 && token) { save(null); user = null; emit(); }
          var m = j && j.message; if (Array.isArray(m)) m = m.join(' ');
          throw AppError(m || ('Request failed (' + r.status + ')'), r.status, j && j.code);
        }
        return j;
      });
    }, function () { throw AppError('Could not reach the server. Check your connection and try again.', 0, 'network'); });
  }
  function signedIn(r) { save(r.token); user = r.user; emit(); return user; }
  function q(o) {
    o = o || {}; var p = [];
    if (o.mine) p.push('mine=1');
    if (o.order) p.push('order=' + encodeURIComponent(o.order));
    if (o.limit) p.push('limit=' + encodeURIComponent(o.limit));
    if (o.cursor) p.push('cursor=' + encodeURIComponent(o.cursor));
    if (o.where) Object.keys(o.where).forEach(function (k) { p.push('f.' + encodeURIComponent(k) + '=' + encodeURIComponent(String(o.where[k]))); });
    return p.length ? '?' + p.join('&') : '';
  }
  var c = function (name) { return '/c/' + encodeURIComponent(name); };
  var ready = (token ? req('GET', '/auth/me').then(function (r) { user = r.user; }, function () { save(null); }) : Promise.resolve()).then(function () { emit(); return user; });
  window.App = Object.freeze({
    ready: ready,
    auth: Object.freeze({
      user: function () { return user; },
      signUp: function (email, password) { return req('POST', '/auth/signup', { email: email, password: password }).then(signedIn); },
      signIn: function (email, password) { return req('POST', '/auth/signin', { email: email, password: password }).then(signedIn); },
      signOut: function () { var p = token ? req('POST', '/auth/signout').catch(function () {}) : Promise.resolve(); save(null); user = null; emit(); return p.then(function () {}); },
      onChange: function (cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (x) { return x !== cb; }); }; }
    }),
    db: Object.freeze({
      list: function (name, options) { return req('GET', c(name) + q(options)); },
      get: function (name, id) { return req('GET', c(name) + '/' + encodeURIComponent(id)); },
      create: function (name, data) { return req('POST', c(name), data); },
      update: function (name, id, patch) { return req('PATCH', c(name) + '/' + encodeURIComponent(id), patch); },
      remove: function (name, id) { return req('DELETE', c(name) + '/' + encodeURIComponent(id)).then(function () {}); }
    })
  });
})();`;

/** Script tags that configure and load the SDK. JSON is escaped so it cannot close the script element. */
export function appBackendScripts(config: { api: string; env: 'preview' | 'live' }): string {
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `<script>window.__APP_BACKEND__=${json};</script>\n<script>\n${APP_SDK_SOURCE}\n</script>`;
}
