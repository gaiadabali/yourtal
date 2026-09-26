import { and, desc, eq } from "drizzle-orm";
import { consentRecordSchema } from "@yourtal/consent/consent-record";
import type { ConsentRecord } from "@yourtal/consent/consent-record";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { consentRecords } from "./schema/consent-record.table";

/**
 * `identity.consent_record` (5.4.a). Append-only: there is no `update` or
 * `delete` here on purpose — a withdrawal is `append`ed as a new record, per
 * `@yourtal/consent/consent-record`'s own doc comment, and the Postgres
 * grant (INSERT/SELECT only) would refuse anything else regardless.
 */
export interface ConsentRecordRepository {
  append(record: ConsentRecord): Promise<void>;
  /** Every record for this user, newest first — `latestPerPurpose` narrows it further. */
  listForUser(userId: string): Promise<ConsentRecord[]>;
}

export const CONSENT_RECORD_REPOSITORY = Symbol("CONSENT_RECORD_REPOSITORY");

export class DrizzleConsentRecordRepository implements ConsentRecordRepository {
  constructor(private readonly db: AppDb) {}

  async append(record: ConsentRecord): Promise<void> {
    await this.db.insert(consentRecords).values({
      userId: record.userId,
      purpose: record.purpose,
      jurisdiction: record.jurisdiction,
      policyVersionId: record.policyVersionId,
      state: record.state,
      recordedAt: new Date(record.recordedAt),
      source: record.source,
    });
  }

  async listForUser(userId: string): Promise<ConsentRecord[]> {
    const rows = await this.db
      .select()
      .from(consentRecords)
      .where(and(eq(consentRecords.userId, userId)))
      .orderBy(desc(consentRecords.recordedAt));

    // Parsed, not cast — a row the contract rejects is a bug worth failing
    // on (same convention as DrizzleWatchSessionRepository.findById).
    return rows.map((row) =>
      consentRecordSchema.parse({
        userId: row.userId,
        purpose: row.purpose,
        jurisdiction: row.jurisdiction,
        policyVersionId: row.policyVersionId,
        state: row.state,
        recordedAt: row.recordedAt.toISOString(),
        source: row.source,
      }),
    );
  }
}
