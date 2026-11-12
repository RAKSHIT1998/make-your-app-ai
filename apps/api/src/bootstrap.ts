import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { AppConfig } from './config.js';
import { HttpErrorFilter } from './common/http-error.filter.js';

export const API_PREFIX = 'api/v1';

export function configureApp(app: INestApplication, config: AppConfig) {
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new HttpErrorFilter());
  app.use(helmet());
  app.enableCors({ origin: config.WEB_ORIGIN.split(','), credentials: false });
  app.enableShutdownHooks();
}
