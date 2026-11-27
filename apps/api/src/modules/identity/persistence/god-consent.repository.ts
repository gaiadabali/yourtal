import { desc, eq } from "drizzle-orm";
import { GOD_GROUP_NOTICE, godConsentRecordSchema } from "@yourtal/consent/god-group-notice";
import type {
  GodConsentDecision,
  GodConsentMethod,
  GodConsentRecord,
  GodConsentTrack,
} from "@yourtal/consent/god-group-notice";
import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { godGroupConsentStatus, godGroupConsents } from "./schema/god-group-consent.table";

/** One decision to record. The notice and its version are always the current ones. */
export interface NewGodConsent {
  readonly userId: string;
  readonly region: Region;
  readonly decision: GodConsentDecision;
  readonly method: GodConsentMethod;
  readonly track: GodConsentTrack;
  readonly guardianUserId?: string;
}

/**
 * `identity.god_group_consent` (god/TASKS.md 9.1). Append-only: there is no
 * update or delete here, and the grant (INSERT and SELECT) refuses one anyway.
 * `current` reads the trigger-kept status row, one indexed lookup.
 */
export interface GodConsentRepository {
  /** `tx`: so registration, guardian approval and revocation record it in their own transaction. */
  append(input: NewGodConsent, now: Date, tx?: AppDb): Promise<void>;
  current(userId: string): Promise<GodConsentRecord | null>;
  /** Every decision, newest first, for the person's data export. */
  history(userId: string): Promise<GodConsentRecord[]>;
}

export const GOD_CONSENT_REPOSITORY = Symbol("GOD_CONSENT_REPOSITORY");

export class DrizzleGodConsentRepository implements GodConsentRepository {
  constructor(private readonly db: AppDb) {}

  async append(input: NewGodConsent, now: Date, tx?: AppDb): Promise<void> {
    await (tx ?? this.db).insert(godGroupConsents).values({
      userId: input.userId,
      region: input.region,
      noticeId: GOD_GROUP_NOTICE.id,
      noticeVersion: GOD_GROUP_NOTICE.version,
      decision: input.decision,
      method: input.method,
      track: input.track,
      guardianUserId: input.guardianUserId ?? null,
      recordedAt: now,
    });
  }

  async current(userId: string): Promise<GodConsentRecord | null> {
    const [row] = await this.db
      .select()
      .from(godGroupConsentStatus)
      .where(eq(godGroupConsentStatus.userId, userId));
    return row === undefined ? null : parse({ ...row, recordedAt: row.decidedAt });
  }

  async history(userId: string): Promise<GodConsentRecord[]> {
    const rows = await this.db
      .select()
      .from(godGroupConsents)
      .where(eq(godGroupConsents.userId, userId))
      .orderBy(desc(godGroupConsents.recordedAt), desc(godGroupConsents.id));
    return rows.map(parse);
  }
}

interface Row {
  readonly userId: string;
  readonly region: string;
  readonly noticeId: string;
  readonly noticeVersion: string;
  readonly decision: string;
  readonly method: string;
  readonly track: string;
  readonly guardianUserId: string | null;
  readonly recordedAt: Date;
}

// Parsed, not cast: a row the contract rejects is a bug worth failing on.
function parse(row: Row): GodConsentRecord {
  return godConsentRecordSchema.parse({
    userId: row.userId,
    region: row.region,
    noticeId: row.noticeId,
    noticeVersion: row.noticeVersion,
    decision: row.decision,
    method: row.method,
    track: row.track,
    guardianUserId: row.guardianUserId,
    recordedAt: row.recordedAt.toISOString(),
  });
}
