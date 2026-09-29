import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Listing, PublicListing } from "@yourtal/contracts/listing";
import { categoryPolicy } from "@yourtal/jurisdiction/content-category";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import { applySettlementValueChange } from "./apply-settlement-value-change";
import { priceListingPoints } from "./price-listing";
import { browseConditions, PUBLIC_LIFECYCLE_STATE } from "./browse-listings-conditions";
import {
  assembleListing,
  assembleListings,
  assemblePublicListing,
  assemblePublicListings,
} from "./listing-assembler";
import { listingLocations, listings, merchantLocations } from "./schema/listing.table";
import type {
  BrowseListingsFilter,
  BrowseListingsPage,
  CreateListingInput,
  EditListingInput,
  ListingLifecycleState,
  ListingModerationItem,
  ListingRepository,
  SettlementValueChange,
} from "./listing.repository";

/** TASKS.md 9.2.a: only a listing the automated screen flags starts in review -- see the migration header. */
function initialLifecycleState(
  region: CreateListingInput["region"],
  contentCategory: CreateListingInput["contentCategory"],
): ListingLifecycleState {
  return categoryPolicy(region, contentCategory) === "adult_only" ? "pending_review" : "active";
}

/**
 * `store.listings`, `store.merchant_location` and `store.listing_location`,
 * against real Postgres — following the pattern `DrizzleCampaignRepository`
 * (YT-0553) established for keeping an internal lifecycle column out of the
 * public contract shape. Row assembly lives in `listing-assembler.ts` and
 * the browse `WHERE` clause in `browse-listings-conditions.ts`, split out to
 * keep this file under the 300-line ceiling (docs/13 section 1).
 */
export class DrizzleListingRepository implements ListingRepository {
  constructor(
    private readonly db: AppDb,
    private readonly ledger: Pick<LedgerInternalClient, "priceListing">,
  ) {}

  async locationsBelongToMerchant(
    merchantId: string,
    locationIds: readonly string[],
  ): Promise<boolean> {
    if (locationIds.length === 0) return false;
    const rows = await this.db
      .select({ id: merchantLocations.id })
      .from(merchantLocations)
      .where(
        and(
          eq(merchantLocations.merchantId, merchantId),
          inArray(merchantLocations.id, [...locationIds]),
        ),
      );
    // Every requested id must have matched — a subset match means at least
    // one id belongs to nobody, or to a different merchant.
    return rows.length === new Set(locationIds).size;
  }

  async listOwned(merchantId: string): Promise<Listing[]> {
    const rows = await this.db
      .select()
      .from(listings)
      .where(eq(listings.merchantId, merchantId))
      .orderBy(asc(listings.id));
    return assembleListings(this.db, rows);
  }

  async findOwnedById(merchantId: string, listingId: string): Promise<Listing | null> {
    const [row] = await this.db
      .select()
      .from(listings)
      .where(and(eq(listings.id, listingId), eq(listings.merchantId, merchantId)))
      .limit(1);
    return row === undefined ? null : assembleListing(this.db, row);
  }

  async findPublicById(listingId: string): Promise<PublicListing | null> {
    const [row] = await this.db
      .select()
      .from(listings)
      .where(and(eq(listings.id, listingId), eq(listings.lifecycleState, PUBLIC_LIFECYCLE_STATE)))
      .limit(1);
    return row === undefined ? null : assemblePublicListing(this.db, row);
  }

  async browsePublic(filter: BrowseListingsFilter): Promise<BrowseListingsPage> {
    // One extra row fetched to answer `hasMore` without a second COUNT query.
    const rows = await this.db
      .select()
      .from(listings)
      .where(browseConditions(filter))
      .orderBy(asc(listings.id))
      .limit(filter.limit + 1);

    const hasMore = rows.length > filter.limit;
    const page = hasMore ? rows.slice(0, filter.limit) : rows;
    return { listings: await assemblePublicListings(this.db, page), hasMore };
  }

  async create(merchantId: string, input: CreateListingInput): Promise<Listing> {
    // Generated BEFORE the insert (unlike before) so priceListing has a
    // listingId to key `ledger.listing_price` on -- see price-listing.ts.
    const id = randomUUID();
    const priced = await priceListingPoints(this.ledger, {
      listingId: id,
      region: input.region,
      currency: input.currency,
      settlementMinor: input.settlementValueMinor,
    });

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(listings)
        .values({
          // `listings.id` has no DB-side default (see the schema file).
          id,
          merchantId,
          merchantName: input.merchantName,
          title: input.title,
          description: input.description,
          category: input.category,
          currency: input.currency,
          faceValueMinor: input.faceValueMinor,
          settlementValueMinor: input.settlementValueMinor,
          // The ledger's answer, not the caller's (7.4.b, EM-01). Kept in
          // the column as a cache; assembleListing always re-reads the
          // live `platform.listing_points` view, which is what 4.9.a's
          // reprice job actually keeps current after a rate change.
          priceInPoints: priced,
          stockRemaining: 0,
          stockTotal: input.stockTotal,
          transferable: input.transferable,
          partialRedemptionPolicy: input.partialRedemptionPolicy,
          minimumSpendMinor: input.minimumSpendMinor,
          expiresAt: new Date(input.expiresAt),
          status: input.status,
          lifecycleState: initialLifecycleState(input.region, input.contentCategory),
          perUserLimit: input.perUserLimit ?? null,
          region: input.region,
          audience: input.audience,
          contentCategory: input.contentCategory,
          imageUrl: input.imageUrl,
          channel: input.channel,
          partialRedemption: input.partialRedemption,
        })
        .returning();
      if (row === undefined) {
        throw new Error("insert into store.listings returned no row");
      }

      await tx
        .insert(listingLocations)
        .values(input.locationIds.map((locationId) => ({ listingId: row.id, locationId })));

      // Both overrides supplied directly: `priced` already came from this
      // same `priceListing` call, and a brand-new listing has minted no
      // vouchers yet, so there is nothing unallocated to count.
      const listing = await assembleListing(tx, row, priced, 0);
      if (listing === null) {
        throw new Error("newly created listing failed to round-trip through listingSchema");
      }
      return listing;
    });
  }

  async updateFields(
    merchantId: string,
    listingId: string,
    patch: EditListingInput,
  ): Promise<Listing | null> {
    const values: Partial<typeof listings.$inferInsert> = {};
    if (patch.title !== undefined) values.title = patch.title;
    if (patch.description !== undefined) values.description = patch.description;
    if (patch.category !== undefined) values.category = patch.category;
    if (patch.stockTotal !== undefined) values.stockTotal = patch.stockTotal;
    if (patch.transferable !== undefined) values.transferable = patch.transferable;
    if (patch.partialRedemptionPolicy !== undefined) {
      values.partialRedemptionPolicy = patch.partialRedemptionPolicy;
    }
    if (patch.minimumSpendMinor !== undefined) values.minimumSpendMinor = patch.minimumSpendMinor;
    if (patch.expiresAt !== undefined) values.expiresAt = new Date(patch.expiresAt);
    if (patch.status !== undefined) values.status = patch.status;
    if (patch.perUserLimit !== undefined) values.perUserLimit = patch.perUserLimit;

    if (Object.keys(values).length === 0) {
      return this.findOwnedById(merchantId, listingId);
    }

    const [row] = await this.db
      .update(listings)
      .set(values)
      .where(and(eq(listings.id, listingId), eq(listings.merchantId, merchantId)))
      .returning();
    return row === undefined ? null : assembleListing(this.db, row);
  }

  async updateSettlementValue(
    merchantId: string,
    listingId: string,
    newSettlementValueMinor: number,
    requestedBy: string,
    reason: string,
  ): Promise<SettlementValueChange | null> {
    // `null` for `settlementDecreaseRequestId`: this is the direct-apply
    // path (non-material change), not an approved request. See
    // `apply-settlement-value-change.ts`, shared with
    // `DrizzleSettlementDecreaseRequestRepository.approve` (YT-0575) so
    // there is exactly one place either kind of settlement-value write and
    // its audit row happen.
    return this.db.transaction((tx) =>
      applySettlementValueChange(
        tx,
        this.ledger,
        merchantId,
        listingId,
        newSettlementValueMinor,
        requestedBy,
        reason,
        null,
      ),
    );
  }

  async setLifecycleState(
    merchantId: string,
    listingId: string,
    next: ListingLifecycleState,
  ): Promise<Listing | null> {
    const [row] = await this.db
      .update(listings)
      .set({ lifecycleState: next })
      .where(and(eq(listings.id, listingId), eq(listings.merchantId, merchantId)))
      .returning();
    return row === undefined ? null : assembleListing(this.db, row);
  }

  async lifecycleStateOf(
    merchantId: string,
    listingId: string,
  ): Promise<ListingLifecycleState | null> {
    const [row] = await this.db
      .select({ lifecycleState: listings.lifecycleState })
      .from(listings)
      .where(and(eq(listings.id, listingId), eq(listings.merchantId, merchantId)))
      .limit(1);
    return (row?.lifecycleState as ListingLifecycleState | undefined) ?? null;
  }

  async listPendingModeration(): Promise<readonly ListingModerationItem[]> {
    const rows = await this.db
      .select({
        id: listings.id,
        merchantId: listings.merchantId,
        merchantName: listings.merchantName,
        title: listings.title,
        region: listings.region,
        audience: listings.audience,
        contentCategory: listings.contentCategory,
        lifecycleState: listings.lifecycleState,
        rejectionReason: listings.rejectionReason,
      })
      .from(listings)
      .where(eq(listings.lifecycleState, "pending_review"))
      .orderBy(asc(listings.id));
    return rows.map(toModerationItem);
  }

  async findPendingModerationById(listingId: string): Promise<ListingModerationItem | null> {
    const [row] = await this.db
      .select({
        id: listings.id,
        merchantId: listings.merchantId,
        merchantName: listings.merchantName,
        title: listings.title,
        region: listings.region,
        audience: listings.audience,
        contentCategory: listings.contentCategory,
        lifecycleState: listings.lifecycleState,
        rejectionReason: listings.rejectionReason,
      })
      .from(listings)
      .where(and(eq(listings.id, listingId), eq(listings.lifecycleState, "pending_review")))
      .limit(1);
    return row === undefined ? null : toModerationItem(row);
  }

  async decideModeration(
    listingId: string,
    decision: "active" | "rejected",
    rejectionReason: string | null,
  ): Promise<ListingModerationItem | null> {
    const [row] = await this.db
      .update(listings)
      .set({ lifecycleState: decision, rejectionReason })
      .where(and(eq(listings.id, listingId), eq(listings.lifecycleState, "pending_review")))
      .returning({
        id: listings.id,
        merchantId: listings.merchantId,
        merchantName: listings.merchantName,
        title: listings.title,
        region: listings.region,
        audience: listings.audience,
        contentCategory: listings.contentCategory,
        lifecycleState: listings.lifecycleState,
        rejectionReason: listings.rejectionReason,
      });
    return row === undefined ? null : toModerationItem(row);
  }
}

function toModerationItem(row: {
  id: string;
  merchantId: string;
  merchantName: string;
  title: string;
  region: string;
  audience: string;
  contentCategory: string;
  lifecycleState: string;
  rejectionReason: string | null;
}): ListingModerationItem {
  return {
    id: row.id,
    merchantId: row.merchantId,
    merchantName: row.merchantName,
    title: row.title,
    region: row.region as ListingModerationItem["region"],
    audience: row.audience as ListingModerationItem["audience"],
    contentCategory: row.contentCategory as ListingModerationItem["contentCategory"],
    lifecycleState: row.lifecycleState as ListingLifecycleState,
    rejectionReason: row.rejectionReason,
  };
}
