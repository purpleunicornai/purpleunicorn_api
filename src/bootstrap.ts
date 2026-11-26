import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { RequestExceptionFilter } from './common/middleware/request-exception.filter';

// Cached across Vercel invocations in a warm isolate so we don't open a
// new Nest app (and a new set of Redis connections) on every request.
let appPromise: Promise<NestExpressApplication> | undefined;

export function createApp(): Promise<NestExpressApplication> {
  appPromise ??= buildApp();
  return appPromise;
}

async function buildApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
  });

  // Base64 inflates file size by ~33% (job-spec-import accepts files up to
  // 5MB decoded), so the raw request body needs headroom above Express's
  // 100kb default or a 5MB-and-under file would still be rejected before
  // JobSpecImportService's own size check ever runs.
  app.useBodyParser('json', { limit: '7mb' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'origin', 'authorization'],
  });

  app.useGlobalFilters(new RequestExceptionFilter());
  app.useGlobalInterceptors(new TimeoutInterceptor(120000)); // 2 minute timeout — the AI-backed candidate search can run long

  const config = new DocumentBuilder()
    .setTitle('Purple Unicorn Api')
    .setDescription(
      'The api to support the front end of the Purple Unicorn application',
    )
    .setVersion('1.0')
    .addTag('Purple Unicorn')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Paste a Clerk session JWT (e.g. obtained from `await getToken()` on the client).',
      },
      'bearer',
    )
    .build();

  const documentFactory = () => SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, documentFactory, {
    jsonDocumentUrl: 'docs-json',
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  app.enableShutdownHooks();
  await app.init();
  return app;
}
