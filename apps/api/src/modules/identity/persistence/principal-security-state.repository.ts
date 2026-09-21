/**
 * The one attribute of `identity.principal_security_state` a principal
 * resolver needs (YT-0582). `null` means "no freeze on file", which is the
 * same thing as "never frozen" — a user with no row at all resolves to the
 * same value as a user with a row whose `valueFrozenUntil` is `null`.
 */
export interface PrincipalSecurityState {
  readonly valueFrozenUntil: Date | null;
}

export interface PrincipalSecurityStateRepository {
  /**
   * `null` when the user has no security-state row on file at all, which
   * `PrincipalService` treats identically to a row with a `null`
   * `valueFrozenUntil` — absence means unfrozen either way.
   */
  findByUserId(userId: string): Promise<PrincipalSecurityState | null>;
}

export const PRINCIPAL_SECURITY_STATE_REPOSITORY = Symbol("PRINCIPAL_SECURITY_STATE_REPOSITORY");
