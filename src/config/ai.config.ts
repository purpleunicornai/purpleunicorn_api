import registerWithValidation from './core/register-with-validation.util';
import * as Joi from 'joi';

export default registerWithValidation(
  'ai',
  () => ({
    googleSearchApiKey: String(process.env.GOOGLE_SEARCH_API_KEY),
    googleSearchEngineId: String(process.env.GOOGLE_SEARCH_ENGINE_ID),
    geminiApiKey: String(process.env.GEMINI_API_KEY),
    rocketReachApiKey: String(process.env.ROCKET_REACH_API_KEY),
    // Optional — GitHub's Search Users API works unauthenticated, just at a
    // much lower rate limit (10 req/min vs 30 req/min with a token).
    githubToken: process.env.GITHUB_TOKEN,
  }),
  {
    GOOGLE_SEARCH_API_KEY: Joi.string().required(),
    GOOGLE_SEARCH_ENGINE_ID: Joi.string().required(),
    GEMINI_API_KEY: Joi.string().required(),
    ROCKET_REACH_API_KEY: Joi.string().required(),
    GITHUB_TOKEN: Joi.string().optional(),
  },
);
