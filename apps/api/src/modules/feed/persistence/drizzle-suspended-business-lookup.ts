import { sql } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { SuspendedBusinessLookup } from "./suspended-business-lookup";

/**
 * A dynamic `IN (...)` list, not `= ANY(${array})` -- a bare JS array bound
 * as one raw-`sql` parameter does not reliably reach Postgres as an array
 * literal through node-postgres, the same finding `listing-live-values.ts`
 * (7.4.b/c) already made and documented.
 */
function idList(ids: readonly string[]) {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

export class DrizzleSuspendedBusinessLookup implements SuspendedBusinessLookup {
  constructor(private readonly db: AppDb) {}

  async suspendedIds(businessIds: readonly string[]): Promise<ReadonlySet<string>> {
    if (businessIds.length === 0) return new Set();
    const unique = [...new Set(businessIds)];
    const result = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM business.business_accounts
       WHERE id IN (${idList(unique)}) AND suspended_at IS NOT NULL
    `);
    return new Set(result.rows.map((row) => row.id));
  }
}
