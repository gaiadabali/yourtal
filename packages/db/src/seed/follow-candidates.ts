import type pg from "pg";
import { businessSchema } from "@yourtal/contracts/business";
import type { Business } from "@yourtal/contracts/business";
import { MOCK_MERCHANTS } from "@yourtal/contracts/merchant/roster";

/**
 * `business.business_accounts` rows for onboarding's "follow 3 channels"
 * step (6.2.b, `GET /api/me/follows/candidates`) and Me's own follow list
 * (6.7.a) to read. B's own file, not C's business-domain seed: nothing
 * else seeds this table today — `seedStudio`'s campaigns carry a
 * `business_id`/`merchant_id` straight from the fixed merchant roster
 * (`merchant-roster.ts`), but the row those ids point at never existed, so
 * the first real read of `business.business_accounts` (this one) had
 * nothing to list. Built from the same roster so a followed channel's id
 * lines up with what campaigns already reference, rather than a second,
 * disconnected catalogue of businesses.
 *
 * Deterministic tax ids/handles derived from the roster's own fixed id and
 * name, not `createSeededFaker` — there is no per-merchant seed number in
 * the roster to draw from, and inventing one here would be one more place
 * the roster's own id could drift from what this table stores.
 */
function handleFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
}

function taxIdFor(region: "AU" | "ID", ordinal: number): { kind: "ABN" | "NPWP"; value: string } {
  if (region === "AU") {
    return { kind: "ABN", value: String(10_000_000_000 + ordinal).padStart(11, "0") };
  }
  return { kind: "NPWP", value: String(100_000_000_000_0000 + ordinal).padStart(16, "0") };
}

function businessFromMerchant(ordinal: number): Business {
  const merchant = MOCK_MERCHANTS[ordinal];
  if (merchant === undefined) throw new Error(`No merchant at roster index ${String(ordinal)}`);
  const taxId = taxIdFor(merchant.region, ordinal);
  return businessSchema.parse({
    id: merchant.id,
    legalName: merchant.region === "AU" ? `${merchant.name} Pty Ltd` : `PT ${merchant.name}`,
    displayName: merchant.name,
    taxIdKind: taxId.kind,
    taxIdValue: taxId.value,
    addressState: merchant.region === "AU" ? "NSW" : null,
    addressPostcode: merchant.region === "AU" ? "2000" : null,
    addressCity: merchant.region === "ID" ? "Jakarta" : null,
    roles: ["advertiser", "redeemer"],
    isVerified: true,
    logoUrl: null,
    region: merchant.region,
    currency: merchant.region === "AU" ? "AUD" : "IDR",
    handle: handleFrom(merchant.name),
    coverUrl: null,
  });
}

export interface FollowCandidateSeedCounts {
  readonly businesses: number;
}

export async function seedFollowCandidates(pool: pg.Pool): Promise<FollowCandidateSeedCounts> {
  let written = 0;
  for (let ordinal = 0; ordinal < MOCK_MERCHANTS.length; ordinal += 1) {
    const business = businessFromMerchant(ordinal);
    const result = await pool.query(
      `INSERT INTO business.business_accounts
         (id, legal_name, display_name, tax_id_kind, tax_id_value,
          address_state, address_postcode, address_city, roles, is_verified, logo_url,
          region, currency, handle, cover_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO NOTHING`,
      [
        business.id,
        business.legalName,
        business.displayName,
        business.taxIdKind,
        business.taxIdValue,
        business.addressState,
        business.addressPostcode,
        business.addressCity,
        JSON.stringify(business.roles),
        business.isVerified,
        business.logoUrl,
        business.region,
        business.currency,
        business.handle,
        business.coverUrl,
      ],
    );
    written += result.rowCount ?? 0;
  }
  return { businesses: written };
}
