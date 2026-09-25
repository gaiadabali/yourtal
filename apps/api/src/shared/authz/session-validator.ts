import type { SessionValidation } from "../../modules/auth/session/session.service";

export type { SessionValidation };

/**
 * 1.5.a: the one thing `PrincipalService` needs from the auth module,
 * narrowed to a structural interface rather than the concrete
 * `SessionService` class — a class with a private field (`SessionService`
 * has one) can only ever be satisfied by an instance of that exact class or
 * a subclass, never by a plain object literal, which is exactly what
 * `principal.service.test.ts` and every controller test that duck-types a
 * fake principal resolver needs to keep doing. Bound to the real
 * `SessionService` in `AuthModule` (`useExisting`); a test passes a plain
 * `{ validateAndTouch: vi.fn() }` instead, with no cast.
 */
export interface SessionValidator {
  validateAndTouch(token: string, now: Date): Promise<SessionValidation>;
}

export const SESSION_VALIDATOR = Symbol("SESSION_VALIDATOR");
