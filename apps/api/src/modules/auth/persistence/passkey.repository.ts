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
}

export type NewPasskey = Omit<StoredPasskey, "createdAt" | "lastUsedAt">;

export type RemovePasskeyOutcome = "removed" | "not_found" | "last_sign_in_method";

export interface PasskeyRepository {
  /**
   * The account's WebAuthn user handle, created on first use. Random, so an
   * authenticator never holds the internal user id.
   */
  userHandleFor(userId: string, mint: () => string): Promise<string>;
  /** The account a user handle belongs to, if any. */
  userIdForHandle(handle: string): Promise<string | null>;
  findByCredentialId(credentialId: string): Promise<StoredPasskey | null>;
  listForUser(userId: string): Promise<readonly StoredPasskey[]>;
  /** `false` when the credential id is already registered (to anyone). */
  create(passkey: NewPasskey): Promise<boolean>;
  recordUse(credentialId: string, signCount: number, usedAt: Date): Promise<void>;
  /**
   * Removes one of the user's passkeys, refusing when nothing else could sign
   * the person in afterwards (no password and no other passkey).
   */
  remove(userId: string, credentialId: string): Promise<RemovePasskeyOutcome>;
}
