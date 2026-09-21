import { and, eq, lt } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { verificationTokens } from "./schema/verification-token.table";
import type {
  ConsumeResult,
  VerificationPurpose,
  VerificationTokenRepository,
} from "./verification-token.repository";

export class DrizzleVerificationTokenRepository implements VerificationTokenRepository {
  constructor(private readonly db: AppDb) {}

  async create(input: {
    id: string;
    userId: string;
    purpose: VerificationPurpose;
    expiresAt: Date;
  }): Promise<void> {
    await this.db.insert(verificationTokens).values({
      id: input.id,
      userId: input.userId,
      purpose: input.purpose,
      expiresAt: input.expiresAt,
    });
  }

  async consume(id: string, purpose: VerificationPurpose, now: Date): Promise<ConsumeResult> {
    // One statement: unconsumed, right purpose, not yet expired, or nothing
    // happens. `sql\`${...} IS NULL\`` rather than Drizzle's `isNull()`
    // helper only because this sits alongside two other conditions built
    // with `and`/`eq`/`lt` already imported for the classification query
    // below — using one style throughout this file.
    const claimed = await this.db
      .update(verificationTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(verificationTokens.id, id),
          eq(verificationTokens.purpose, purpose),
          sql`${verificationTokens.consumedAt} IS NULL`,
          sql`${verificationTokens.expiresAt} > ${now.toISOString()}`,
        ),
      )
      .returning({ userId: verificationTokens.userId });

    const winner = claimed[0];
    if (winner !== undefined) {
      return { consumed: true, userId: winner.userId };
    }

    // Lost — but lost to what? Resolved with a read AFTER the write already
    // failed, so this cannot be part of a check-then-act race: whatever it
    // finds was already true when the UPDATE above ran.
    const [existing] = await this.db
      .select({
        consumedAt: verificationTokens.consumedAt,
        expiresAt: verificationTokens.expiresAt,
      })
      .from(verificationTokens)
      .where(and(eq(verificationTokens.id, id), eq(verificationTokens.purpose, purpose)));

    if (existing === undefined) {
      return { consumed: false, refusal: "not_found" };
    }
    if (existing.consumedAt !== null) {
      return { consumed: false, refusal: "already_consumed" };
    }
    return { consumed: false, refusal: "expired" };
  }

  async pruneExpired(now: Date): Promise<number> {
    const removed = await this.db
      .delete(verificationTokens)
      .where(lt(verificationTokens.expiresAt, now))
      .returning({ id: verificationTokens.id });
    return removed.length;
  }
}
