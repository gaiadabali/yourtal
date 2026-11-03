import { and, asc, count, eq, lt, ne } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { PASSKEY_CREDENTIAL_KIND, PASSWORD_CREDENTIAL_KIND } from "./credential.repository";
import type { StoreFactorOutcome } from "./credential.repository";
import type {
  NewPasskey,
  PasskeyRepository,
  RemovePasskeyOutcome,
  StoredPasskey,
} from "./passkey.repository";
import { hasAnyFactor, lockAccount, openFactorWindow, sessionStillLive } from "./factor-lock";
import { credentials } from "./schema/credential.table";
import { passkeys } from "./schema/passkey.table";

/** Thrown inside `create`'s transaction to roll it back. */
class NotStored extends Error {
  constructor(readonly outcome: StoreFactorOutcome) {
    super(outcome);
  }
}

export class DrizzlePasskeyRepository implements PasskeyRepository {
  constructor(private readonly db: AppDb) {}

  async userHandleOf(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ identifier: credentials.identifier })
      .from(credentials)
      .where(and(eq(credentials.userId, userId), eq(credentials.kind, PASSKEY_CREDENTIAL_KIND)));
    return row?.identifier ?? null;
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

  async create(
    passkey: NewPasskey,
    userHandle: string,
    windowUntil: Date,
    sessionId: string,
  ): Promise<StoreFactorOutcome> {
    return this.db
      .transaction(async (tx): Promise<StoreFactorOutcome> => {
        await lockAccount(tx, passkey.userId, "update");
        if (!(await sessionStillLive(tx, passkey.userId, sessionId))) return "session_ended";
        const firstFactor = !(await hasAnyFactor(tx, passkey.userId));
        // The marker row arrives with the first passkey, never before.
        await tx
          .insert(credentials)
          .values({
            userId: passkey.userId,
            kind: PASSKEY_CREDENTIAL_KIND,
            identifier: userHandle,
            secretHash: "",
          })
          .onConflictDoNothing({ target: [credentials.userId, credentials.kind] });
        const [marker] = await tx
          .select({ identifier: credentials.identifier })
          .from(credentials)
          .where(
            and(
              eq(credentials.userId, passkey.userId),
              eq(credentials.kind, PASSKEY_CREDENTIAL_KIND),
            ),
          )
          .for("update");
        // Made for another handle: signing in with it would never match.
        if (marker?.identifier !== userHandle) throw new NotStored("refused");
        const inserted = await tx
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
        // A duplicate credential id must not leave a fresh marker row behind.
        if (inserted.length === 0) throw new NotStored("refused");
        if (firstFactor) await openFactorWindow(tx, passkey.userId, windowUntil);
        return "stored";
      })
      .catch((cause: unknown) => {
        if (cause instanceof NotStored) return cause.outcome;
        throw cause;
      });
  }

  async recordUse(credentialId: string, signCount: number, usedAt: Date): Promise<boolean> {
    const updated = await this.db
      .update(passkeys)
      .set({ signCount, lastUsedAt: usedAt })
      // sign_count < new, or new = 0 (an authenticator with no counter; the
      // library already refused a zero after a non-zero).
      .where(
        signCount === 0
          ? eq(passkeys.credentialId, credentialId)
          : and(eq(passkeys.credentialId, credentialId), lt(passkeys.signCount, signCount)),
      )
      .returning({ credentialId: passkeys.credentialId });
    return updated.length > 0;
  }

  async remove(userId: string, credentialId: string): Promise<RemovePasskeyOutcome> {
    return this.db.transaction(async (tx) => {
      // The account lock first, in the order `create` takes it, then every
      // credential row (a passkey-only account has no password row to lock)
      // so two removals cannot each see "another way in remains".
      await lockAccount(tx, userId, "update");
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
