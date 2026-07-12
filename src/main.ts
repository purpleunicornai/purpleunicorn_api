import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
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

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.debug(
    `Purple Unicorn API listening on http://localhost:${port}`,
    'Bootstrap',
  );
  Logger.debug(`Swagger UI:  http://localhost:${port}/docs`, 'Bootstrap');
  Logger.debug(`OpenAPI JSON: http://localhost:${port}/docs-json`, 'Bootstrap');
}
bootstrap();
