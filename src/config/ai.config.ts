import registerWithValidation from './core/register-with-validation.util';
import * as Joi from 'joi';

export default registerWithValidation(
  'ai',
  () => ({
    serpapiApiKey: String(process.env.SERPAPI_API_KEY),
  }),
  {
    SERPAPI_API_KEY: Joi.string().required(),
  },
);
