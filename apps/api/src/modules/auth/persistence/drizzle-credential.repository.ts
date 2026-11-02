import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { hasAnyFactor, lockAccount, openFactorWindow, sessionStillLive } from "./factor-lock";
import { credentials } from "./schema/credential.table";
import { sessions } from "./schema/session.table";
import {
  PASSKEY_CREDENTIAL_KIND,
  PASSWORD_CREDENTIAL_KIND,
  TOTP_CREDENTIAL_KIND,
} from "./credential.repository";
import type { Credential, CredentialRepository, StoreFactorOutcome } from "./credential.repository";

export class DrizzleCredentialRepository implements CredentialRepository {
  constructor(private readonly db: AppDb) {}

  async findByUserAndKind(userId: string, kind: string): Promise<Credential | null> {
    const [row] = await this.db
      .select()
      .from(credentials)
      .where(and(eq(credentials.userId, userId), eq(credentials.kind, kind)));
    return row ?? null;
  }

  async findByKindAndIdentifier(kind: string, identifier: string): Promise<Credential | null> {
    const [row] = await this.db
      .select()
      .from(credentials)
      .where(and(eq(credentials.kind, kind), eq(credentials.identifier, identifier)));
    return row ?? null;
  }

  async create(
    input: {
      userId: string;
      kind: string;
      identifier: string;
      secretHash: string;
    },
    tx?: AppDb,
  ): Promise<boolean> {
    // `onConflictDoNothing` targeting `(kind, identifier)` — NOT the primary
    // key. `userId` is a fresh `crypto.randomUUID()` minted by the caller
    // before this runs, so a primary-key collision on `(user_id, kind)` is
    // not a real race to defend against; the race that matters is two
    // concurrent registrations for the SAME email, which is exactly what
    // `UNIQUE (kind, identifier)` exists to catch. The empty `returning()`
    // result on conflict is how the caller learns it lost that race —
    // exactly the "attempt, don't ask-then-act" shape
    // `checkpoint-nonce.repository.ts` already documents at length for the
    // same reason (a read-then-write pair cannot be made race-free here
    // either).
    const inserted = await (tx ?? this.db)
      .insert(credentials)
      .values({
        userId: input.userId,
        kind: input.kind,
        identifier: input.identifier,
        secretHash: input.secretHash,
      })
      .onConflictDoNothing({ target: [credentials.kind, credentials.identifier] })
      .returning({ userId: credentials.userId });
    return inserted.length > 0;
  }

  async updateSecret(userId: string, kind: string, secretHash: string): Promise<boolean> {
    const updated = await this.db
      .update(credentials)
      .set({ secretHash, updatedAt: new Date() })
      .where(and(eq(credentials.userId, userId), eq(credentials.kind, kind)))
      .returning({ userId: credentials.userId });
    return updated.length > 0;
  }

  async putVerified(
    input: {
      userId: string;
      kind: string;
      identifier: string;
      secretHash: string;
      verifiedAt: Date;
    },
    windowUntil: Date,
    sessionId: string,
  ): Promise<StoreFactorOutcome> {
    return this.db.transaction(async (tx) => {
      await lockAccount(tx, input.userId, "update");
      if (!(await sessionStillLive(tx, input.userId, sessionId))) return "session_ended";
      const firstFactor = !(await hasAnyFactor(tx, input.userId));
      const written = await tx
        .insert(credentials)
        .values(input)
        .onConflictDoUpdate({
          target: [credentials.userId, credentials.kind],
          set: {
            secretHash: input.secretHash,
            verifiedAt: input.verifiedAt,
            updatedAt: new Date(),
          },
          // A verified (switched-on) credential is never replaced from here.
          setWhere: isNull(credentials.verifiedAt),
        })
        .returning({ userId: credentials.userId });
      if (written.length === 0) return "refused";
      if (firstFactor) await openFactorWindow(tx, input.userId, windowUntil);
      return "stored";
    });
  }

  async removeAllFactors(userId: string, now: Date): Promise<number> {
    return this.db.transaction(async (tx) => {
      // FOR UPDATE: a passkey or code sign-in holds FOR SHARE while it checks
      // its factor and writes its session, so none slips in around this.
      await lockAccount(tx, userId, "update");
      // The window is read under the lock, so a reset never acts on a stale one.
      const [password] = await tx
        .select({ until: credentials.factorsOpenUntil })
        .from(credentials)
        .where(and(eq(credentials.userId, userId), eq(credentials.kind, PASSWORD_CREDENTIAL_KIND)));
      const until = password?.until ?? null;
      if (until === null || until.getTime() <= now.getTime()) return 0;
      const removed = await tx
        .delete(credentials)
        .where(
          and(
            eq(credentials.userId, userId),
            inArray(credentials.kind, [PASSKEY_CREDENTIAL_KIND, TOTP_CREDENTIAL_KIND]),
          ),
        )
        .returning({ kind: credentials.kind });
      await tx
        .update(credentials)
        .set({ factorsOpenUntil: null })
        .where(and(eq(credentials.userId, userId), eq(credentials.kind, PASSWORD_CREDENTIAL_KIND)));
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
      return removed.length;
    });
  }

  async anyVerified(kind: string): Promise<boolean> {
    const [row] = await this.db
      .select({ userId: credentials.userId })
      .from(credentials)
      .where(and(eq(credentials.kind, kind), isNotNull(credentials.verifiedAt)))
      .limit(1);
    return row !== undefined;
  }

  async deleteByUserAndKind(userId: string, kind: string): Promise<boolean> {
    // Under the account lock, so a code sign-in checking the app (FOR SHARE)
    // either finishes first or sees it gone.
    return this.db.transaction(async (tx) => {
      await lockAccount(tx, userId, "update");
      const deleted = await tx
        .delete(credentials)
        .where(and(eq(credentials.userId, userId), eq(credentials.kind, kind)))
        .returning({ userId: credentials.userId });
      return deleted.length > 0;
    });
  }

  async markVerified(userId: string, kind: string, verifiedAt: Date): Promise<boolean> {
    const updated = await this.db
      .update(credentials)
      .set({ verifiedAt })
      .where(and(eq(credentials.userId, userId), eq(credentials.kind, kind)))
      .returning({ userId: credentials.userId });
    return updated.length > 0;
  }
}
