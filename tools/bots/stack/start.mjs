// Starts a complete, throwaway copy of the platform for the bots: a fresh database with every migration applied,
// the auth stand-in, the real API (with provider stand-ins) and the real web app built for these addresses.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const require = createRequire(path.join(ROOT, 'packages/db/package.json'));
const pg = require('pg');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const OWNER_EMAIL = 'owner@bots.example.com';

export function stackConfig(env = process.env) {
  const apiPort = env.BOTS_API_PORT ?? '4100';
  const webPort = env.BOTS_WEB_PORT ?? '3100';
  const authPort = env.BOTS_AUTH_PORT ?? '54400';
  const phonePort = env.BOTS_PHONE_PORT ?? '3200';
  const admin = env.BOTS_ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/postgres';
  const dbName = env.BOTS_DATABASE_NAME ?? 'mya_bots';
  const u = new URL(admin); u.pathname = `/${dbName}`;
  return {
    apiPort, webPort, authPort, phonePort, admin, dbName, databaseUrl: u.toString(),
    apiUrl: `http://localhost:${apiPort}`, webUrl: `http://localhost:${webPort}`, authUrl: `http://localhost:${authPort}`, phoneUrl: `http://localhost:${phonePort}`,
    jwtSecret: 'bots-secret-bots-secret-bots-secret-1234', storageDir: path.join(tmpdir(), 'mya-bots-storage'),
  };
}

/** Drops and recreates the bots' database and applies every migration in order. Refuses names that don't look like a test database. */
async function freshDatabase(c, log) {
  if (!/bots|test/.test(c.dbName)) throw new Error(`Refusing to reset database "${c.dbName}": its name must contain "bots" or "test".`);
  const admin = new pg.Client({ connectionString: c.admin });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${c.dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${c.dbName}"`);
  await admin.end();
  const db = new pg.Client({ connectionString: c.databaseUrl });
  await db.connect();
  const dir = path.join(ROOT, 'packages/db/prisma/migrations');
  const migrations = readdirSync(dir).filter((d) => existsSync(path.join(dir, d, 'migration.sql'))).sort();
  for (const m of migrations) await db.query(readFileSync(path.join(dir, m, 'migration.sql'), 'utf8'));
  // The stand-in AI's routes live in the database like real routes, so owner-console edits (which reload routes
  // from the database) keep them, exactly as production keeps its configured routes.
  for (const tier of ['fast', 'balanced', 'deep']) {
    await db.query(`INSERT INTO "AiProviderConfig" (id, provider, model, tier, priority, "inputCostPerMTokMicros", "outputCostPerMTokMicros", "updatedAt") VALUES (gen_random_uuid(), 'scripted', $1, $2, 1, 2000000, 10000000, now())`, [`bot-sim-${tier}`, tier]);
  }
  await db.end();
  log(`database ${c.dbName}: ${migrations.length} migrations applied`);
}

function start(name, args, env, cwd = ROOT, logFile) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = [];
  const keep = (d) => { out.push(String(d)); if (out.length > 400) out.shift(); };
  child.stdout.on('data', keep); child.stderr.on('data', keep);
  child.on('exit', () => { if (logFile) writeFileSync(logFile, out.join('')); });
  child.output = () => out.join('');
  child.label = name;
  return child;
}

async function waitFor(url, label, child, ms = 120_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (child?.exitCode != null) throw new Error(`${label} exited:\n${child.output().slice(-3000)}`);
    try { const r = await fetch(url, { signal: AbortSignal.timeout(5000) }); if (r.status < 500) return; } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`${label} did not start within ${ms / 1000}s:\n${child?.output().slice(-3000) ?? ''}`);
}

function run(cmd, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} ${args.join(' ')} failed:\n${out.slice(-4000)}`))));
  });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };
/** Serves the phone app's web build: files as they are, every other path gets index.html (the app routes itself). */
function servePhoneApp(dir, port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
      let file = path.join(dir, rel);
      if (!file.startsWith(dir) || !existsSync(file) || rel === '' || !path.extname(file)) file = path.join(dir, 'index.html');
      res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
      res.end(readFileSync(file));
    });
    server.listen(Number(port), () => resolve(server));
  });
}

/**
 * Starts everything and returns addresses plus stop(). The API and web app must already be built
 * (`pnpm build`); the web app is rebuilt here because its public addresses are fixed at build time.
 */
export async function startStack({ log = console.log, buildWeb = process.env.BOTS_REUSE_WEB !== '1', logDir } = {}) {
  const c = stackConfig();
  await freshDatabase(c, log);
  rmSync(c.storageDir, { recursive: true, force: true }); mkdirSync(c.storageDir, { recursive: true });
  const env = {
    BOTS_DATABASE_URL: c.databaseUrl, BOTS_JWT_SECRET: c.jwtSecret, BOTS_STORAGE_DIR: c.storageDir, BOTS_OWNER_EMAIL: OWNER_EMAIL,
    BOTS_API_PORT: c.apiPort, BOTS_AUTH_PORT: c.authPort, BOTS_WEB_URL: c.webUrl, BOTS_PHONE_URL: c.phoneUrl,
  };
  const kids = [];
  let phoneServer;
  const stop = async () => { phoneServer?.close(); for (const k of kids) k.kill('SIGTERM'); await sleep(500); for (const k of kids) if (k.exitCode == null) k.kill('SIGKILL'); };
  try {
    const auth = start('auth', [path.join(ROOT, 'tools/bots/stack/auth.mjs')], env, ROOT, logDir && path.join(logDir, 'auth.log')); kids.push(auth);
    const api = start('api', [path.join(ROOT, 'tools/bots/stack/api.mjs')], env, ROOT, logDir && path.join(logDir, 'api.log')); kids.push(api);
    await waitFor(`${c.authUrl}/auth/v1/health`, 'auth', auth, 30_000);
    await waitFor(`${c.apiUrl}/api/v1/health/live`, 'API', api);
    // Seed the plan catalogue, then let the Free plan build every product type: the bots test each product, and
    // the billing bot checks paid upgrades separately.
    await fetch(`${c.apiUrl}/api/v1/billing/plans`);
    const db = new pg.Client({ connectionString: c.databaseUrl }); await db.connect();
    await db.query(`UPDATE "Plan" f SET "projectTypes" = s."projectTypes", "featureFlags" = s."featureFlags", "maxSeats" = s."maxSeats", "maxOrgs" = s."maxOrgs", "monthlyBuildCredits" = s."monthlyBuildCredits", "maxProjects" = 100, "includedCredits" = 5000, "dailyCreditLimit" = NULL FROM "Plan" s WHERE f.code = 'free' AND s.code = 'studio'`);
    await db.end();

    const web = path.join(ROOT, 'apps/web');
    const webEnv = { NEXT_PUBLIC_API_URL: c.apiUrl, NEXT_PUBLIC_SUPABASE_URL: c.authUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon', NEXT_PUBLIC_SITE_URL: c.webUrl, NEXT_TELEMETRY_DISABLED: '1' };
    const stamp = path.join(web, '.next', 'BOTS_STAMP');
    const want = JSON.stringify(webEnv);
    if (buildWeb || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== want) {
      log('building the web app for the bots (1-3 minutes)…');
      await run(process.execPath, [require.resolve('next/dist/bin/next', { paths: [web] }), 'build'], webEnv, web);
      writeFileSync(stamp, want);
    }
    const next = start('web', [require.resolve('next/dist/bin/next', { paths: [web] }), 'start', '-p', c.webPort], webEnv, web, logDir && path.join(logDir, 'web.log')); kids.push(next);
    await waitFor(`${c.webUrl}/login`, 'web', next);

    // The iOS/Android app, built for the browser with the same code, so the phone-app bot can use it like a phone.
    const phoneDir = path.join(tmpdir(), 'mya-bots-phone-app');
    const phoneEnv = { EXPO_PUBLIC_API_URL: c.apiUrl, EXPO_PUBLIC_SUPABASE_URL: c.authUrl, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon', EXPO_PUBLIC_WEB_URL: c.webUrl, CI: '1', EXPO_NO_TELEMETRY: '1' };
    log('building the phone app for the browser…');
    rmSync(phoneDir, { recursive: true, force: true });
    const mobile = path.join(ROOT, 'apps/mobile');
    await run(process.execPath, [require.resolve('expo/bin/cli', { paths: [mobile] }), 'export', '--platform', 'web', '--output-dir', phoneDir, '--clear'], phoneEnv, mobile);
    phoneServer = await servePhoneApp(phoneDir, c.phonePort);
    log(`stack up: web ${c.webUrl} · phone app ${c.phoneUrl} · api ${c.apiUrl}`);
    return { ...c, ownerEmail: OWNER_EMAIL, stop };
  } catch (e) { await stop(); throw e; }
}
