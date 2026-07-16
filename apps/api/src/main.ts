// Sentry must be initialized before any other imports
import './instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
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

/**
 * Fail fast in production on placeholder/weak secrets. In dev these fall back
 * to 'dev-secret' for convenience, but a production process must never boot
 * signing JWTs with a public default or encrypting OAuth tokens with a weak key.
 */
function assertProductionSecrets(): void {
  if (process.env['NODE_ENV'] !== 'production') return;
  const problems: string[] = [];
  const jwt = process.env['JWT_SECRET'];
  if (!jwt || jwt === 'dev-secret' || jwt.length < 32) {
    problems.push('JWT_SECRET must be set to a strong value (≥32 chars, not the dev default) in production');
  }
  const enc = process.env['TOKEN_ENCRYPTION_KEY'];
  if (!enc || enc.length < 32) {
    problems.push('TOKEN_ENCRYPTION_KEY must be set to at least 32 chars in production');
  }
  if (problems.length > 0) {
    throw new Error(`Refusing to start in production with insecure config:\n  - ${problems.join('\n  - ')}`);
  }
}

async function bootstrap() {
  assertProductionSecrets();
  // JSON lines in production (docs4/38, risk R-04); readable console in dev.
  // rawBody is required by the Stripe webhook route (billing.controller.ts):
  // signature verification runs over the exact bytes Stripe sent, not a
  // re-serialized JSON body. Without this flag req.rawBody is undefined and
  // every webhook fails verification.
  const app = await NestFactory.create(AppModule, { logger: new StructuredLogger(), rawBody: true });

  app.use(helmet());
  // First in the chain so every downstream log, error envelope, and Sentry
  // event carries the request's correlation ID.
  app.use(correlationMiddleware);
  // Allow the dev origin, the production domain (aicreatorforce.net + www), and
  // any extra origins from WEB_URL (comma-separated) — e.g. a Vercel preview URL.
  const allowedOrigins = [
    ...(process.env['WEB_URL'] ?? '').split(',').map((o) => o.trim()).filter(Boolean),
    'http://localhost:3007',
    'https://aicreatorforce.net',
    'https://www.aicreatorforce.net',
  ];
  app.enableCors({
    origin: allowedOrigins,
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
  const logger = new Logger('Bootstrap');
  logger.log(`AI CreatorForce API running on http://localhost:${port}/api/v1`);
  logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
}

void bootstrap();
