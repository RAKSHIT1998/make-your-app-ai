import { parseAppBackend, BUSINESS_KITS } from '@mya/shared';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { templateForProjectType, treeFromTemplate, validateTree } from '../src/index.js';

describe('built-in app backend', () => {
  const fxr = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
  const TASKS = () => new Map(Object.entries({ 'package.json': '{"name":"t","version":"1.0.0"}', 'index.html': fxr('tasks-index.html'), 'style.css': fxr('tasks-style.css'), 'app.js': fxr('tasks-app.js'), 'app.backend.json': fxr('tasks-backend.json') }));

  it('accepts a real full-stack app', () => {
    expect(validateTree(TASKS())).toEqual([]);
  });

  it('catches the mistakes an AI makes with the backend contract', () => {
    const t = TASKS();
    t.set('app.js', `${t.get('app.js')}\nApp.db.list('projects');\nfetch('/x');\n`);
    const issues = validateTree(t).map((i) => i.message).join('\n');
    expect(issues).toContain('collection "projects" which is not declared');
    expect(issues).toContain('Talk to the backend only through App.db and App.auth');

    const noFile = TASKS(); noFile.delete('app.backend.json');
    expect(validateTree(noFile).map((i) => i.message).join('\n')).toContain('there is no app.backend.json');

    const bad = TASKS();
    bad.set('app.backend.json', JSON.stringify({ auth: { enabled: false }, collections: { tasks: { fields: { id: { type: 'string' }, kind: { type: 'enum' } }, access: { read: 'owner', create: 'users', modify: 'owner' } } } }));
    const msgs = validateTree(bad).map((i) => i.message).join('\n');
    expect(msgs).toMatch(/added automatically/);
    expect(msgs).toMatch(/enum field needs "values"/);
    expect(msgs).toMatch(/needs signed-in users/);

    const redefine = TASKS(); redefine.set('app.js', 'window.App = {};');
    expect(validateTree(redefine).map((i) => i.message).join('\n')).toContain('Redefines App');
  });
});

it('the full-stack starter template passes its own checks', () => {
  expect(validateTree(treeFromTemplate(templateForProjectType('saas')!))).toEqual([]);
});

it('free services need the built-in backend (they go through the same SDK)', () => {
  const t = new Map([['index.html', '<!doctype html><html><head><title>x</title></head><body><script src="app.js"></script></body></html>'], ['app.js', "App.services.currency.convert(10, 'USD', 'INR');\n"]]);
  expect(validateTree(t).map((i) => i.message).join('\n')).toContain('there is no app.backend.json');
});

describe('team-only business apps', () => {
  const backend = (auth: object, access: object) => JSON.stringify({ auth, collections: { sales: { fields: { total: { type: 'number', required: true } }, access } } });
  it('allows shared editing only when the owner controls who signs up', () => {
    expect(parseAppBackend(backend({ enabled: true, mode: 'team' }, { read: 'users', create: 'users', modify: 'users' })).ok).toBe(true);
    const open = parseAppBackend(backend({ enabled: true }, { read: 'users', create: 'users', modify: 'users' }));
    expect(open.ok).toBe(false);
    expect(open.ok ? '' : open.errors.join(' ')).toMatch(/"mode": "team"/);
  });
  it('never lets a team app be public, and needs accounts', () => {
    expect(parseAppBackend(backend({ enabled: true, mode: 'team' }, { read: 'public', create: 'users', modify: 'none' })).ok).toBe(false);
    expect(parseAppBackend(backend({ enabled: true, mode: 'team' }, { read: 'users', create: 'public', modify: 'none' })).ok).toBe(false);
    expect(parseAppBackend(backend({ enabled: false, mode: 'team' }, { read: 'users', create: 'users', modify: 'none' })).ok).toBe(false);
  });
  it('keeps existing apps working: mode defaults to open', () => {
    const r = parseAppBackend(backend({ enabled: true }, { read: 'owner', create: 'users', modify: 'owner' }));
    expect(r.ok && r.backend.auth.mode).toBe('open');
  });
  it('ships business kits that ask for a team-only app and fit the composer', () => {
    expect(BUSINESS_KITS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(BUSINESS_KITS.map((k) => k.id)).size).toBe(BUSINESS_KITS.length);
    for (const k of BUSINESS_KITS) {
      expect(k.prompt).toMatch(/team-only app/);
      expect(k.prompt.length).toBeLessThan(8000);
      expect(k.features.length).toBeGreaterThan(0);
    }
  });
});

describe('online store shop fronts', () => {
  const store = () => treeFromTemplate(templateForProjectType('ecommerce')!);

  it('ships a template that passes its own checks and talks only to Store', () => {
    const t = store();
    expect(templateForProjectType('ecommerce')!.id).toBe('storefront-web');
    expect(validateTree(t)).toEqual([]);
    expect(t.get('app.js')).toContain('Store.checkout');
    expect(t.get('app.js')).not.toMatch(/\bfetch\(/);
  });

  it('flags a shop that collects card details, redefines Store or loses its marker', () => {
    const t = store();
    t.set('app.js', `${t.get('app.js')}\nconst Store = {};\n`);
    t.set('index.html', t.get('index.html')!.replace('</body>', '<input placeholder="Card number"></body>'));
    const msgs = validateTree(t).map((i) => i.message).join('\n');
    expect(msgs).toContain('Redefines Store');
    expect(msgs).toContain('Collects card details');
    t.delete('storefront.json');
    expect(validateTree(t).map((i) => i.message).join('\n')).toContain('storefront.json is missing');
  });

  it('lets ordinary sites mention a "store" without tripping the check', () => {
    const t = new Map(Object.entries({ 'package.json': '{"name":"s","version":"1.0.0"}', 'index.html': '<!doctype html><html><head><title>x</title></head><body><p>Visit our store</p><script src="app.js"></script></body></html>', 'app.js': 'const store = { open: true };\n' }));
    expect(validateTree(t).filter((i) => /Store/.test(i.message))).toEqual([]);
  });
});

describe('checkout hand-off from a shop front', async () => {
  const { parseCheckoutHandoff, encodeCart, decodeCart, buildPreviewDocument } = await import('@mya/shared');
  const V = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

  it('accepts only a well-formed cart message', () => {
    const ok = parseCheckoutHandoff({ type: 'mya:checkout', items: [{ variantId: V, quantity: 2 }], discountCode: 'SAVE10' });
    expect(ok).toMatchObject({ items: [{ variantId: V, quantity: 2 }], discountCode: 'SAVE10' });
    expect(parseCheckoutHandoff({ type: 'other' })).toBeNull();
    expect(parseCheckoutHandoff({ type: 'mya:checkout', items: [] })).toBeNull();
    expect(parseCheckoutHandoff({ type: 'mya:checkout', items: [{ variantId: 'nope', quantity: 1 }] })).toBeNull();
    expect(parseCheckoutHandoff({ type: 'mya:checkout', items: [{ variantId: V, quantity: 500 }] })).toBeNull();
    expect(parseCheckoutHandoff({ type: 'mya:checkout', items: [{ variantId: V, quantity: 1 }], discountCode: '<script>' })).toEqual({ type: 'mya:checkout', items: [{ variantId: V, quantity: 1 }] });
  });

  it('round-trips the cart through the URL fragment', () => {
    const cart = { items: [{ variantId: V, quantity: 3 }] };
    expect(decodeCart(encodeCart(cart))).toMatchObject(cart);
    expect(decodeCart('garbage!!')).toBeNull();
  });

  it('injects the Store SDK and lets the sandbox reach only the store API', () => {
    const res = buildPreviewDocument(new Map(Object.entries({ 'index.html': '<!doctype html><html><head></head><body></body></html>' })), { store: { api: 'https://api.example.com/api/v1/storefront/candles', slug: 'candles', mode: 'live' } });
    if (!res.ok) throw new Error(res.reason);
    const html = res.html;
    expect(html).toContain('window.Store = Object.freeze');
    expect(html).toMatch(/connect-src https:\/\/api\.example\.com[;"]/);
    expect(JSON.parse(/window\.__STORE__=(\{.*?\});<\/script>/.exec(html)![1]!).previewKey).toBeUndefined();
  });
});
