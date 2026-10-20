import { sql } from "drizzle-orm";
import type { BudgetAlert } from "@yourtal/contracts/billing";
import { toPoints } from "@yourtal/contracts/money";
import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../../shared/persistence/drizzle-client";

export const BUDGET_ALERTS = Symbol("BUDGET_ALERTS");

export type AlertKind = BudgetAlert["kind"];
export type Threshold = BudgetAlert["thresholdPct"];

export interface NewAlert {
  readonly businessId: string;
  readonly region: Region;
  readonly kind: AlertKind;
  readonly subjectId: string;
  readonly thresholdPct: Threshold;
  readonly usedPoints: number;
  readonly totalPoints: number;
}

export interface UnnotifiedAlert extends NewAlert {
  readonly id: string;
  readonly campaignTitle: string | null;
}

export interface CampaignCandidate {
  readonly campaignId: string;
  readonly businessId: string;
  readonly region: Region;
  readonly budgetPoints: number;
}

export interface Recipient {
  readonly userId: string;
  readonly email: string;
  readonly locale: "en-AU" | "id-ID";
}

/** `payment.budget_alert`, raw SQL. An alert is inserted once per subject and threshold. */
export class BudgetAlertRepository {
  constructor(private readonly db: AppDb) {}

  /**
   * Packages to check: every allocation a campaign draws on or a card purchase
   * funded, until its 100% alert is raised. A partner allocation is used only
   * through these today; the ledger says whose it is and how much is left.
   */
  async packageCandidates(): Promise<string[]> {
    const { rows } = await this.db.execute<{ allocation_id: string }>(sql`
      SELECT DISTINCT allocation_id FROM (
        SELECT allocation_id FROM campaign.reward_config
        UNION
        SELECT allocation_id FROM payment.card_purchase
         WHERE status = 'paid' AND allocation_id IS NOT NULL
      ) a
      WHERE NOT EXISTS (
        SELECT 1 FROM payment.budget_alert b
         WHERE b.subject_kind = 'package' AND b.subject_id = a.allocation_id AND b.threshold_pct = 100)`);
    return rows.map((row) => row.allocation_id);
  }

  /** Campaign budgets to check (14.2's max_points_for_campaign), until their 100% alert. */
  async campaignCandidates(): Promise<CampaignCandidate[]> {
    const { rows } = await this.db.execute<{
      campaign_id: string;
      business_id: string;
      region: Region;
      budget: string;
    }>(sql`
      SELECT r.campaign_id, c.business_id, c.region, r.max_points_for_campaign AS budget
        FROM campaign.reward_config r
        JOIN campaign.campaigns c ON c.id = r.campaign_id
       WHERE NOT EXISTS (
         SELECT 1 FROM payment.budget_alert b
          WHERE b.subject_kind = 'campaign' AND b.subject_id = r.campaign_id::text
            AND b.threshold_pct = 100)`);
    return rows.map((row) => ({
      campaignId: row.campaign_id,
      businessId: row.business_id,
      region: row.region,
      budgetPoints: Number(row.budget),
    }));
  }

  /** True when this call raised the alert; false when it was already raised. */
  async raise(alert: NewAlert): Promise<boolean> {
    const { rows } = await this.db.execute(sql`
      INSERT INTO payment.budget_alert
        (business_id, region, subject_kind, subject_id, threshold_pct, used_points, total_points)
      VALUES (${alert.businessId}, ${alert.region}, ${alert.kind}, ${alert.subjectId},
              ${alert.thresholdPct}, ${alert.usedPoints}, ${alert.totalPoints})
      ON CONFLICT ON CONSTRAINT budget_alert_once DO NOTHING
      RETURNING id`);
    return rows.length === 1;
  }

  /** Alerts nobody has been told about yet, oldest first. */
  async unnotified(limit = 200): Promise<UnnotifiedAlert[]> {
    const { rows } = await this.db.execute(sql`
      SELECT b.*, c.title AS campaign_title
        FROM payment.budget_alert b
        LEFT JOIN campaign.campaigns c
          ON b.subject_kind = 'campaign' AND c.id::text = b.subject_id
       WHERE b.notified_at IS NULL
       ORDER BY b.created_at
       LIMIT ${limit}`);
    return rows.map((row) => ({
      ...toNewAlert(row),
      id: String(row["id"]),
      campaignTitle: title(row),
    }));
  }

  async markNotified(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.execute(sql`
      UPDATE payment.budget_alert SET notified_at = now()
       WHERE id IN (${sql.join(
         ids.map((id) => sql`${id}::uuid`),
         sql`, `,
       )}) AND notified_at IS NULL`);
  }

  async listForBusiness(businessId: string, limit = 50): Promise<BudgetAlert[]> {
    const { rows } = await this.db.execute(sql`
      SELECT b.*, c.title AS campaign_title
        FROM payment.budget_alert b
        LEFT JOIN campaign.campaigns c
          ON b.subject_kind = 'campaign' AND c.id::text = b.subject_id
       WHERE b.business_id = ${businessId}
       ORDER BY b.created_at DESC, b.threshold_pct DESC
       LIMIT ${limit}`);
    return rows.map((row) => {
      const alert = toNewAlert(row);
      return {
        id: String(row["id"]),
        kind: alert.kind,
        subjectId: alert.subjectId,
        campaignTitle: title(row),
        thresholdPct: alert.thresholdPct,
        usedPoints: toPoints(alert.usedPoints),
        totalPoints: toPoints(alert.totalPoints),
        createdAt: new Date(String(row["created_at"])).toISOString(),
      };
    });
  }

  /** The business's owner and finance members who have joined and verified their email. */
  async recipients(businessId: string): Promise<Recipient[]> {
    const { rows } = await this.db.execute<{
      user_id: string;
      email: string;
      locale: string;
    }>(sql`
      SELECT DISTINCT m.user_id, c.identifier AS email, p.display_locale AS locale
        FROM business.business_members m
        JOIN identity.credential c
          ON c.user_id = m.user_id AND c.kind = 'password' AND c.verified_at IS NOT NULL
        JOIN identity.user_profile p ON p.user_id = m.user_id
       WHERE m.business_id = ${businessId} AND m.role IN ('owner', 'finance')
         AND m.joined_at IS NOT NULL
       ORDER BY m.user_id`);
    return rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      locale: row.locale === "id-ID" ? "id-ID" : "en-AU",
    }));
  }
}

function title(row: Record<string, unknown>): string | null {
  return typeof row["campaign_title"] === "string" ? row["campaign_title"] : null;
}

function toNewAlert(row: Record<string, unknown>): NewAlert {
  return {
    businessId: String(row["business_id"]),
    region: row["region"] as Region,
    kind: row["subject_kind"] as AlertKind,
    subjectId: String(row["subject_id"]),
    thresholdPct: Number(row["threshold_pct"]) as Threshold,
    usedPoints: Number(row["used_points"]),
    totalPoints: Number(row["total_points"]),
  };
}
