import { Global, Module } from '@nestjs/common';
import { ConfigCoreModule } from './core/config-core.module';
import baseConfig from './base.config';
import authConfig from './auth.config';
import aiConfig from './ai.config';
import databaseConfig from './database.config';

@Global()
@Module({
  imports: [
    ConfigCoreModule.forRoot([
      baseConfig,
      authConfig,
      aiConfig,
      databaseConfig,
    ]),
  ],
  exports: [ConfigCoreModule],
})
export class ConfigModule {}
