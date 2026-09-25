import type { SessionValidator } from "../authz/session-validator";

/**
 * A `SessionValidator` for tests that need a `PrincipalService` but are not
 * themselves testing session mechanics (`principal.service.test.ts` and
 * `session-for.ts`'s own test own that) — every token is "valid", and IS
 * the user id, the same fiction `x-yt-user-id` used to let these suites
 * name a principal directly. Pass the token as a `yt_session` cookie or a
 * `Bearer` header; either reaches `PrincipalService` identically.
 */
export function alwaysValidSessionValidator(): SessionValidator {
  return {
    validateAndTouch: (token) => Promise.resolve({ valid: true, userId: token }),
  };
}
