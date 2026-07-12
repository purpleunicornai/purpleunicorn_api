import registerWithValidation from './core/register-with-validation.util';
import * as Joi from 'joi';

export default registerWithValidation(
  'base',
  () => ({
    nodeEnv: process.env.NODE_ENV || 'DEV',
    port: parseInt(process.env.PORT || '5000', 10),
  }),
  {
    NODE_ENV: Joi.string().allow('DEV', 'PROD'),
    PORT: Joi.number().min(1024).max(65535),
  },
);
