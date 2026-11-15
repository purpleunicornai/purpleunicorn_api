import registerWithValidation from './core/register-with-validation.util';
import * as Joi from 'joi';

export default registerWithValidation(
  'ai',
  () => ({
    // Which web-search backend role searches use: google (Custom Search
    // JSON API, shut down 1 Jan 2027), serper (serper.dev), serpapi or
    // vertex (Vertex AI Search over a website data store).
    searchProvider: process.env.SEARCH_PROVIDER ?? 'google',
    googleSearchApiKey: process.env.GOOGLE_SEARCH_API_KEY,
    googleSearchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID,
    serperApiKey: process.env.SERPER_API_KEY,
    serpApiKey: process.env.SERPAPI_KEY,
    vertexProjectId: process.env.VERTEX_PROJECT_ID,
    vertexLocation: process.env.VERTEX_LOCATION || 'global',
    vertexEngineId: process.env.VERTEX_ENGINE_ID,
    vertexServingConfigId:
      process.env.VERTEX_SERVING_CONFIG_ID || 'default_search',
    // Base64 service-account JSON, decoded as yuv-api's
    // FIREBASE_SERVICE_ACCOUNT.
    vertexServiceAccount: process.env.VERTEX_SERVICE_ACCOUNT,
    // Optional alternative to the service account: searchLite (public
    // website data stores only).
    vertexApiKey: process.env.VERTEX_API_KEY,
    geminiApiKey: String(process.env.GEMINI_API_KEY),
    rocketReachApiKey: String(process.env.ROCKET_REACH_API_KEY),
    // Optional — GitHub's Search Users API works unauthenticated, just at a
    // much lower rate limit (10 req/min vs 30 req/min with a token).
    githubToken: process.env.GITHUB_TOKEN,
  }),
  {
    SEARCH_PROVIDER: Joi.string()
      .valid('google', 'serper', 'serpapi', 'vertex')
      .default('google'),
    // Each backend's key is only required while that backend is selected.
    GOOGLE_SEARCH_API_KEY: Joi.string().when('SEARCH_PROVIDER', {
      is: Joi.valid('serper', 'serpapi', 'vertex'),
      then: Joi.optional(),
      otherwise: Joi.required(),
    }),
    GOOGLE_SEARCH_ENGINE_ID: Joi.string().when('SEARCH_PROVIDER', {
      is: Joi.valid('serper', 'serpapi', 'vertex'),
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
    VERTEX_PROJECT_ID: Joi.string().when('SEARCH_PROVIDER', {
      is: 'vertex',
      then: Joi.required(),
      otherwise: Joi.optional().allow(''),
    }),
    VERTEX_ENGINE_ID: Joi.string().when('SEARCH_PROVIDER', {
      is: 'vertex',
      then: Joi.required(),
      otherwise: Joi.optional().allow(''),
    }),
    VERTEX_LOCATION: Joi.string().allow('').default('global'),
    VERTEX_SERVING_CONFIG_ID: Joi.string().allow('').default('default_search'),
    // Required with SEARCH_PROVIDER=vertex unless VERTEX_API_KEY is set.
    VERTEX_SERVICE_ACCOUNT: Joi.string().when('SEARCH_PROVIDER', {
      is: 'vertex',
      then: Joi.when('VERTEX_API_KEY', {
        is: Joi.string().min(1).required(),
        then: Joi.optional().allow(''),
        otherwise: Joi.required(),
      }),
      otherwise: Joi.optional().allow(''),
    }),
    VERTEX_API_KEY: Joi.string().allow('').optional(),
    GEMINI_API_KEY: Joi.string().required(),
    ROCKET_REACH_API_KEY: Joi.string().required(),
    GITHUB_TOKEN: Joi.string().optional(),
  },
);
