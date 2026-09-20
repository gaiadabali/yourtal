import type { ResultAsync } from "neverthrow";
import type { ListListingsError } from "../store.errors";
import type {
  BrowseListingsFilter,
  BrowseListingsPage,
  ListingRepository,
} from "../persistence/listing.repository";
import { wrapPersistence } from "../wrap-persistence";

/** The public catalogue — Store browse (`apps/web/features/store`). `active` listings only. */
export function browseListings(
  listings: ListingRepository,
  filter: BrowseListingsFilter,
): ResultAsync<BrowseListingsPage, ListListingsError> {
  return wrapPersistence(listings.browsePublic(filter));
}
