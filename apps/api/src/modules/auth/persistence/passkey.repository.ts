export const PASSKEY_REPOSITORY = Symbol("PASSKEY_REPOSITORY");

export interface StoredPasskey {
  readonly credentialId: string;
  readonly userId: string;
  readonly publicKey: Buffer;
  readonly signCount: number;
  readonly transports: readonly string[];
  readonly deviceType: "singleDevice" | "multiDevice";
  readonly backedUp: boolean;
  readonly name: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  /** Added from a password-only session to an account with no other factor. */
  readonly bootstrapped: boolean;
}

export type NewPasskey = Omit<StoredPasskey, "createdAt" | "lastUsedAt">;

export type RemovePasskeyOutcome = "removed" | "not_found" | "last_sign_in_method";

export interface PasskeyRepository {
  /**
   * The account's WebAuthn user handle, or null before its first passkey.
   * Random, so an authenticator never holds the internal user id.
   */
  userHandleOf(userId: string): Promise<string | null>;
  /** The account a user handle belongs to, if any. */
  userIdForHandle(handle: string): Promise<string | null>;
  findByCredentialId(credentialId: string): Promise<StoredPasskey | null>;
  listForUser(userId: string): Promise<readonly StoredPasskey[]>;
  /**
   * Stores a passkey made for `userHandle`, writing the account's marker row
   * (with that handle) if this is its first. `false`, storing nothing, when
   * the credential id is already registered (to anyone) or the account
   * already has a different handle (a concurrent first registration won).
   */
  create(passkey: NewPasskey, userHandle: string): Promise<boolean>;
  /**
   * Moves the signature counter forward. `false` when another sign-in already
   * moved it as far: a non-zero counter must grow, so two sign-ins racing
   * with the same counter cannot both count.
   */
  recordUse(credentialId: string, signCount: number, usedAt: Date): Promise<boolean>;
  /**
   * Removes one of the user's passkeys, refusing when nothing else could sign
   * the person in afterwards (no password and no other passkey).
   */
  remove(userId: string, credentialId: string): Promise<RemovePasskeyOutcome>;
}
