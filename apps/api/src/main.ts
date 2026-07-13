// Sentry must be initialized before any other imports
import './instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { correlationMiddleware } from './common/correlation.context';
import { StructuredLogger } from './common/structured-logger';

// Prisma BigInt columns (Asset sizes, video statistics) must survive
// res.json() — JSON.stringify throws on BigInt without this.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (this: bigint) {
  return Number(this);
};

async function bootstrap() {
  // JSON lines in production (docs4/38, risk R-04); readable console in dev.
  const app = await NestFactory.create(AppModule, { logger: new StructuredLogger() });

  app.use(helmet());
  // First in the chain so every downstream log, error envelope, and Sentry
  // event carries the request's correlation ID.
  app.use(correlationMiddleware);
  app.enableCors({
    origin: process.env['WEB_URL'] ?? 'http://localhost:3007',
    credentials: true,
  });

  // /metrics, /health, /ready must not carry the /api prefix so Prometheus
  // and load-balancer probes work without knowing the app versioning scheme.
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

  if (process.env['NODE_ENV'] !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('AI CreatorForce API')
      .setDescription('AI-powered YouTube content creation platform')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  // Public developer API docs (Phase 5 Wave 10) — served in EVERY environment
  // (unlike the internal doc above): the OpenAPI JSON at
  // /api/dev-docs-json is the SDK-generation source for API consumers.
  {
    const devConfig = new DocumentBuilder()
      .setTitle('CreatorForce Developer API')
      .setDescription(
        'Public API — authenticate with a developer key (`Authorization: Bearer cfk_…` or `X-Api-Key`). ' +
          'Generate a client with openapi-generator against /api/dev-docs-json.',
      )
      .setVersion('1.0')
      .addApiKey({ type: 'apiKey', name: 'X-Api-Key', in: 'header' }, 'api-key')
      .build();
    const devDocument = SwaggerModule.createDocument(app, devConfig);
    // Keep only the public /dev-api surface — portal management and internal
    // routes stay out of the consumer-facing contract.
    devDocument.paths = Object.fromEntries(
      Object.entries(devDocument.paths).filter(([p]) => p.includes('/dev-api/')),
    );
    SwaggerModule.setup('api/dev-docs', app, devDocument);
  }

  const port = parseInt(process.env['API_PORT'] ?? '4007', 10);
  await app.listen(port);
  console.warn(`AI CreatorForce API running on http://localhost:${port}/api/v1`);
  console.warn(`Swagger docs: http://localhost:${port}/api/docs`);
}

void bootstrap();
