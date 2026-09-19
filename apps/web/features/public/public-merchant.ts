import type { Campaign } from "@yourtal/contracts/campaign";
import type { Listing } from "@yourtal/contracts/listing";
import { listLivePublicCampaigns } from "./public-campaign-data";
import { listPublicListings } from "./public-listing-data";
import { slugify } from "./public-slug";

/**
 * The public merchant page (`/[locale]/m/[merchant]`) needs one merchant
 * view assembled from whatever campaigns and listings share its name.
 *
 * **Why this does not use `@yourtal/contracts/business`.** `Business.id` is
 * the real merchant identity, and `Campaign.merchantId`/`Listing.merchantId`
 * both carry it — in the real system. In the mock generators
 * (`packages/contracts/src/business/business.mock.ts`,
 * `.../campaign/campaign.mock.ts`, `.../listing/listing.mock.ts`), each
 * entity's `merchantId` is `faker.string.uuid()`, generated independently
 * per entity with an unrelated seed — there is no fixture anywhere that
 * gives a campaign, a listing and a business the same `merchantId`. Building
 * this page against `Business` would mean either fabricating a join the
 * data does not support, or silently showing an empty page for every real
 * mock campaign/listing. `merchantName` is the one field every campaign and
 * listing genuinely carries and that collides on purpose for the same
 * merchant, so it is the honest key to group by here. This is a documented
 * limitation of the current mock data, not a design preference — see this
 * ticket's report, and packages/** is out of bounds for this ticket to fix.
 *
 * A real merchant record (verification badge, logo, legal name, district as
 * a first-class field) would come from `Business` once the join exists; this
 * view only ever claims what a campaign or listing already states about its
 * merchant.
 */
export interface PublicMerchant {
  slug: string;
  name: string;
  /** The most common district among this merchant's listings, or `null` if it has none (campaigns carry no district). */
  district: string | null;
  campaigns: Campaign[];
  listings: Listing[];
}

function mostCommonDistrict(listings: readonly Listing[]): string | null {
  if (listings.length === 0) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const listing of listings) {
    counts.set(listing.district, (counts.get(listing.district) ?? 0) + 1);
  }
  let best: { district: string; count: number } | null = null;
  for (const [district, count] of counts) {
    if (!best || count > best.count) {
      best = { district, count };
    }
  }
  return best?.district ?? null;
}

/** Every merchant with at least one live public campaign or listing, grouped by `slugify(merchantName)`. */
export function listPublicMerchants(): PublicMerchant[] {
  const bySlug = new Map<string, { name: string; campaigns: Campaign[]; listings: Listing[] }>();

  for (const campaign of listLivePublicCampaigns()) {
    const slug = slugify(campaign.merchantName);
    const entry = bySlug.get(slug) ?? { name: campaign.merchantName, campaigns: [], listings: [] };
    entry.campaigns.push(campaign);
    bySlug.set(slug, entry);
  }
  for (const listing of listPublicListings()) {
    const slug = slugify(listing.merchantName);
    const entry = bySlug.get(slug) ?? { name: listing.merchantName, campaigns: [], listings: [] };
    entry.listings.push(listing);
    bySlug.set(slug, entry);
  }

  return [...bySlug.entries()].map(([slug, entry]) => ({
    slug,
    name: entry.name,
    district: mostCommonDistrict(entry.listings),
    campaigns: entry.campaigns,
    listings: entry.listings,
  }));
}

/** A single merchant view for the public merchant page, or `undefined` if no campaign or listing carries this slug's name. */
export function getPublicMerchant(slug: string): PublicMerchant | undefined {
  return listPublicMerchants().find((merchant) => merchant.slug === slug);
}
