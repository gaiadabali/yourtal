export const CREDENTIAL_REPOSITORY = Symbol("CREDENTIAL_REPOSITORY");

/** Today's only kind. A second (`phone_otp`, an OIDC subject) is YT-0541's. */
export const PASSWORD_CREDENTIAL_KIND = "password";

export interface Credential {
  readonly userId: string;
  readonly kind: string;
  readonly identifier: string;
  readonly secretHash: string;
  readonly updatedAt: Date;
}

export interface CredentialRepository {
  findByUserAndKind(userId: string, kind: string): Promise<Credential | null>;

  /**
   * The login-path lookup: `user_id` is opaque and never presented by a
   * caller, so authenticating starts from the credential kind's own
   * namespace value instead — the normalised email, for `kind =
   * 'password'` — and this is the one indirection that buys back the
   * `user_id` needed to issue a session. Backed by `UNIQUE (kind,
   * identifier)`, so this is a single index lookup, not a scan.
   */
  findByKindAndIdentifier(kind: string, identifier: string): Promise<Credential | null>;

  /**
   * Creates a NEW credential, refusing if one already exists for this
   * (kind, identifier) — this is what makes registration's "this email is
   * already registered" a real constraint rather than a query against a
   * table that does not exist. Returns `false` on that conflict rather than
   * throwing: a duplicate registration is an expected outcome, not an
   * exceptional one. `userId` is minted by the caller (`crypto.randomUUID()`
   * in `AuthService.register`) before this is ever called — a fresh UUID
   * cannot collide with an existing `(user_id, kind)` primary key, so the
   * conflict this guards against is always on `(kind, identifier)`.
   */
  create(input: {
    userId: string;
    kind: string;
    identifier: string;
    secretHash: string;
  }): Promise<boolean>;

  /**
   * Replaces the hash for an EXISTING credential (password change). Returns
   * `false` if no such credential exists — which should never happen for a
   * caller who just authenticated with it, and is worth distinguishing from
   * a silent no-op if it ever does.
   */
  updateSecret(userId: string, kind: string, secretHash: string): Promise<boolean>;
}
