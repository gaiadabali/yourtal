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
 * the `snap-app` partner so only a linked SnapApp account redeems it. Priced by
 * the real ledger like every other seeded listing, and kept stocked with real
 * minted vouchers.
 *
 * Idempotent: an existing listing is never rewritten except to set a missing
 * binding, and stock is only topped up to the target. It reads nothing from and
 * writes nothing to production, which has no seed: it needs Snap App's AU
 * business and the `snap-app` partner row, and does nothing without them.
 */
const PARTNER_ID = "snap-app";
const LISTING_ID = "00000000-0000-4000-9000-000000000401";
const LOCATION_ID = "00000000-0000-4000-9000-000000000402";
const FACE_AND_SETTLEMENT_MINOR = 500;
const STOCK_TARGET = 50;

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
          priceInPoints: priced.pricePoints,
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

  // Staff-only binding (docs/28 D2); a no-op once set, and it never rebinds another partner's listing.
  await pool.query(
    `UPDATE store.listings SET redeem_partner_id = $2 WHERE id = $1 AND redeem_partner_id IS NULL`,
    [LISTING_ID, PARTNER_ID],
  );
  return outcome;
}
