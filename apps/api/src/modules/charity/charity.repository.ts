import { sql } from "drizzle-orm";
import type {
  CharityApplicationRequest,
  CharityDetail,
  CharityState,
  PublicCharity,
} from "@yourtal/contracts/charity";
import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../shared/persistence/drizzle-client";

export const CHARITY_DB = Symbol("CHARITY_DB");

type Row = Record<string, unknown>;
const iso = (value: unknown): string | null =>
  value instanceof Date
    ? value.toISOString()
    : typeof value === "string"
      ? new Date(value).toISOString()
      : null;

/** `charity.*`, raw SQL: three small tables with no reader outside this module. */
export class CharityRepository {
  constructor(private readonly db: AppDb) {}

  async create(
    application: CharityApplicationRequest,
    appliedBy: string,
    references: { kybReference: string; payoutReference: string },
  ): Promise<CharityDetail> {
    const { rows } = await this.db.execute<Row>(sql`
      INSERT INTO charity.charity (region, name, cause, summary, logo_url, registration,
        payout_account_name, payout_account_last4, kyb_reference, payout_reference, applied_by)
      VALUES (${application.region}, ${application.name}, ${application.cause},
        ${application.summary}, ${application.logoUrl},
        ${JSON.stringify(application.registration)}::jsonb,
        ${application.payoutAccount.accountName},
        ${application.payoutAccount.accountNumber.slice(-4)},
        ${references.kybReference}, ${references.payoutReference}, ${appliedBy})
      RETURNING *`);
    return toDetail(rows[0] ?? {});
  }

  async listApproved(region: Region): Promise<PublicCharity[]> {
    const { rows } = await this.db.execute<Row>(sql`
      SELECT * FROM charity.charity WHERE region = ${region} AND state = 'approved'
       ORDER BY name`);
    return rows.map(toPublic);
  }

  async findApproved(id: string, region: Region): Promise<PublicCharity | null> {
    const { rows } = await this.db.execute<Row>(sql`
      SELECT * FROM charity.charity
       WHERE id = ${id} AND region = ${region} AND state = 'approved'`);
    return rows[0] === undefined ? null : toPublic(rows[0]);
  }

  /** The caller's own applications and the charities they administer. */
  async listMine(userId: string): Promise<CharityDetail[]> {
    const { rows } = await this.db.execute<Row>(sql`
      SELECT c.* FROM charity.charity c
       WHERE c.applied_by = ${userId}
          OR EXISTS (SELECT 1 FROM charity.member m WHERE m.charity_id = c.id AND m.user_id = ${userId})
       ORDER BY c.applied_at DESC`);
    return rows.map(toDetail);
  }

  async listForStaff(state: CharityState | null): Promise<CharityDetail[]> {
    const { rows } = await this.db.execute<Row>(sql`
      SELECT * FROM charity.charity
       WHERE ${state === null ? sql`true` : sql`state = ${state}`}
       ORDER BY applied_at DESC LIMIT 200`);
    return rows.map(toDetail);
  }

  async findDetail(id: string): Promise<CharityDetail | null> {
    const { rows } = await this.db.execute<Row>(
      sql`SELECT * FROM charity.charity WHERE id = ${id}`,
    );
    return rows[0] === undefined ? null : toDetail(rows[0]);
  }

  /** The PDP's view of one charity: region, state and its members. */
  async authzAttributes(
    id: string,
  ): Promise<{ region: Region; state: CharityState; memberIds: string[] } | null> {
    const { rows } = await this.db.execute<Row>(sql`
      SELECT c.region, c.state,
             coalesce(array_agg(m.user_id) FILTER (WHERE m.user_id IS NOT NULL), '{}') AS member_ids
        FROM charity.charity c LEFT JOIN charity.member m ON m.charity_id = c.id
       WHERE c.id = ${id} GROUP BY c.id`);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      region: row["region"] as Region,
      state: row["state"] as CharityState,
      memberIds: (row["member_ids"] as string[] | null) ?? [],
    };
  }

  /**
   * Approve or reject a pending application, with the audit row, in one
   * transaction. An approval makes the applicant the charity's first member.
   * `null` when the charity is gone or already decided.
   */
  async decide(
    id: string,
    staffUser: string,
    decision: "approve" | "reject",
    reason: string,
  ): Promise<CharityDetail | null> {
    return this.db.transaction(async (tx) => {
      const state = decision === "approve" ? "approved" : "rejected";
      const { rows } = await tx.execute<Row>(sql`
        UPDATE charity.charity
           SET state = ${state}, decided_by = ${staffUser}, decided_at = now(),
               rejection_reason = ${decision === "reject" ? reason : null}
         WHERE id = ${id} AND state = 'pending'
         RETURNING *`);
      const row = rows[0];
      if (row === undefined) return null;
      await tx.execute(sql`
        INSERT INTO charity.decision (charity_id, staff_user, decision, reason)
        VALUES (${id}, ${staffUser}, ${decision}, ${reason})`);
      if (decision === "approve") {
        await tx.execute(sql`
          INSERT INTO charity.member (charity_id, user_id) VALUES (${id}, ${String(row["applied_by"])})
          ON CONFLICT DO NOTHING`);
      }
      return toDetail(row);
    });
  }
}

function toPublic(row: Row): PublicCharity {
  return {
    id: String(row["id"]),
    region: row["region"] as Region,
    name: String(row["name"]),
    cause: row["cause"] as PublicCharity["cause"],
    summary: String(row["summary"]),
    logoUrl: (row["logo_url"] as string | null) ?? null,
  };
}

function toDetail(row: Row): CharityDetail {
  return {
    ...toPublic(row),
    state: row["state"] as CharityState,
    registration: row["registration"] as CharityDetail["registration"],
    payoutAccountName: String(row["payout_account_name"]),
    payoutAccountLast4: String(row["payout_account_last4"]),
    kybReference: String(row["kyb_reference"]),
    rejectionReason: (row["rejection_reason"] as string | null) ?? null,
    appliedAt: iso(row["applied_at"]) ?? new Date(0).toISOString(),
    decidedAt: iso(row["decided_at"]),
  };
}
