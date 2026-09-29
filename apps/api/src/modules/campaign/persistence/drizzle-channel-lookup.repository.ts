import { sql } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { ChannelLookupRepository, ChannelSummary } from "./channel-lookup.repository";

type ChannelRow = {
  id: string;
  display_name: string;
  handle: string;
  logo_url: string | null;
  region: string;
};

function toSummary(row: ChannelRow): ChannelSummary {
  return {
    businessId: row.id,
    displayName: row.display_name,
    handle: row.handle,
    logoUrl: row.logo_url,
    region: row.region as ChannelSummary["region"],
  };
}

export class DrizzleChannelLookupRepository implements ChannelLookupRepository {
  constructor(private readonly db: AppDb) {}

  async findByHandle(handle: string): Promise<ChannelSummary | null> {
    const result = await this.db.execute<ChannelRow>(sql`
      SELECT id, display_name, handle, logo_url, region
        FROM business.business_accounts
       WHERE handle = ${handle} AND suspended_at IS NULL
       LIMIT 1
    `);
    const row = result.rows[0];
    return row === undefined ? null : toSummary(row);
  }

  async findById(businessId: string): Promise<ChannelSummary | null> {
    const result = await this.db.execute<ChannelRow>(sql`
      SELECT id, display_name, handle, logo_url, region
        FROM business.business_accounts
       WHERE id = ${businessId} AND suspended_at IS NULL
       LIMIT 1
    `);
    const row = result.rows[0];
    return row === undefined ? null : toSummary(row);
  }
}
