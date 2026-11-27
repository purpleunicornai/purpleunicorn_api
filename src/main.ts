import { Logger, ValidationPipe } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { RequestExceptionFilter } from './common/middleware/request-exception.filter';
import baseConfig from './config/base.config';
import {
  runsInline,
  VERCEL_MAX_DURATION_MS,
} from './roles/search-jobs/role-search-job';

async function bootstrap() {
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
  // 2 minutes, the AI-backed candidate search can run long. On Vercel the
  // start-search request runs the whole search, so allow the function's max.
  app.useGlobalInterceptors(
    new TimeoutInterceptor(runsInline() ? VERCEL_MAX_DURATION_MS : 120000),
  );

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

  // Vercel's NestJS preset wraps this listen() and serves the app as one
  // function. It also sets PORT. Locally we fall back to the configured port.
  const baseConf: ConfigType<typeof baseConfig> = app.get(baseConfig.KEY);
  const port = Number(process.env.PORT ?? baseConf.port ?? 4000);
  await app.listen(port);
  Logger.debug(
    `Purple Unicorn API listening on http://localhost:${port}`,
    'Bootstrap',
  );
  Logger.debug(`Swagger UI:  http://localhost:${port}/docs`, 'Bootstrap');
  Logger.debug(`OpenAPI JSON: http://localhost:${port}/docs-json`, 'Bootstrap');
}
void bootstrap();
