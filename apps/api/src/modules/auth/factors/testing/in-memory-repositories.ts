import {
  PASSKEY_CREDENTIAL_KIND,
  PASSWORD_CREDENTIAL_KIND,
} from "../../persistence/credential.repository";
import type { Credential, CredentialRepository } from "../../persistence/credential.repository";
import type {
  NewPasskey,
  PasskeyRepository,
  RemovePasskeyOutcome,
  StoredPasskey,
} from "../../persistence/passkey.repository";

/** `identity.credential` in memory, for unit tests. */
export class InMemoryCredentialRepository implements CredentialRepository {
  readonly rows = new Map<string, Credential>();

  private key(userId: string, kind: string): string {
    return `${userId}|${kind}`;
  }

  findByUserAndKind(userId: string, kind: string): Promise<Credential | null> {
    return Promise.resolve(this.rows.get(this.key(userId, kind)) ?? null);
  }

  findByKindAndIdentifier(kind: string, identifier: string): Promise<Credential | null> {
    const found = [...this.rows.values()].find(
      (row) => row.kind === kind && row.identifier === identifier,
    );
    return Promise.resolve(found ?? null);
  }

  create(input: {
    userId: string;
    kind: string;
    identifier: string;
    secretHash: string;
  }): Promise<boolean> {
    if (this.rows.has(this.key(input.userId, input.kind))) return Promise.resolve(false);
    this.rows.set(this.key(input.userId, input.kind), {
      ...input,
      updatedAt: new Date(),
      verifiedAt: null,
      bootstrapped: false,
    });
    return Promise.resolve(true);
  }

  updateSecret(userId: string, kind: string, secretHash: string): Promise<boolean> {
    const row = this.rows.get(this.key(userId, kind));
    if (row === undefined) return Promise.resolve(false);
    this.rows.set(this.key(userId, kind), { ...row, secretHash });
    return Promise.resolve(true);
  }

  markVerified(userId: string, kind: string, verifiedAt: Date): Promise<boolean> {
    const row = this.rows.get(this.key(userId, kind));
    if (row === undefined) return Promise.resolve(false);
    this.rows.set(this.key(userId, kind), { ...row, verifiedAt });
    return Promise.resolve(true);
  }

  putVerified(input: {
    userId: string;
    kind: string;
    identifier: string;
    secretHash: string;
    verifiedAt: Date;
    bootstrapped: boolean;
  }): Promise<boolean> {
    const row = this.rows.get(this.key(input.userId, input.kind));
    if (row !== undefined && row.verifiedAt !== null) return Promise.resolve(false);
    this.rows.set(this.key(input.userId, input.kind), { ...input, updatedAt: new Date() });
    return Promise.resolve(true);
  }

  anyVerified(kind: string): Promise<boolean> {
    return Promise.resolve(
      [...this.rows.values()].some((row) => row.kind === kind && row.verifiedAt !== null),
    );
  }

  deleteByUserAndKind(userId: string, kind: string): Promise<boolean> {
    return Promise.resolve(this.rows.delete(this.key(userId, kind)));
  }
}

/** `identity.passkey` in memory, sharing the credential fake for the marker row. */
export class InMemoryPasskeyRepository implements PasskeyRepository {
  readonly rows = new Map<string, StoredPasskey>();

  constructor(private readonly credentials: InMemoryCredentialRepository) {}

  async userHandleOf(userId: string): Promise<string | null> {
    const row = await this.credentials.findByUserAndKind(userId, PASSKEY_CREDENTIAL_KIND);
    return row?.identifier ?? null;
  }

  async userIdForHandle(handle: string): Promise<string | null> {
    const row = await this.credentials.findByKindAndIdentifier(PASSKEY_CREDENTIAL_KIND, handle);
    return row?.userId ?? null;
  }

  findByCredentialId(credentialId: string): Promise<StoredPasskey | null> {
    return Promise.resolve(this.rows.get(credentialId) ?? null);
  }

  listForUser(userId: string): Promise<readonly StoredPasskey[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => row.userId === userId));
  }

  async create(passkey: NewPasskey, userHandle: string): Promise<boolean> {
    if (this.rows.has(passkey.credentialId)) return false;
    await this.credentials.create({
      userId: passkey.userId,
      kind: PASSKEY_CREDENTIAL_KIND,
      identifier: userHandle,
      secretHash: "",
    });
    if ((await this.userHandleOf(passkey.userId)) !== userHandle) return false;
    this.rows.set(passkey.credentialId, { ...passkey, createdAt: new Date(), lastUsedAt: null });
    return true;
  }

  recordUse(credentialId: string, signCount: number, usedAt: Date): Promise<boolean> {
    const row = this.rows.get(credentialId);
    if (row === undefined || (signCount !== 0 && row.signCount >= signCount)) {
      return Promise.resolve(false);
    }
    this.rows.set(credentialId, { ...row, signCount, lastUsedAt: usedAt });
    return Promise.resolve(true);
  }

  async remove(userId: string, credentialId: string): Promise<RemovePasskeyOutcome> {
    const target = this.rows.get(credentialId);
    if (target?.userId !== userId) return "not_found";
    const others = (await this.listForUser(userId)).length - 1;
    const password = await this.credentials.findByUserAndKind(userId, PASSWORD_CREDENTIAL_KIND);
    if (password === null && others === 0) return "last_sign_in_method";
    this.rows.delete(credentialId);
    if (others === 0) await this.credentials.deleteByUserAndKind(userId, PASSKEY_CREDENTIAL_KIND);
    return "removed";
  }
}
