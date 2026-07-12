import registerWithValidation from './core/register-with-validation.util';
import * as Joi from 'joi';

export default registerWithValidation(
  'base',
  () => ({
    database_url: String(process.env.DATABASE_URL),
    redis_url: String(process.env.REDIS_URL),
  }),
  {
    DATABASE_URL: Joi.string().required(),
    REDIS_URL: Joi.string().required(),
  },
);
