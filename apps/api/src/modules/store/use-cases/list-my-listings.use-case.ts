import type { ResultAsync } from "neverthrow";
import type { Listing } from "@yourtal/contracts/listing";
import type { ListListingsError } from "../store.errors";
import type { ListingRepository } from "../persistence/listing.repository";
import { wrapPersistence } from "../wrap-persistence";

/** A merchant's own listings, every lifecycle state — the inventory dashboard. */
export function listMyListings(
  listings: ListingRepository,
  merchantId: string,
): ResultAsync<Listing[], ListListingsError> {
  return wrapPersistence(listings.listOwned(merchantId));
}
