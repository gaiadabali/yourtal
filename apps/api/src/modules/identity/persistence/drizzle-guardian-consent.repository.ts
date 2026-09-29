import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { guardianConsents } from "./schema/guardian-consent.table";
import type {
  ConsentTransition,
  GuardianConsentRepository,
  NewGuardianConsent,
  StoredGuardianConsent,
} from "./guardian-consent.repository";

export class DrizzleGuardianConsentRepository implements GuardianConsentRepository {
  constructor(private readonly db: AppDb) {}

  async create(input: NewGuardianConsent, tx?: AppDb): Promise<void> {
    await (tx ?? this.db).insert(guardianConsents).values({
      userId: input.userId,
      tokenHash: input.tokenHash,
      guardianEmail: input.guardianEmail,
      region: input.region,
    });
  }

  async findByTokenHash(tokenHash: string): Promise<StoredGuardianConsent | null> {
    const [row] = await this.db
      .select()
      .from(guardianConsents)
      .where(eq(guardianConsents.tokenHash, tokenHash));
    return row === undefined ? null : toStored(row);
  }

  async findByUserId(userId: string): Promise<StoredGuardianConsent | null> {
    const [row] = await this.db
      .select()
      .from(guardianConsents)
      .where(eq(guardianConsents.userId, userId));
    return row === undefined ? null : toStored(row);
  }

  async approve(tokenHash: string, now: Date, tx?: AppDb): Promise<ConsentTransition> {
    const runner = tx ?? this.db;
    // One statement: still pending (neither approved nor revoked), or
    // nothing happens — same shape `DrizzleVerificationTokenRepository
    // .consume`'s own comment documents for itself.
    const claimed = await runner
      .update(guardianConsents)
      .set({ approvedAt: now, guardianConfirmedAdultAt: now, updatedAt: now })
      .where(
        and(
          eq(guardianConsents.tokenHash, tokenHash),
          sql`${guardianConsents.approvedAt} IS NULL`,
          sql`${guardianConsents.revokedAt} IS NULL`,
        ),
      )
      .returning({ userId: guardianConsents.userId, region: guardianConsents.region });

    const winner = claimed[0];
    if (winner !== undefined) {
      return { transitioned: true, userId: winner.userId, region: readRegion(winner.region) };
    }

    // Lost — but lost to what? Resolved with a read AFTER the write already
    // failed, so this cannot be part of a check-then-act race: whatever it
    // finds was already true when the UPDATE above ran.
    return classifyRefusal(runner, tokenHash);
  }

  async revoke(tokenHash: string, now: Date, tx?: AppDb): Promise<ConsentTransition> {
    const runner = tx ?? this.db;
    // Either starting state (pending or granted) qualifies — only an
    // already-revoked row (12.1.a: "revoked is final") refuses.
    //
    // 12.2.c: `approvedAt: null` here is not optional — the migration's own
    // `guardian_consent_not_both_approved_and_revoked` CHECK
    // (`approved_at IS NULL OR revoked_at IS NULL`) means revoking a row
    // that already carries an `approvedAt` (the ordinary "guardian
    // approved, then later withdrew" case — the SAME link, later, per this
    // table's own migration comment) would otherwise 500 on that
    // constraint on every real revoke-after-approve, the whole point of
    // this method. Found live: the granted -> revoked step of `/guardian/
    // [token]`'s own e2e Check 500'd until this line was added.
    const claimed = await runner
      .update(guardianConsents)
      .set({ revokedAt: now, approvedAt: null, updatedAt: now })
      .where(
        and(eq(guardianConsents.tokenHash, tokenHash), sql`${guardianConsents.revokedAt} IS NULL`),
      )
      .returning({ userId: guardianConsents.userId, region: guardianConsents.region });

    const winner = claimed[0];
    if (winner !== undefined) {
      return { transitioned: true, userId: winner.userId, region: readRegion(winner.region) };
    }

    return classifyRefusal(runner, tokenHash);
  }
}

async function classifyRefusal(db: AppDb, tokenHash: string): Promise<ConsentTransition> {
  const [existing] = await db
    .select({ approvedAt: guardianConsents.approvedAt, revokedAt: guardianConsents.revokedAt })
    .from(guardianConsents)
    .where(eq(guardianConsents.tokenHash, tokenHash));

  if (existing === undefined) {
    return { transitioned: false, reason: "not_found" };
  }
  if (existing.revokedAt !== null) {
    return { transitioned: false, reason: "already_revoked" };
  }
  return { transitioned: false, reason: "already_granted" };
}

function toStored(row: typeof guardianConsents.$inferSelect): StoredGuardianConsent {
  return {
    userId: row.userId,
    tokenHash: row.tokenHash,
    guardianEmail: row.guardianEmail,
    region: readRegion(row.region),
    guardianConfirmedAdultAt: row.guardianConfirmedAdultAt,
    approvedAt: row.approvedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

// Same convention `drizzle-user-profile.repository.ts` documents for
// itself: the migration's CHECK already constrains this column, so trusting
// the round trip matches every other hand-rolled mapper in this app.
function readRegion(value: string): Region {
  if (value === "AU" || value === "ID") return value;
  throw new Error(`identity.guardian_consent.region has an unexpected value: ${value}`);
}
