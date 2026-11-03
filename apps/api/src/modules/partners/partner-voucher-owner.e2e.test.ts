import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { sql } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toMinorUnits } from "@yourtal/contracts/money";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { VOUCHER_INTERNAL_CLIENT } from "../../shared/voucher-client/voucher-internal-client";
import type { VoucherInternalClient } from "../../shared/voucher-client/voucher-internal-client";
import { startLiveServices, type LiveServices } from "../devices/testing/live-services";
import { bootPartnerApp, partnerKit } from "./testing/partner-e2e-kit";
import type { Partner } from "./testing/partner-e2e-kit";

/**
 * 2.8 T4 (docs/28 4.2): `POST /api/partners/vouchers/owner`. Held only for
 * the linked user's own voucher, bound to the calling partner, in the link's
 * region; every other case is byte-identical, so the read is no oracle.
 *
 * Runs on the fake voucher client by default. The live test is this same file
 * against a real voucher service (the Go holding read):
 *   node packages/db/scripts/with-test-db.mjs -- env CHECKOUT_LIVE=1 \
 *     pnpm --filter @yourtal/api exec vitest run src/modules/partners/partner-voucher-owner.e2e.test.ts
 */
const owner = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
let app: NestFastifyApplication;
let kit: ReturnType<typeof partnerKit>;
let vouchers: VoucherInternalClient;
let liveServices: LiveServices | undefined;

beforeAll(async () => {
  if (process.env["CHECKOUT_LIVE"] === "1") {
    liveServices = await startLiveServices(path.resolve(process.cwd(), "..", ".."));
  }
  app = await bootPartnerApp();
  kit = partnerKit(app, owner);
  vouchers = app.get<VoucherInternalClient>(VOUCHER_INTERNAL_CLIENT, { strict: false });
}, 120_000);

afterAll(async () => {
  await app.close();
  await liveServices?.stop();
});

/** A bound-shape listing (online, not transferable, single use) with stock, in `region`. */
async function seedListing(region: "AU" | "ID", redeemPartnerId: string | null) {
  const listingId = randomUUID();
  const merchantId = randomUUID();
  const currency = region === "AU" ? "AUD" : "IDR";
  const farFuture = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();
  await owner.execute(sql`
    INSERT INTO store.listings
      (id, merchant_id, merchant_name, title, description, category,
       face_value_minor, settlement_value_minor, price_in_points,
       stock_remaining, stock_total, transferable, partial_redemption_policy,
       minimum_spend_minor, expires_at, status, currency, region, audience,
       content_category, image_url, channel, partial_redemption, redeem_partner_id)
    VALUES (${listingId}, ${merchantId}, 'Snap App Pty Ltd', '50 SnapApp scans',
            'seeded for partner-voucher-owner.e2e.test.ts', 'food_beverage',
            500, 500, 200, 5, 5, false, 'single_use_forfeit',
            NULL, ${farFuture}, 'available', ${currency}, ${region}, 'adult',
            'food-and-drink', 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg',
            'online', 'single_use', ${redeemPartnerId})
  `);
  // The live engine mints a batch at a listing's locations (docs/28 4.6: "SnapApp (online)").
  const locationId = randomUUID();
  await owner.execute(sql`
    INSERT INTO store.merchant_location (id, merchant_id, name, address, district)
    VALUES (${locationId}, ${merchantId}, 'SnapApp (online)', 'Online', 'Online')
  `);
  await owner.execute(sql`
    INSERT INTO store.listing_location (listing_id, location_id) VALUES (${listingId}, ${locationId})
  `);
  const batch = (
    await vouchers.requestBatch({
      listingId,
      merchantId,
      currency,
      faceValueMinor: toMinorUnits(500),
      quantity: 5,
      partialRedemptionPolicy: "single_use_forfeit",
      requestedBy: "staff-1",
    })
  ).match(ok, fail);
  (await vouchers.approveBatch({ batchId: batch.batchId, approvedBy: "staff-2" })).match(ok, fail);
  return listingId;
}

/** A voucher of `listingId` in `ownerId`'s wallet; returns its code's SHA-256. */
async function voucherIn(ownerId: string, listingId: string): Promise<string> {
  const sagaId = randomUUID();
  const { voucherId } = (await vouchers.reserve({ listingId, sagaId })).match(ok, fail);
  (await vouchers.activate({ sagaId, ownerId })).match(ok, fail);
  const { code } = (await vouchers.reveal({ voucherId, ownerId })).match(ok, fail);
  return createHash("sha256").update(code).digest("hex");
}

function ok<T>(value: T): T {
  return value;
}
function fail(error: { code: string; message: string }): never {
  throw new Error(`voucher client: ${error.code}: ${error.message}`);
}

const ask = (partner: Partner, linkId: string, codeSha256: string) =>
  kit.partnerPost(partner, "vouchers/owner", { linkId, codeSha256 });

describe("POST /api/partners/vouchers/owner", () => {
  it("answers held for the linked user's own voucher bound to this partner, and nothing more", async () => {
    const partner = await kit.seedPartner();
    const { session, linkId } = await kit.linkedAdult(partner, "AU");
    const codeSha256 = await voucherIn(session.userId, await seedListing("AU", partner.partnerId));

    const held = await ask(partner, linkId, codeSha256);
    expect(held.statusCode, held.body).toBe(200);
    // Exact: no region, bound partner, voucher, listing or merchant ids, no hash.
    expect(held.json()).toEqual({
      linkId,
      held: true,
      status: "active",
      faceValueMinor: 500,
      currency: "AUD",
      expiresAt: expect.any(String),
    });
  });

  it("answers every refusal with the identical body", async () => {
    const partner = await kit.seedPartner();
    const other = await kit.seedPartner();
    const { session, linkId } = await kit.linkedAdult(partner, "AU");
    const someoneElse = await kit.linkedAdult(partner, "AU");
    const bound = await seedListing("AU", partner.partnerId);

    const cases = {
      anotherPersonsCode: await voucherIn(someoneElse.session.userId, bound),
      unknownCode: createHash("sha256").update(randomUUID()).digest("hex"),
      anotherPartnersVoucher: await voucherIn(
        session.userId,
        await seedListing("AU", other.partnerId),
      ),
      unboundVoucher: await voucherIn(session.userId, await seedListing("AU", null)),
      regionMismatch: await voucherIn(session.userId, await seedListing("ID", partner.partnerId)),
    };

    const expected = JSON.stringify({ linkId, held: false });
    for (const [name, codeSha256] of Object.entries(cases)) {
      const refused = await ask(partner, linkId, codeSha256);
      expect(refused.statusCode, name).toBe(200);
      expect(refused.body, name).toBe(expected);
    }

    // The other person's own link still sees their voucher: the refusal above was ownership.
    const theirs = await ask(partner, someoneElse.linkId, cases.anotherPersonsCode);
    expect(theirs.json<{ held: boolean }>().held).toBe(true);
  });

  it("refuses an unlinked user: a revoked link, an unknown link, another partner's link", async () => {
    const partner = await kit.seedPartner();
    const other = await kit.seedPartner();
    const { session, linkId } = await kit.linkedAdult(partner, "AU");
    const codeSha256 = await voucherIn(session.userId, await seedListing("AU", partner.partnerId));

    for (const id of [randomUUID(), linkId]) {
      const unknown = await ask(other, id, codeSha256);
      expect(unknown.statusCode, id).toBe(400);
      expect(unknown.json<{ code: string }>().code).toBe("unknown_link");
    }

    expect((await kit.partnerPost(partner, `links/${linkId}/revoke`, {})).statusCode).toBe(200);
    const revoked = await ask(partner, linkId, codeSha256);
    expect(revoked.statusCode).toBe(403);
    expect(revoked.json<{ code: string }>().code).toBe("link_revoked");
  });

  it("refuses a bad signature and a malformed hash", async () => {
    const partner = await kit.seedPartner();
    const { linkId } = await kit.linkedAdult(partner, "AU");
    const hash = "a".repeat(64);
    const body = { linkId, codeSha256: hash };
    expect((await kit.partnerPost(partner, "vouchers/owner", body, "wrong")).statusCode).toBe(401);
    for (const codeSha256 of ["A".repeat(64), "a".repeat(63), "not-a-hash"]) {
      const malformed = await ask(partner, linkId, codeSha256);
      expect(malformed.statusCode, codeSha256).toBe(400);
    }
  });
});
