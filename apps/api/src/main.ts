import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await NestFactory.create(AppModule.forRoot(config), { rawBody: true });
configureApp(app, config);
await app.listen(config.API_PORT);
console.log(JSON.stringify({ level: 'info', msg: 'api listening', port: config.API_PORT }));
