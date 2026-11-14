import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { AppConfig } from './config.js';
import { HttpErrorFilter } from './common/http-error.filter.js';

export const API_PREFIX = 'api/v1';

export function configureApp(app: INestApplication, config: AppConfig) {
  if (config.TRUST_PROXY > 0) (app as unknown as { set: (k: string, v: unknown) => void }).set('trust proxy', config.TRUST_PROXY);
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new HttpErrorFilter());
  app.use(helmet());
  // Generated apps call their data API from sandboxed pages (opaque origin) and from their own hosts. These routes
  // accept no cookies and no platform tokens, only the app's own session header, so they can be open to any origin.
  app.use(`/${API_PREFIX}/appdata`, (req: { method: string }, res: { setHeader: (k: string, v: string) => void; statusCode: number; end: () => void }, next: () => void) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,x-app-session');
    res.setHeader('Access-Control-Max-Age', '600');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    next();
  });
  // Generated shop fronts run in sandboxed iframes (opaque origin) and read their own public store API. No cookies are
  // used; draft catalogues need the builder's preview key header.
  app.use(`/${API_PREFIX}/storefront`, (req: { method: string }, res: { setHeader: (k: string, v: string) => void; statusCode: number; end: () => void }, next: () => void) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,x-store-preview');
    res.setHeader('Access-Control-Max-Age', '600');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    next();
  });
  app.enableCors({ origin: config.WEB_ORIGIN.split(','), credentials: false, exposedHeaders: ['Content-Disposition'] });
  app.enableShutdownHooks();
}
