import registerWithValidation from './core/register-with-validation.util';
import * as Joi from 'joi';

export default registerWithValidation(
  'auth',
  () => ({
    clerkSecret: String(process.env.CLERK_SECRET_KEY),
    clerkIssuerUrl: process.env.CLERK_ISSUER_URL,
  }),
  {
    CLERK_SECRET_KEY: Joi.string().required(),
    CLERK_ISSUER_URL: Joi.string().optional(),
  },
);
