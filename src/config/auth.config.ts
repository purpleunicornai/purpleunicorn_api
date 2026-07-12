import registerWithValidation from './core/register-with-validation.util';
import * as Joi from 'joi';

export default registerWithValidation(
  'auth',
  () => ({
    clerkSecret: String(process.env.CLERK_SECRET_KEY),
  }),
  {
    CLERK_SECRET_KEY: Joi.string().required(),
  },
);
