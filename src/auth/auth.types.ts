/**
 * Auth context attached to every authenticated request.
 *
 * Populated by `ClerkAuthGuard` after a successful JWT verification, and
 * available either via `req.auth` or — preferred — via the `@CurrentAuth()`
 * controller-method decorator.
 */
export interface ClerkAuthContext {
  /** Clerk user id (`sub` claim). */
  userId: string;
  /** Clerk session id, when present in the token. */
  sessionId?: string;
  /** Active organization id, when the token was issued in an org context. */
  orgId?: string;
  /** Active organization role, when present. */
  orgRole?: string;
  /** Raw verified JWT claims, in case callers need anything we didn't surface. */
  claims: Record<string, unknown>;
}

declare module 'express' {
  interface Request {
    auth?: ClerkAuthContext;
  }
}
