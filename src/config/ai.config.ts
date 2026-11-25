import registerWithValidation from './core/register-with-validation.util';
import * as Joi from 'joi';

export default registerWithValidation(
  'ai',
  () => ({
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
    // Required unless VERTEX_API_KEY is set.
    VERTEX_SERVICE_ACCOUNT: Joi.string().when('VERTEX_API_KEY', {
      is: Joi.string().min(1).required(),
      then: Joi.optional().allow(''),
      otherwise: Joi.required(),
    }),
    VERTEX_API_KEY: Joi.string().allow('').optional(),
    GEMINI_API_KEY: Joi.string().required(),
    ROCKET_REACH_API_KEY: Joi.string().allow('').optional(),
    ROCKETREACH_CACHE_TTL_DAYS: Joi.number().integer().min(0).default(30),
    OPENAI_API_KEY: Joi.string().allow('').optional(),
    ANTHROPIC_API_KEY: Joi.string().allow('').optional(),
    GITHUB_TOKEN: Joi.string().optional(),
  },
);
