import type pg from "pg";
import { listingSchema } from "@yourtal/contracts/listing";
import { toMinorUnits } from "@yourtal/contracts/money";
import {
  SNAP_APP_AU_ID,
  ensureListingStock,
  insertListing,
  priceListing,
  type StagingLedgerConfig,
  type StagingVoucherConfig,
  type VoucherOutcome,
} from "./staging";

/**
 * The "50 SnapApp scans" voucher on staging and in dev (2.8 T7, docs/28 4.6):
 * an online AU listing from Snap App Pty Ltd, A$5 face and settlement, bound to
 * the `snap-app` partner so only a linked SnapApp account redeems it. Listed at
 * 200 points (F128, 2.8.g): checkout charges max(200, the ledger's quote), so
 * the price never drops below the backing. Kept stocked with real minted
 * vouchers.
 *
 * Idempotent: an existing listing is never rewritten except to set a missing
 * binding or a missing staff price (a price staff changed later is kept), and
 * stock is only topped up to the target. Production is kept out by
 * where this runs (the staging deploy seed and the local dev seed only) and by
 * the demo Snap App AU business it needs: it does nothing without that. The
 * `snap-app` partner row exists everywhere, so it is no guard.
 */
const PARTNER_ID = "snap-app";
const LISTING_ID = "00000000-0000-4000-9000-000000000401";
const LOCATION_ID = "00000000-0000-4000-9000-000000000402";
const FACE_AND_SETTLEMENT_MINOR = 500;
const STOCK_TARGET = 50;
/** The founder's price (F128, 2026-10-22): above ceil(S ÷ B), so YourTal keeps the extra backing. */
const LISTED_PRICE_POINTS = 200;

const DESCRIPTION =
  "Adds 50 receipt scans to SnapApp. Link SnapApp under Me → Linked apps, then in SnapApp open " +
  "Points, choose Use a YourTal voucher and enter the code. Only the SnapApp account linked to " +
  "this YourTal account can use it. Single use.";

export type SnapAppScansResult =
  { readonly status: "skipped"; readonly detail: string } | VoucherOutcome;

async function prerequisitesMet(pool: pg.Pool): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM business.business_accounts WHERE id = $1::uuid AND region = 'AU'
      AND EXISTS (SELECT 1 FROM platform.partner_credential WHERE partner_id = $2)`,
    [SNAP_APP_AU_ID, PARTNER_ID],
  );
  return rows.length === 1;
}

/** Staff-only binding (docs/28 D2); a no-op once set, and it never rebinds another partner's listing. */
async function bindToPartner(pool: pg.Pool): Promise<void> {
  await pool.query(
    `UPDATE store.listings SET redeem_partner_id = $2 WHERE id = $1 AND redeem_partner_id IS NULL`,
    [LISTING_ID, PARTNER_ID],
  );
}

/**
 * Staff-only price (2.8.g), set only where none is: a listing seeded before
 * 2.8.g gets it, and a price staff later changed through the two-person
 * proposal is kept. (One staff cleared comes back at the next seed: NULL is all
 * the seed can see.) The cached `price_in_points` is raised with it.
 */
async function setListedPrice(pool: pg.Pool): Promise<void> {
  await pool.query(
    `UPDATE store.listings
        SET min_price_points = $2, price_in_points = GREATEST(price_in_points, $2)
      WHERE id = $1 AND min_price_points IS NULL`,
    [LISTING_ID, LISTED_PRICE_POINTS],
  );
}

export async function ensureSnapAppScansListing(
  pool: pg.Pool,
  ledger: StagingLedgerConfig,
  voucher: StagingVoucherConfig,
  log: (message: string) => void,
): Promise<SnapAppScansResult> {
  if (!(await prerequisitesMet(pool))) {
    return { status: "skipped", detail: "no Snap App AU business or snap-app partner here" };
  }

  const outcome = await ensureListingStock(
    pool,
    voucher,
    {
      listingId: LISTING_ID,
      merchantId: SNAP_APP_AU_ID,
      stockTarget: STOCK_TARGET,
      createIfMissing: async () => {
        const priced = await priceListing(ledger, {
          listingId: LISTING_ID,
          region: "AU",
          currency: "AUD",
          settlementMinor: FACE_AND_SETTLEMENT_MINOR,
        });
        if (!priced.ok) {
          log(
            `[seed:snapapp-scans] ledger /v1/pricing/listing answered an error: ${priced.detail}`,
          );
          return { ok: false, detail: priced.detail };
        }
        const listing = listingSchema.parse({
          id: LISTING_ID,
          merchantId: SNAP_APP_AU_ID,
          merchantName: "Snap App",
          title: "50 SnapApp scans",
          description: DESCRIPTION,
          category: "services",
          locations: [
            { id: LOCATION_ID, name: "SnapApp (online)", address: "Online", district: "Online" },
          ],
          currency: "AUD",
          faceValueMinor: toMinorUnits(FACE_AND_SETTLEMENT_MINOR),
          settlementValueMinor: toMinorUnits(FACE_AND_SETTLEMENT_MINOR),
          priceInPoints: Math.max(priced.pricePoints, LISTED_PRICE_POINTS),
          stockRemaining: STOCK_TARGET,
          stockTotal: STOCK_TARGET,
          transferable: false,
          partialRedemptionPolicy: "single_use_forfeit",
          minimumSpendMinor: null,
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          status: "available",
          region: "AU",
          audience: "adult",
          contentCategory: "services",
          imageUrl: "http://127.0.0.1:26900/yourtal-media/listings/snap-app-au-demo.jpg",
          channel: "online",
          partialRedemption: "single_use",
        });
        await insertListing(pool, listing);
        // Bound and priced at once, so a failure further on never leaves a live
        // unbound online listing, or one on sale at the ledger's price.
        await bindToPartner(pool);
        await setListedPrice(pool);
        return {
          ok: true,
          facts: {
            faceValueMinor: listing.faceValueMinor,
            settlementValueMinor: listing.settlementValueMinor,
            currency: listing.currency,
            partialRedemptionPolicy: listing.partialRedemptionPolicy,
          },
        };
      },
    },
    log,
  );

  await bindToPartner(pool); // repairs a listing whose binding was lost
  await setListedPrice(pool); // prices a listing seeded before 2.8.g
  return outcome;
}
