import type { Currency } from "@yourtal/contracts/money/currency";
import type {
  Listing,
  PublicListing,
  ListingCategory,
  ListingStatus,
  PartialRedemptionPolicy,
  ListingChannel,
  PartialRedemption,
} from "@yourtal/contracts/listing";
import type { Audience } from "@yourtal/contracts/campaign";
import type { Region } from "@yourtal/contracts/region";
import type { ContentCategory } from "@yourtal/jurisdiction/content-category";

/** MERCHANT-side visibility (docs/17 section 2, Inventory). Never a customer-facing value. */
export type ListingLifecycleState = "active" | "paused" | "retired";

export interface CreateListingInput {
  readonly merchantName: string;
  readonly title: string;
  readonly description: string;
  readonly category: ListingCategory;
  /**
   * Existing `store.merchant_location` rows belonging to this merchant. This
   * module does not provision locations — see the ticket report on why
   * branch management stayed out of scope.
   */
  readonly locationIds: readonly string[];
  readonly currency: Currency;
  readonly faceValueMinor: number;
  readonly settlementValueMinor: number;
  readonly priceInPoints: number;
  readonly stockTotal: number;
  readonly transferable: boolean;
  readonly partialRedemptionPolicy: PartialRedemptionPolicy;
  readonly minimumSpendMinor: number | null;
  readonly expiresAt: string;
  readonly status: ListingStatus;
  readonly perUserLimit: number | undefined;
  // TASKS.md 1.1.a/1.1.h: until a listing's region is derived from its
  // business, the caller supplies it — the same stopgap `currency` above
  // already follows.
  readonly region: Region;
  readonly audience: Audience;
  readonly contentCategory: ContentCategory;
  readonly imageUrl: string;
  readonly channel: ListingChannel;
  readonly partialRedemption: PartialRedemption;
}

/**
 * Every field explicitly `| undefined` rather than bare `?:` —
 * `exactOptionalPropertyTypes` (docs/13b section 1) distinguishes "key
 * absent" from "key present with value `undefined`", and a Zod-parsed DTO
 * produces the latter for an unset optional field.
 */
export interface EditListingInput {
  readonly title?: string | undefined;
  readonly description?: string | undefined;
  readonly category?: ListingCategory | undefined;
  readonly stockTotal?: number | undefined;
  readonly stockRemaining?: number | undefined;
  readonly transferable?: boolean | undefined;
  readonly partialRedemptionPolicy?: PartialRedemptionPolicy | undefined;
  readonly minimumSpendMinor?: number | null | undefined;
  readonly expiresAt?: string | undefined;
  readonly status?: ListingStatus | undefined;
  readonly perUserLimit?: number | null | undefined;
}

export interface BrowseListingsFilter {
  readonly category?: ListingCategory | undefined;
  readonly merchantId?: string | undefined;
  readonly district?: string | undefined;
  /** Postgres full-text search over title + description, `simple` config. */
  readonly search?: string | undefined;
  readonly minPoints?: number | undefined;
  readonly maxPoints?: number | undefined;
  readonly limit: number;
  /** Cursor-only pagination (docs/13 section 5) — the last id of the previous page. */
  readonly startingAfter?: string | undefined;
}

export interface BrowseListingsPage {
  readonly listings: readonly PublicListing[];
  readonly hasMore: boolean;
}

export interface SettlementValueChange {
  readonly previous: Listing;
  readonly updated: Listing;
}

/**
 * The store module's own listing storage. Every method that returns a
 * `Listing` returns the CUSTOMER-facing contract shape — `lifecycleState` and
 * other merchant-only columns never leave this layer, the same discipline
 * `CampaignRepository` uses for `lifecycle_state` vs `campaignSchema.status`.
 */
export interface ListingRepository {
  /**
   * Whether every id in `locationIds` names a `store.merchant_location` row
   * owned by `merchantId`. Empty input is always `false` — `listingSchema`
   * requires at least one location, so there is nothing valid to create
   * without any.
   */
  locationsBelongToMerchant(merchantId: string, locationIds: readonly string[]): Promise<boolean>;
  /** A merchant's own listings, every lifecycle state, newest first. */
  listOwned(merchantId: string): Promise<Listing[]>;
  /** One of a merchant's own listings, any lifecycle state, or `null`. */
  findOwnedById(merchantId: string, listingId: string): Promise<Listing | null>;
  /** The public catalogue: `active` listings only. */
  /** PUBLIC shape -- no `settlementValueMinor`. See `publicListingSchema`. */
  findPublicById(listingId: string): Promise<PublicListing | null>;
  browsePublic(filter: BrowseListingsFilter): Promise<BrowseListingsPage>;

  create(merchantId: string, input: CreateListingInput): Promise<Listing>;
  /** `null` if no such listing exists for this merchant. Never touches price or lifecycle. */
  updateFields(
    merchantId: string,
    listingId: string,
    patch: EditListingInput,
  ): Promise<Listing | null>;
  /**
   * Updates `settlement_value_minor` and writes its audit row, in one
   * transaction — a repricing that "succeeded" with no audit trail is a
   * silent partial completion, the exact shape docs/13c warns against.
   * `price_in_points` is left exactly as it was — see this module's
   * migration header. `null` if no such listing exists for this merchant.
   */
  updateSettlementValue(
    merchantId: string,
    listingId: string,
    newSettlementValueMinor: number,
    requestedBy: string,
    reason: string,
  ): Promise<SettlementValueChange | null>;
  /** `null` if no such listing exists for this merchant. */
  setLifecycleState(
    merchantId: string,
    listingId: string,
    next: ListingLifecycleState,
  ): Promise<Listing | null>;
  /** The listing's own lifecycle state, for validating a transition. `null` if not found. */
  lifecycleStateOf(merchantId: string, listingId: string): Promise<ListingLifecycleState | null>;
}

export const LISTING_REPOSITORY = Symbol("LISTING_REPOSITORY");
