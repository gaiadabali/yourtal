import { sql } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { ChannelInfo, ChannelLookupRepository } from "./channel-lookup.repository";

/** Same dynamic `IN (...)` reasoning as `drizzle-suspended-business-lookup.ts`. */
function idList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

export class DrizzleChannelLookupRepository implements ChannelLookupRepository {
  constructor(private readonly db: AppDb) {}

  async channelsFor(businessIds: readonly string[]): Promise<ReadonlyMap<string, ChannelInfo>> {
    if (businessIds.length === 0) return new Map();
    const unique = [...new Set(businessIds)];
    const result = await this.db.execute<{ id: string; handle: string; logo_url: string | null }>(
      sql`SELECT id, handle, logo_url FROM business.business_accounts WHERE id IN (${idList(unique)})`,
    );
    return new Map(
      result.rows.map((row) => [row.id, { handle: row.handle, logoUrl: row.logo_url }]),
    );
  }
}
