import registerWithValidation from './core/register-with-validation.util';
import * as Joi from 'joi';

// Research credits. Placeholder numbers until pricing is decided.
export default registerWithValidation(
  'credits',
  () => ({
    // Granted to every org each calendar month (UTC) unless the org has its
    // own organization_settings.monthly_credit_allowance.
    monthlyAllowance: Number(process.env.CREDITS_MONTHLY_ALLOWANCE ?? 50),
    // Per deep research run: one request that researches the open web and
    // looks the candidate up on RocketReach, so RocketReach has no price of
    // its own.
    costPerRun: Number(process.env.CREDITS_COST_DEEP_RESEARCH ?? 1),
    // Clerk user ids (Purple Unicorn staff) allowed to adjust any org's
    // credits. Empty: nobody can. Never an org's own admins, who'd be
    // granting themselves credits.
    adminUserIds: (process.env.CREDITS_ADMIN_USER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  }),
  {
    CREDITS_MONTHLY_ALLOWANCE: Joi.number().integer().min(0).default(50),
    CREDITS_COST_DEEP_RESEARCH: Joi.number().integer().min(0).default(1),
    CREDITS_ADMIN_USER_IDS: Joi.string().allow('').optional(),
  },
);
