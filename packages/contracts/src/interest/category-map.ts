/**
 * Maps source categories onto the one interest tree, and refuses to derive a
 * sensitive interest from a merchant that implies one. `docs/20` §2 and §9,
 * YT-0215 criteria 2 and 4.
 *
 * ## The neutral-parent rule, and why some merchants map to nothing
 *
 * `docs/20` §9: "Where a merchant category unavoidably implies one (a
 * pharmacy, a place of worship), the merchant is mapped to a neutral parent
 * node and the sensitive leaf is never derived."
 *
 * A pharmacy has a defensible neutral parent — it sells toiletries, so
 * `personal-care` is a true statement about the merchant that implies
 * nothing about the person. A place of worship does not: there is no
 * commerce category that describes it without describing religious
 * observance. So `neutralParentFor` returns `null` for those, meaning
 * **derive no interest at all**, and that is the correct answer rather than
 * a gap.
 *
 * This is the part most likely to be "fixed" later by someone who sees a
 * merchant producing no signal and treats it as a bug. It is not. A profile
 * that is silent about a person is the intended output.
 */

import { listingCategorySchema, type ListingCategory } from "../listing/listing";
import { blockedTermIn, isKnownInterestNode } from "./taxonomy";

/**
 * Listing category → interest node. Total over `ListingCategory` by
 * construction: a `Record` of the union means adding a listing category
 * fails to compile until it is mapped, rather than silently mapping to
 * nothing at runtime.
 */
export const LISTING_CATEGORY_TO_INTEREST: Record<ListingCategory, string> = {
  food_beverage: "food-and-drink",
  retail: "fashion",
  digital_goods: "digital-goods",
  merchandise: "home",
  services: "services",
};

export function interestForListingCategory(category: ListingCategory): string {
  return LISTING_CATEGORY_TO_INTEREST[category];
}

/**
 * Merchant descriptions that imply a sensitive category, and the neutral
 * node to use instead. `null` means **derive nothing** — see the header.
 *
 * Keyed by the term that appears in the merchant's own category or name, so
 * this is consulted before any blocklist check can reject the merchant
 * outright: the merchant is legitimate, it is the *inference* that is not.
 */
const NEUTRAL_PARENT_BY_IMPLICATION: ReadonlyArray<readonly [string, string | null]> = [
  ["pharmac", "personal-care"],
  ["apotek", "personal-care"],
  ["drugstore", "personal-care"],
  ["optic", "personal-care"],
  ["clinic", null],
  ["medical", null],
  ["hospital", null],
  ["dental", null],
  ["maternity", null],
  ["fertility", null],
  ["church", null],
  ["mosque", null],
  ["masjid", null],
  ["temple", null],
  ["worship", null],
  ["halal-certif", null],
  ["payday", null],
  ["debt", null],
  ["pawn", null],
  ["rehab", null],
  ["immigration", null],
];

export interface InterestMapping {
  /** The node to score, or `null` to derive nothing. */
  readonly nodeId: string | null;
  /**
   * Set when the source implied a sensitive category. Carried so that
   * "why am I seeing this?" (`docs/20` §10) can say *nothing was inferred*
   * rather than showing an empty result that looks like a failure.
   */
  readonly neutralisedFrom?: string;
}

/**
 * Maps a merchant's own category or name onto the tree, applying the
 * neutral-parent rule first.
 *
 * Order matters and is the whole design: the implication check runs
 * **before** the direct lookup, so a merchant called "Sunrise Medical
 * Supplies" cannot reach a node by matching some other word in its name.
 */
export function interestForMerchantCategory(sourceCategory: string): InterestMapping {
  const haystack = sourceCategory.toLowerCase();

  for (const [implication, neutral] of NEUTRAL_PARENT_BY_IMPLICATION) {
    if (haystack.includes(implication)) {
      return { nodeId: neutral, neutralisedFrom: implication };
    }
  }

  const candidate = haystack.trim().replace(/\s+/gu, "-");

  // A source category that is itself a blocked term never reaches a node,
  // even if no implication above matched it. Belt and braces, deliberately:
  // the list above is enumerated and will always be incomplete.
  const blocked = blockedTermIn(candidate);
  if (blocked !== null) {
    return { nodeId: null, neutralisedFrom: blocked };
  }

  return { nodeId: isKnownInterestNode(candidate) ? candidate : null };
}

/**
 * The neutral node for a source that implies a sensitive category, or `null`
 * to derive nothing. Named in `SensitiveInterestNodeError`'s message so the
 * person hitting that error is pointed at the fix rather than the rule.
 */
export function neutralParentFor(sourceCategory: string): string | null {
  return interestForMerchantCategory(sourceCategory).nodeId;
}

/**
 * Receipt line categories are not modelled yet — YT-0215's second criterion
 * wants merchant, listing **and** receipt categories on one tree, and only
 * the first two exist to be mapped. Recorded as a named gap rather than an
 * omission, because a receipt taxonomy arrives with YT-0059's event schema
 * and should map through this same function when it does.
 */
export const RECEIPT_CATEGORIES_NOT_MODELLED = true;

export const LISTING_CATEGORIES = listingCategorySchema.options;
