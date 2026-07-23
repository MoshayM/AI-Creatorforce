import './instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import * as express from 'express';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { correlationMiddleware } from './common/correlation.context';
import { StructuredLogger } from './common/structured-logger';

(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

const expressApp = express();
let initialized = false;

export async function createNestServer(): Promise<express.Application> {
  if (initialized) return expressApp;

  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp), {
    logger: new StructuredLogger(),
    rawBody: true,
  });

  app.use(helmet());
  app.use(correlationMiddleware);

  const allowedOrigins = [
    ...(process.env['WEB_URL'] ?? '').split(',').map((o) => o.trim()).filter(Boolean),
    'http://localhost:3007',
    'https://aicreatorforce.net',
    'https://www.aicreatorforce.net',
  ];
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.setGlobalPrefix('api', { exclude: ['metrics', 'health', 'ready'] });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.init();
  initialized = true;
  return expressApp;
}
