import { desc, eq } from "drizzle-orm";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { listingPriceRevisions } from "./schema/listing-price-revision.table";
import type {
  ListingPriceRevisionRecord,
  ListingPriceRevisionRepository,
} from "./listing-price-revision.repository";

export class DrizzleListingPriceRevisionRepository implements ListingPriceRevisionRepository {
  constructor(private readonly db: AppDb) {}

  async listForListing(listingId: string): Promise<ListingPriceRevisionRecord[]> {
    const rows = await this.db
      .select()
      .from(listingPriceRevisions)
      .where(eq(listingPriceRevisions.listingId, listingId))
      .orderBy(desc(listingPriceRevisions.createdAt));
    return rows.map(toRecord);
  }
}

function toRecord(row: typeof listingPriceRevisions.$inferSelect): ListingPriceRevisionRecord {
  return {
    id: row.id,
    listingId: row.listingId,
    previousSettlementValueIdr: row.previousSettlementValueIdr,
    newSettlementValueIdr: row.newSettlementValueIdr,
    previousPriceInPoints: row.previousPriceInPoints,
    newPriceInPoints: row.newPriceInPoints,
    requestedBy: row.requestedBy,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}
