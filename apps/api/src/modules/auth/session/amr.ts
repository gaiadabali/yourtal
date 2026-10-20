/**
 * How a session was signed in to, as OIDC `amr` values (RFC 8176): `pwd` a
 * password, `hwk` a passkey, `otp` an authenticator-app code, and `mfa` when
 * two factors were used. Apps that sign people in through YourTal may require
 * `hwk` or `mfa` for their staff, so these are stored on the session itself.
 */
export const AUTH_METHODS = ["pwd", "hwk", "otp", "mfa"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

export const PASSWORD_AMR: readonly AuthMethod[] = ["pwd"];
export const PASSKEY_AMR: readonly AuthMethod[] = ["hwk"];
export const PASSWORD_AND_CODE_AMR: readonly AuthMethod[] = ["pwd", "otp", "mfa"];

/** Unknown values are dropped rather than trusted; an empty result reads as `pwd`. */
export function parseAmr(stored: readonly string[]): readonly AuthMethod[] {
  const known = stored.filter((value): value is AuthMethod =>
    (AUTH_METHODS as readonly string[]).includes(value),
  );
  return known.length > 0 ? known : PASSWORD_AMR;
}
