import { sql } from "drizzle-orm";
import { Logger } from "@nestjs/common";
import { consentRecordSchema } from "@yourtal/consent/consent-record";
import type { ConsentRecord } from "@yourtal/consent/consent-record";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { FeedSignalsRepository } from "./feed-signals.repository";

const logger = new Logger("DrizzleFeedSignalsRepository");

export class DrizzleFeedSignalsRepository implements FeedSignalsRepository {
  constructor(private readonly db: AppDb) {}

  async followedBusinessIds(userId: string): Promise<ReadonlySet<string>> {
    const result = await this.db.execute<{ business_id: string }>(sql`
      SELECT business_id FROM me.follow WHERE user_id = ${userId}
    `);
    return new Set(result.rows.map((row) => row.business_id));
  }

  async declaredInterestNodeIds(userId: string): Promise<readonly string[]> {
    const result = await this.db.execute<{ node_id: string }>(sql`
      SELECT node_id FROM me.interest WHERE user_id = ${userId}
    `);
    return result.rows.map((row) => row.node_id);
  }

  async consentRecordsFor(userId: string): Promise<readonly ConsentRecord[]> {
    const result = await this.db.execute<{
      user_id: string;
      purpose: string;
      jurisdiction: string;
      policy_version_id: string;
      state: string;
      recorded_at: string;
      source: string;
    }>(sql`
      SELECT user_id, purpose, jurisdiction, policy_version_id, state, recorded_at, source
        FROM identity.consent_record WHERE user_id = ${userId}
       ORDER BY recorded_at DESC
    `);
    // `safeParse`, not `parse`: `mayUseSignalFor`'s whole design is "every
    // failure mode resolves to a denial" (consent-query.ts's own doc
    // comment), and a record this feed cannot even parse is exactly that
    // kind of failure -- dropping it (rather than 500ing the whole feed for
    // one bad row) is the SAFE direction, since fewer records can only ever
    // turn an allow into a deny, never the reverse.
    return result.rows
      .map((row) =>
        consentRecordSchema.safeParse({
          userId: row.user_id,
          purpose: row.purpose,
          jurisdiction: row.jurisdiction,
          policyVersionId: row.policy_version_id,
          state: row.state,
          recordedAt: new Date(row.recorded_at).toISOString(),
          source: row.source,
        }),
      )
      .flatMap((parsed) => {
        if (parsed.success) return [parsed.data];
        logger.error(
          `identity.consent_record row for a feed viewer failed to parse: ${JSON.stringify(parsed.error.issues)}`,
        );
        return [];
      });
  }

  async segmentSizeFor(nodeId: string): Promise<number> {
    const result = await this.db.execute<{ count: string }>(sql`
      SELECT count(DISTINCT user_id) AS count FROM me.interest WHERE node_id = ${nodeId}
    `);
    return Number(result.rows[0]?.count ?? 0);
  }

  async alreadyEarnedCampaignIds(userId: string): Promise<ReadonlySet<string>> {
    const result = await this.db.execute<{ campaign_id: string }>(sql`
      SELECT DISTINCT campaign_id FROM watch.session WHERE user_id = ${userId} AND granted = true
    `);
    return new Set(result.rows.map((row) => row.campaign_id));
  }

  async demotedCampaignIds(userId: string): Promise<ReadonlySet<string>> {
    const result = await this.db.execute<{ campaign_id: string }>(sql`
      SELECT campaign_id FROM feed.demotion WHERE user_id = ${userId}
    `);
    return new Set(result.rows.map((row) => row.campaign_id));
  }

  async demote(userId: string, campaignId: string): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO feed.demotion (user_id, campaign_id) VALUES (${userId}, ${campaignId})
      ON CONFLICT (user_id, campaign_id) DO NOTHING
    `);
  }
}
