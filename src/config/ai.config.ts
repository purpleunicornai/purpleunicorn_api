import registerWithValidation from './core/register-with-validation.util';
import * as Joi from 'joi';

export default registerWithValidation(
  'ai',
  () => ({
    // Which web-search backend role searches use: google (Custom Search
    // JSON API, shut down 1 Jan 2027), serper (serper.dev) or serpapi.
    searchProvider: process.env.SEARCH_PROVIDER ?? 'google',
    googleSearchApiKey: process.env.GOOGLE_SEARCH_API_KEY,
    googleSearchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID,
    serperApiKey: process.env.SERPER_API_KEY,
    serpApiKey: process.env.SERPAPI_KEY,
    geminiApiKey: String(process.env.GEMINI_API_KEY),
    rocketReachApiKey: String(process.env.ROCKET_REACH_API_KEY),
    // Optional — GitHub's Search Users API works unauthenticated, just at a
    // much lower rate limit (10 req/min vs 30 req/min with a token).
    githubToken: process.env.GITHUB_TOKEN,
  }),
  {
    SEARCH_PROVIDER: Joi.string()
      .valid('google', 'serper', 'serpapi')
      .default('google'),
    // Each backend's key is only required while that backend is selected.
    GOOGLE_SEARCH_API_KEY: Joi.string().when('SEARCH_PROVIDER', {
      is: Joi.valid('serper', 'serpapi'),
      then: Joi.optional(),
      otherwise: Joi.required(),
    }),
    GOOGLE_SEARCH_ENGINE_ID: Joi.string().when('SEARCH_PROVIDER', {
      is: Joi.valid('serper', 'serpapi'),
      then: Joi.optional(),
      otherwise: Joi.required(),
    }),
    SERPER_API_KEY: Joi.string().when('SEARCH_PROVIDER', {
      is: 'serper',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
    SERPAPI_KEY: Joi.string().when('SEARCH_PROVIDER', {
      is: 'serpapi',
      then: Joi.required(),
      otherwise: Joi.optional(),
    }),
    GEMINI_API_KEY: Joi.string().required(),
    ROCKET_REACH_API_KEY: Joi.string().required(),
    GITHUB_TOKEN: Joi.string().optional(),
  },
);
