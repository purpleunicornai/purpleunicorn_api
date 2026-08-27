import registerWithValidation from './core/register-with-validation.util';
import * as Joi from 'joi';

export default registerWithValidation(
  'ai',
  () => ({
    googleSearchApiKey: String(process.env.GOOGLE_SEARCH_API_KEY),
    googleSearchEngineId: String(process.env.GOOGLE_SEARCH_ENGINE_ID),
    geminiApiKey: String(process.env.GEMINI_API_KEY),
  }),
  {
    GOOGLE_SEARCH_API_KEY: Joi.string().required(),
    GOOGLE_SEARCH_ENGINE_ID: Joi.string().required(),
    GEMINI_API_KEY: Joi.string().required(),
  },
);
