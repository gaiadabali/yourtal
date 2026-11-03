import { eq } from "drizzle-orm";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { listings } from "../store/persistence/schema/listing.table";

export const LISTING_PARTNER_READER = Symbol("LISTING_PARTNER_READER");

/** Docs/28 4.4: the partner app a listing's vouchers are redeemed in, or null for an ordinary listing. */
export class ListingPartnerReader {
  constructor(private readonly db: AppDb) {}

  async partnerOf(listingId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ partnerId: listings.redeemPartnerId })
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);
    return row?.partnerId ?? null;
  }
}
