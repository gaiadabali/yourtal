import { and, eq, inArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { listingLocations, listings, merchantLocations } from "./schema/listing.table";
import type { BrowseListingsFilter } from "./listing.repository";

/** The one lifecycle state a customer may ever see (docs/17 section 2, Inventory). */
export const PUBLIC_LIFECYCLE_STATE = "active";

/**
 * Builds the `WHERE` clause for the public catalogue — region (F2) and
 * audience floors, category, merchant, price band, district (through the
 * joined location) and full-text search, every one optional except the
 * first two, AND-ed together with the `active`-only floor.
 *
 * `filter.audiences` is the caller's FULL reach (7.4.d): `["all_ages"]` for
 * an anonymous caller, or whatever `reachesAudience` admits for a signed-in
 * one's real age band -- computed once, by the controller, never here.
 *
 * `minPoints`/`maxPoints` prefer `platform.listing_points` (kept current by
 * 4.9.a's reprice job) but `COALESCE` to `listings.price_in_points`, the
 * write-time cache, when the view has no row for this listing yet.
 *
 * The fallback is not cosmetic: `platform.listing_points` reads
 * `ledger.listing_price`, which only the LIVE ledger service ever writes
 * (`LEDGER_MODE=live`, staging and later). Under the fake client
 * (`LEDGER_MODE=fake`, every dev box and `pnpm check`), that table is never
 * populated at all, so an EXISTS-only filter would silently exclude every
 * listing everywhere except staging -- caught by this module's own
 * `drizzle-listing-browse.test.ts`, which runs against the fake.
 */
export function browseConditions(
  filter: Omit<BrowseListingsFilter, "category" | "startingAfter">,
): SQL {
  const conditions = [
    eq(listings.lifecycleState, PUBLIC_LIFECYCLE_STATE),
    eq(listings.region, filter.region),
    inArray(listings.audience, filter.audiences),
  ];
  // `category`, `brands` and `tags` are facets and `startingAfter` follows the
  // sort, so all four apply in memory (listing-browse-facets.ts), not here.
  if (filter.channel !== undefined) {
    conditions.push(inArray(listings.channel, [filter.channel, "both"]));
  }
  if (filter.contentCategory !== undefined) {
    conditions.push(eq(listings.contentCategory, filter.contentCategory));
  }
  if (filter.merchantId !== undefined) conditions.push(eq(listings.merchantId, filter.merchantId));
  if (filter.minPoints !== undefined) {
    conditions.push(
      sql`coalesce(
        (select points from platform.listing_points lp where lp.listing_id = ${listings.id}),
        ${listings.priceInPoints}
      ) >= ${filter.minPoints}`,
    );
  }
  if (filter.maxPoints !== undefined) {
    conditions.push(
      sql`coalesce(
        (select points from platform.listing_points lp where lp.listing_id = ${listings.id}),
        ${listings.priceInPoints}
      ) <= ${filter.maxPoints}`,
    );
  }
  if (filter.search !== undefined && filter.search.length > 0) {
    // `sql` template, parameterised — not the string-built SQL docs/13
    // section 3 rule 6 bans, and the query builder has no fluent API for
    // full-text search. `simple`: the catalogue mixes Indonesian and English
    // merchant copy, so no language-specific stemming is honest about doing
    // linguistic analysis for neither rather than silently for one.
    conditions.push(
      sql`to_tsvector('simple', ${listings.title} || ' ' || ${listings.description}) @@ plainto_tsquery('simple', ${filter.search})`,
    );
  }
  if (filter.district !== undefined) {
    conditions.push(
      sql`exists (
        select 1 from ${listingLocations}
        join ${merchantLocations} on ${merchantLocations.id} = ${listingLocations.locationId}
        where ${listingLocations.listingId} = ${listings.id}
          and ${merchantLocations.district} = ${filter.district}
      )`,
    );
  }
  return and(...conditions) as SQL;
}
