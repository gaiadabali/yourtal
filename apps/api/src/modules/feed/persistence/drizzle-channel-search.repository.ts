import { sql } from "drizzle-orm";
import type { Region } from "@yourtal/contracts/region";
import type { FeedChannelResult } from "@yourtal/contracts/feed";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { ChannelSearchRepository } from "./channel-search.repository";

export class DrizzleChannelSearchRepository implements ChannelSearchRepository {
  constructor(private readonly db: AppDb) {}

  async search(
    query: string,
    region: string,
    limit: number,
  ): Promise<readonly FeedChannelResult[]> {
    const result = await this.db.execute<{
      id: string;
      display_name: string;
      handle: string;
      logo_url: string | null;
      region: string;
    }>(sql`
      SELECT id, display_name, handle, logo_url, region
        FROM business.business_accounts
       WHERE region = ${region}
         AND (display_name ILIKE ${`%${query}%`} OR handle ILIKE ${`%${query}%`})
       ORDER BY display_name
       LIMIT ${limit}
    `);
    return result.rows.map((row) => ({
      businessId: row.id,
      displayName: row.display_name,
      handle: row.handle,
      logoUrl: row.logo_url,
      region: row.region as Region,
    }));
  }
}
