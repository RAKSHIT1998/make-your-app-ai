import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { AppConfig } from './config.js';

export function configureApp(app: INestApplication, config: AppConfig) {
  app.use(helmet());
  app.enableCors({ origin: config.WEB_ORIGIN.split(','), credentials: false });
  app.enableShutdownHooks();
}
