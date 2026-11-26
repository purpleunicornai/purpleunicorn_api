import { Logger } from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import { createApp } from './bootstrap';
import baseConfig from './config/base.config';

async function bootstrap() {
  const app = await createApp();

  // On Vercel, api/index.ts serves requests through the Express adapter.
  // Listening here would bind a port inside the function for no benefit.
  if (process.env.VERCEL) return;

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
void bootstrap();
