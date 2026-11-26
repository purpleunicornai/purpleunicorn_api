import registerWithValidation from './core/register-with-validation.util';
import * as Joi from 'joi';

export default registerWithValidation(
  'ai',
  () => ({
    vertexProjectId: String(process.env.VERTEX_PROJECT_ID),
    vertexLocation: process.env.VERTEX_LOCATION || 'global',
    vertexEngineId: process.env.VERTEX_ENGINE_ID,
    vertexServingConfigId:
      process.env.VERTEX_SERVING_CONFIG_ID || 'default_search',
    // Base64 service-account JSON, decoded as yuv-api's
    // FIREBASE_SERVICE_ACCOUNT.
    vertexServiceAccount: String(process.env.VERTEX_SERVICE_ACCOUNT),
    // Optional alternative to the service account: searchLite (public
    // website data stores only).
    vertexApiKey: process.env.VERTEX_API_KEY,
    // Gemini models go through Vertex (not the Gemini API key). Distinct
    // from VERTEX_LOCATION, which is the Discovery Engine search region.
    vertexAiLocation: process.env.VERTEX_AI_LOCATION || 'global',
    // Optional: unset or empty turns RocketReach off (deep research skips
    // it and never charges for it).
    rocketReachApiKey: process.env.ROCKET_REACH_API_KEY || undefined,
    // A candidate RocketReach found within this many days is served from
    // that lookup instead of a new (billed) one. 0 turns the reuse off.
    rocketReachCacheTtlDays: Number(
      process.env.ROCKETREACH_CACHE_TTL_DAYS ?? 30,
    ),
    // Optional reasoning providers: an org can pick their models only when
    // the key is set.
    openaiApiKey: process.env.OPENAI_API_KEY || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    // Optional — GitHub's Search Users API works unauthenticated, just at a
    // much lower rate limit (10 req/min vs 30 req/min with a token).
    githubToken: process.env.GITHUB_TOKEN,
  }),
  {
    VERTEX_PROJECT_ID: Joi.string().required(),
    VERTEX_ENGINE_ID: Joi.string().required(),
    VERTEX_LOCATION: Joi.string().allow('').default('global'),
    VERTEX_SERVING_CONFIG_ID: Joi.string().allow('').default('default_search'),
    // Required: Vertex AI Search and Gemini (via @ai-sdk/google-vertex)
    // both authenticate with this service account.
    VERTEX_SERVICE_ACCOUNT: Joi.string().required(),
    // Optional fallback for Vertex AI Search (searchLite) only; Gemini
    // does not use it.
    VERTEX_API_KEY: Joi.string().allow('').optional(),
    VERTEX_AI_LOCATION: Joi.string().allow('').default('global'),
    ROCKET_REACH_API_KEY: Joi.string().allow('').optional(),
    ROCKETREACH_CACHE_TTL_DAYS: Joi.number().integer().min(0).default(30),
    OPENAI_API_KEY: Joi.string().allow('').optional(),
    ANTHROPIC_API_KEY: Joi.string().allow('').optional(),
    GITHUB_TOKEN: Joi.string().optional(),
  },
);
