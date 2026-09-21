import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import type { Region } from "@yourtal/contracts/region";

/**
 * The outlet a provisioned counter device stands in (YT-0583).
 *
 * ## Why this is derived here rather than added to the roster
 *
 * `MockMerchant` (`@yourtal/contracts/merchant/roster`) models a merchant
 * and the label its counter shows — `counterLabel`, "Kemang counter 2". It
 * does not model *where* that counter is, and the two are genuinely
 * different facts: a merchant with two shops has a counter in each, and the
 * label names the till while the location names the shop.
 *
 * Adding a real `counterLocation` to the roster would mean writing ten
 * addresses into `packages/contracts`, which is shared, and inventing
 * street data for merchants that do not exist. Deriving it here keeps the
 * invention inside `apps/web`, where every other Phase U mock already
 * lives, and keeps it obviously mock.
 *
 * ## What is real and what is invented
 *
 * **Real:** the shape (`merchantLocationSchema`), the district vocabulary
 * for ID (`JAKARTA_DISTRICTS`, the same five the listing
 * mocks draw from, so a counter sits in a district its merchant trades in), and the
 * determinism — the same merchant always resolves to the same outlet, so a
 * voucher issued against a branch and a device provisioned at that branch
 * agree across reloads.
 *
 * **Invented:** the street lines. They are placeholders and are not
 * addresses of real premises.
 *
 * ⏭️ When merchants are real, this derivation is deleted and the outlet
 * comes from the merchant's own roster of premises. The deterministic
 * mapping exists so nothing depends on a random value in the meantime, not
 * because the values are meaningful.
 */

// `packages/contracts/src/internal/jakarta.ts` holds the canonical list the
// listing mocks draw from, but `./internal/*` is not an exported subpath of
// `@yourtal/contracts` — deliberately, it is internal. Rather than widen
// that package's public surface for mock placeholder data, the five used
// here are copied. ⏭️ If a third consumer ever needs them, export the list
// properly instead of copying it a third time.
const JAKARTA_DISTRICTS: readonly string[] = [
  "Kemang",
  "Senayan",
  "Tebet",
  "Setiabudi",
  "Menteng",
];

// Sydney districts, mirroring JAKARTA_DISTRICTS' role for the AU region.
// No canonical list exists for AU yet; these are placeholders on the same
// footing as the street lines.
const SYDNEY_DISTRICTS: readonly string[] = [
  "Surry Hills",
  "Newtown",
  "Pyrmont",
  "Darlinghurst",
  "Chippendale",
];

/** Stable, order-independent hash so a merchant id always picks the same district. */
function stableIndex(seed: string, length: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 2147483647;
  }
  return hash % length;
}

export function deriveCounterLocation(
  merchantId: string,
  merchantName: string,
  region: Region,
): MerchantLocation {
  // Both lists are non-empty literals, but `noUncheckedIndexedAccess` cannot
  // know that, and the lint config forbids asserting it away. A default
  // keeps the function total without a non-null assertion.
  const districts = region === "AU" ? SYDNEY_DISTRICTS : JAKARTA_DISTRICTS;
  const district = districts[stableIndex(merchantId, districts.length)] ?? "Unknown district";
  const streetNumber = (stableIndex(`${merchantId}:street`, 80) + 1).toString();

  return {
    // A deterministic id derived from the merchant, so the same outlet is
    // the same outlet across reloads without a uuid generator here.
    id: merchantId,
    name: `${merchantName} — ${district}`,
    address: `${streetNumber} ${district} Street`,
    district,
  };
}
