// Stand-in for Supabase Auth (password grant, sign-up, user, logout), signing HS256 tokens the API accepts.
// Any email with any password signs in: the bots create a fresh customer for every run.
import http from 'node:http';
import { createHash } from 'node:crypto';

const { SignJWT, decodeJwt } = await import(new URL('../../../apps/api/node_modules/jose/dist/webapi/index.js', import.meta.url).href);
const port = Number(process.env.BOTS_AUTH_PORT ?? 54400);
const SECRET = new TextEncoder().encode(process.env.BOTS_JWT_SECRET);
const idFor = (email) => { const h = createHash('sha256').update(email).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const userFor = (email) => ({ id: idFor(email), email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() });
async function session(email) {
  const u = userFor(email);
  const token = await new SignJWT({ email, role: 'authenticated' }).setProtectedHeader({ alg: 'HS256' }).setSubject(u.id).setAudience('authenticated').setIssuer(`http://localhost:${port}/auth/v1`).setIssuedAt().setExpirationTime('2h').sign(SECRET);
  return { access_token: token, refresh_token: 'r', token_type: 'bearer', expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, user: u };
}
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); });

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.end();
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/auth/v1/token') || req.url.startsWith('/auth/v1/signup')) {
    const b = await body(req);
    if (!b.email) { res.statusCode = 400; return res.end('{"error":"email required"}'); }
    return res.end(JSON.stringify(await session(String(b.email).toLowerCase())));
  }
  if (req.url.startsWith('/auth/v1/user')) {
    const auth = req.headers.authorization?.slice(7);
    if (!auth) { res.statusCode = 401; return res.end('{}'); }
    return res.end(JSON.stringify(userFor(decodeJwt(auth).email)));
  }
  if (req.url.startsWith('/auth/v1/logout')) { res.statusCode = 204; return res.end(); }
  res.statusCode = 404; res.end('{}');
}).listen(port, () => console.log(`bots auth :${port}`));
