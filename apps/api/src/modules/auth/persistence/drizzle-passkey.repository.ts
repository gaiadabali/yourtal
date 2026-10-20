import { and, asc, count, eq, ne } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { PASSKEY_CREDENTIAL_KIND, PASSWORD_CREDENTIAL_KIND } from "./credential.repository";
import type {
  NewPasskey,
  PasskeyRepository,
  RemovePasskeyOutcome,
  StoredPasskey,
} from "./passkey.repository";
import { credentials } from "./schema/credential.table";
import { passkeys } from "./schema/passkey.table";

export class DrizzlePasskeyRepository implements PasskeyRepository {
  constructor(private readonly db: AppDb) {}

  async userHandleFor(userId: string, mint: () => string): Promise<string> {
    // Insert-if-absent, then read: two concurrent first registrations agree
    // on whichever handle landed first.
    await this.db
      .insert(credentials)
      .values({
        userId,
        kind: PASSKEY_CREDENTIAL_KIND,
        identifier: mint(),
        secretHash: "",
      })
      .onConflictDoNothing({ target: [credentials.userId, credentials.kind] });
    const [row] = await this.db
      .select({ identifier: credentials.identifier })
      .from(credentials)
      .where(and(eq(credentials.userId, userId), eq(credentials.kind, PASSKEY_CREDENTIAL_KIND)));
    if (row === undefined) throw new Error("passkey user handle vanished after insert");
    return row.identifier;
  }

  async userIdForHandle(handle: string): Promise<string | null> {
    const [row] = await this.db
      .select({ userId: credentials.userId })
      .from(credentials)
      .where(
        and(eq(credentials.kind, PASSKEY_CREDENTIAL_KIND), eq(credentials.identifier, handle)),
      );
    return row?.userId ?? null;
  }

  async findByCredentialId(credentialId: string): Promise<StoredPasskey | null> {
    const [row] = await this.db
      .select()
      .from(passkeys)
      .where(eq(passkeys.credentialId, credentialId));
    return row === undefined ? null : toStored(row);
  }

  async listForUser(userId: string): Promise<readonly StoredPasskey[]> {
    const rows = await this.db
      .select()
      .from(passkeys)
      .where(eq(passkeys.userId, userId))
      .orderBy(asc(passkeys.createdAt));
    return rows.map(toStored);
  }

  async create(passkey: NewPasskey): Promise<boolean> {
    const inserted = await this.db
      .insert(passkeys)
      .values({
        credentialId: passkey.credentialId,
        userId: passkey.userId,
        publicKey: passkey.publicKey,
        signCount: passkey.signCount,
        transports: [...passkey.transports],
        deviceType: passkey.deviceType,
        backedUp: passkey.backedUp,
        name: passkey.name,
      })
      .onConflictDoNothing({ target: passkeys.credentialId })
      .returning({ credentialId: passkeys.credentialId });
    return inserted.length > 0;
  }

  async recordUse(credentialId: string, signCount: number, usedAt: Date): Promise<void> {
    await this.db
      .update(passkeys)
      .set({ signCount, lastUsedAt: usedAt })
      .where(eq(passkeys.credentialId, credentialId));
  }

  async remove(userId: string, credentialId: string): Promise<RemovePasskeyOutcome> {
    return this.db.transaction(async (tx) => {
      // Lock the account's credential rows so two removals cannot each see
      // "another way in remains" and together leave none.
      const methods = await tx
        .select({ kind: credentials.kind })
        .from(credentials)
        .where(eq(credentials.userId, userId))
        .for("update");
      const [target] = await tx
        .select({ credentialId: passkeys.credentialId })
        .from(passkeys)
        .where(and(eq(passkeys.userId, userId), eq(passkeys.credentialId, credentialId)));
      if (target === undefined) return "not_found";

      const [others] = await tx
        .select({ n: count() })
        .from(passkeys)
        .where(and(eq(passkeys.userId, userId), ne(passkeys.credentialId, credentialId)));
      const otherPasskeys = others?.n ?? 0;
      const hasPassword = methods.some((method) => method.kind === PASSWORD_CREDENTIAL_KIND);
      if (!hasPassword && otherPasskeys === 0) return "last_sign_in_method";

      await tx.delete(passkeys).where(eq(passkeys.credentialId, credentialId));
      // The marker row goes with the last passkey; the next one mints a new handle.
      if (otherPasskeys === 0) {
        await tx
          .delete(credentials)
          .where(
            and(eq(credentials.userId, userId), eq(credentials.kind, PASSKEY_CREDENTIAL_KIND)),
          );
      }
      return "removed";
    });
  }
}

function toStored(row: typeof passkeys.$inferSelect): StoredPasskey {
  return {
    credentialId: row.credentialId,
    userId: row.userId,
    publicKey: row.publicKey,
    signCount: row.signCount,
    transports: row.transports,
    deviceType: row.deviceType === "multiDevice" ? "multiDevice" : "singleDevice",
    backedUp: row.backedUp,
    name: row.name,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}
