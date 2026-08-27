import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import { RequestExceptionFilter } from './common/middleware/request-exception.filter';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { ConfigType } from '@nestjs/config';
import baseConfig from './config/base.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

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

  const baseConf: ConfigType<typeof baseConfig> = app.get(baseConfig.KEY);

  const port = Number(baseConf.port ?? 4000);
  await app.listen(port);
  Logger.debug(
    `Purple Unicorn API listening on http://localhost:${port}`,
    'Bootstrap',
  );
  Logger.debug(`Swagger UI:  http://localhost:${port}/docs`, 'Bootstrap');
  Logger.debug(`OpenAPI JSON: http://localhost:${port}/docs-json`, 'Bootstrap');
}
bootstrap();
