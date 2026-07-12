import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigFactory } from '@nestjs/config';
import * as Joi from 'joi';

interface ConfigFactoryWithValidation extends ConfigFactory {
  VALIDATION: Record<string, Joi.Schema>;
}

@Module({})
export class ConfigCoreModule {
  static forRoot(configs: Array<ConfigFactoryWithValidation>): DynamicModule {
    return {
      module: ConfigCoreModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: configs,
          validationSchema: Joi.object(
            configs.reduce((acc, config) => {
              return {
                ...acc,
                ...config.VALIDATION,
              };
            }, {}),
          ),
        }),
      ],
    };
  }
}
