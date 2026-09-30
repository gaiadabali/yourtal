import { sql } from "drizzle-orm";
import type { BoostCharge, BoostState } from "@yourtal/contracts/studio/boost";
import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { BoostBid } from "./boost-auction";

/** F16: one clock per region; a boost day is a calendar day on it. */
const REGION_TZ: Readonly<Record<Region, string>> = {
  AU: "Australia/Sydney",
  ID: "Asia/Jakarta",
};
const dayIn = (region: Region) => sql`(now() AT TIME ZONE ${REGION_TZ[region]})::date`;

export interface BoostSettingRow {
  readonly campaignId: string;
  readonly businessId: string;
  readonly region: Region;
  readonly currency: "AUD" | "IDR";
  readonly dailyBudgetMinor: number;
  readonly maxBidCpmMinor: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly state: BoostState;
}

export interface BoostTotals {
  readonly days: readonly { day: string; impressions: number; spentMilli: number }[];
  readonly priceSum: number;
}

const iso = (value: unknown) => new Date(String(value)).toISOString();

/** `feed.boost*`, raw SQL: four small tables with no reader outside this folder. */
export class BoostRepository {
  constructor(private readonly db: AppDb) {}

  async find(campaignId: string): Promise<BoostSettingRow | null> {
    const { rows } = await this.db.execute(sql`
      SELECT * FROM feed.boost WHERE campaign_id = ${campaignId}`);
    const row = rows[0];
    return row === undefined ? null : toSetting(row);
  }

  async upsert(setting: BoostSettingRow): Promise<BoostSettingRow> {
    const { rows } = await this.db.execute(sql`
      INSERT INTO feed.boost (campaign_id, business_id, region, currency, daily_budget_minor,
                              max_bid_cpm_minor, starts_at, ends_at, state)
      VALUES (${setting.campaignId}, ${setting.businessId}, ${setting.region}, ${setting.currency},
              ${setting.dailyBudgetMinor}, ${setting.maxBidCpmMinor}, ${setting.startsAt},
              ${setting.endsAt}, ${setting.state})
      ON CONFLICT (campaign_id) DO UPDATE SET
        daily_budget_minor = EXCLUDED.daily_budget_minor,
        max_bid_cpm_minor = EXCLUDED.max_bid_cpm_minor,
        starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
        state = EXCLUDED.state, updated_at = now()
      RETURNING *`);
    return toSetting(rows[0] ?? {});
  }

  /** Active, in-window boosts among these campaigns, with today's spend on the region clock. */
  async bidsFor(region: Region, campaignIds: readonly string[]): Promise<BoostBid[]> {
    if (campaignIds.length === 0) return [];
    const { rows } = await this.db.execute(sql`
      SELECT b.campaign_id, b.max_bid_cpm_minor, b.daily_budget_minor,
             coalesce(s.spent_milli, 0) AS spent_milli
        FROM feed.boost b
        LEFT JOIN feed.boost_spend_day s ON s.campaign_id = b.campaign_id AND s.day = ${dayIn(region)}
       WHERE b.region = ${region} AND b.state = 'active'
         AND b.starts_at <= now() AND b.ends_at > now()
         AND b.campaign_id IN (${sql.join(
           campaignIds.map((id) => sql`${id}`),
           sql`, `,
         )})`);
    return rows.map((row) => ({
      campaignId: String(row["campaign_id"]),
      maxBidCpmMinor: Number(row["max_bid_cpm_minor"]),
      dailyBudgetMinor: Number(row["daily_budget_minor"]),
      spentMilliToday: Number(row["spent_milli"]),
    }));
  }

  /**
   * Books one won impression if the day's budget still covers it, atomically:
   * the spend row only moves when the new total fits. `false` means another
   * feed spent the last of the budget first.
   */
  async recordWin(
    region: Region,
    campaignId: string,
    slot: number,
    priceCpmMinor: number,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.execute(sql`
        INSERT INTO feed.boost_spend_day (campaign_id, day, impressions, spent_milli)
        SELECT ${campaignId}, ${dayIn(region)}, 1, ${priceCpmMinor}
          FROM feed.boost b
         WHERE b.campaign_id = ${campaignId} AND ${priceCpmMinor} <= b.daily_budget_minor * 1000
        ON CONFLICT (campaign_id, day) DO UPDATE SET
          impressions = feed.boost_spend_day.impressions + 1,
          spent_milli = feed.boost_spend_day.spent_milli + EXCLUDED.spent_milli
        WHERE feed.boost_spend_day.spent_milli + EXCLUDED.spent_milli <=
              (SELECT daily_budget_minor * 1000 FROM feed.boost WHERE campaign_id = ${campaignId})
        RETURNING campaign_id`);
      if (rows.length === 0) return false;
      await tx.execute(sql`
        INSERT INTO feed.boost_impression (campaign_id, region, day, slot, price_cpm_minor)
        VALUES (${campaignId}, ${region}, ${dayIn(region)}, ${slot}, ${priceCpmMinor})`);
      return true;
    });
  }

  async totals(campaignId: string): Promise<BoostTotals> {
    const [days, sum] = await Promise.all([
      this.db.execute(sql`
        SELECT day::text AS day, impressions, spent_milli FROM feed.boost_spend_day
         WHERE campaign_id = ${campaignId} ORDER BY day DESC LIMIT 31`),
      this.db.execute(sql`
        SELECT coalesce(sum(price_cpm_minor), 0) AS price_sum FROM feed.boost_impression
         WHERE campaign_id = ${campaignId}`),
    ]);
    return {
      days: days.rows.map((row) => ({
        day: String(row["day"]),
        impressions: Number(row["impressions"]),
        spentMilli: Number(row["spent_milli"]),
      })),
      priceSum: Number(sum.rows[0]?.["price_sum"] ?? 0),
    };
  }

  async charges(businessId: string): Promise<BoostCharge[]> {
    const { rows } = await this.db.execute(sql`
      SELECT c.*, c.day::text AS day_text, cc.title
        FROM feed.boost_charge c JOIN campaign.campaigns cc ON cc.id = c.campaign_id
       WHERE c.business_id = ${businessId} ORDER BY c.day DESC, c.charged_at DESC LIMIT 200`);
    return rows.map((row) => ({
      id: String(row["id"]),
      campaignId: String(row["campaign_id"]),
      campaignTitle: String(row["title"]),
      day: String(row["day_text"]),
      impressions: Number(row["impressions"]),
      amountMinor: Number(row["amount_minor"]) as BoostCharge["amountMinor"],
      currency: row["currency"] as BoostCharge["currency"],
      providerReference: String(row["provider_reference"]),
      chargedAt: iso(row["charged_at"]),
    }));
  }
}

function toSetting(row: Record<string, unknown>): BoostSettingRow {
  return {
    campaignId: String(row["campaign_id"]),
    businessId: String(row["business_id"]),
    region: row["region"] as Region,
    currency: row["currency"] as "AUD" | "IDR",
    dailyBudgetMinor: Number(row["daily_budget_minor"]),
    maxBidCpmMinor: Number(row["max_bid_cpm_minor"]),
    startsAt: iso(row["starts_at"]),
    endsAt: iso(row["ends_at"]),
    state: row["state"] as BoostState,
  };
}

/** A day's charge: thousandths rounded up to a whole minor unit. */
export function spendMinorOf(spentMilli: number): number {
  return Math.ceil(spentMilli / 1000);
}
