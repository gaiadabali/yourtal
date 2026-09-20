import { and, eq, gt, gte, lte, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { listingLocations, listings, merchantLocations } from "./schema/listing.table";
import type { BrowseListingsFilter } from "./listing.repository";

/** The one lifecycle state a customer may ever see (docs/17 section 2, Inventory). */
export const PUBLIC_LIFECYCLE_STATE = "active";

/**
 * Builds the `WHERE` clause for the public catalogue — category, merchant,
 * price band, district (through the joined location) and full-text search,
 * every one optional and AND-ed together with the `active`-only floor.
 */
export function browseConditions(filter: BrowseListingsFilter): SQL {
  const conditions = [eq(listings.lifecycleState, PUBLIC_LIFECYCLE_STATE)];
  if (filter.category !== undefined) conditions.push(eq(listings.category, filter.category));
  if (filter.merchantId !== undefined) conditions.push(eq(listings.merchantId, filter.merchantId));
  if (filter.minPoints !== undefined)
    conditions.push(gte(listings.priceInPoints, filter.minPoints));
  if (filter.maxPoints !== undefined)
    conditions.push(lte(listings.priceInPoints, filter.maxPoints));
  if (filter.startingAfter !== undefined) conditions.push(gt(listings.id, filter.startingAfter));
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
