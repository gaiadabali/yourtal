import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { toMinorUnits } from "@yourtal/contracts/money";
import { testDb } from "../testing/test-db";
import { FakeVoucherClient } from "./fake-voucher-client";
import { HttpVoucherClient } from "./http-voucher-client";
import type { VoucherInternalClient } from "./voucher-internal-client";

/**
 * TASKS.md 1.2.e and 4.5.f: one spec, two clients. `pnpm check` runs it
 * against `FakeVoucherClient`; `scripts/voucher-contract-live.mjs` runs the
 * same cases against a live `services/voucher` by setting
 * `VOUCHER_CONTRACT_LIVE_URL`, which picks the signed `HttpVoucherClient` —
 * the same split `ledger-client.contract.spec.ts` uses.
 */
const db = testDb();
const liveUrl = process.env["VOUCHER_CONTRACT_LIVE_URL"];
const client: VoucherInternalClient =
  liveUrl === undefined
    ? new FakeVoucherClient(db)
    : new HttpVoucherClient(
        liveUrl,
        process.env["VOUCHER_SERVICE_SECRET"] ?? "local-only-voucher-service-secret-not-real",
      );

/**
 * A real listing, with a branch, for `requestBatch`/`reserve` to work
 * against. The fake ignores everything about it except the ids it returns
 * (its own tables carry no FK to `store.listings`); the live engine reads it
 * for D12's "a batch's terms are derived from the listing" and needs it to
 * exist at all — `reserve` claims an actually-minted voucher, not an
 * invented one.
 */
async function seedListing(): Promise<{ listingId: string; merchantId: string }> {
  const listingId = randomUUID();
  const merchantId = randomUUID();
  const locationId = randomUUID();
  const farFuture = new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString();

  await db.execute(sql`
    INSERT INTO store.listings
      (id, merchant_id, merchant_name, title, description, category,
       face_value_minor, settlement_value_minor, price_in_points,
       stock_remaining, stock_total, transferable, partial_redemption_policy,
       minimum_spend_minor, expires_at, status, currency, region, audience,
       content_category, image_url, channel, partial_redemption)
    VALUES (${listingId}, ${merchantId}, 'Contract Spec Merchant', 'Contract Spec Listing',
            'seeded for voucher-client.contract.spec.ts', 'food-and-drink',
            50000, 15000, 1000, 10, 10, false, 'single_use_forfeit',
            NULL, ${farFuture}, 'available', 'IDR', 'ID', 'all_ages',
            'food-and-drink', 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg', 'both', 'single_use')
  `);
  await db.execute(sql`
    INSERT INTO store.merchant_location (id, merchant_id, name, address, district)
    VALUES (${locationId}, ${merchantId}, 'Test Branch', '1 Test St', 'Test District')
  `);
  await db.execute(sql`
    INSERT INTO store.listing_location (listing_id, location_id) VALUES (${listingId}, ${locationId})
  `);

  // Stock: a batch, requested and approved through the client itself (so
  // this works against both the fake and the live engine, which mints on
  // approval — see the "batches" describe block above). Without this,
  // `reserve` below has nothing to claim.
  const batch = (
    await client.requestBatch({
      listingId,
      merchantId,
      currency: "IDR",
      faceValueMinor: toMinorUnits(50_000),
      quantity: 5,
      partialRedemptionPolicy: "single_use_forfeit",
      requestedBy: "staff-1",
    })
  )._unsafeUnwrap();
  (await client.approveBatch({ batchId: batch.batchId, approvedBy: "staff-2" }))._unsafeUnwrap();

  return { listingId, merchantId };
}

/** `reserve` + `activate`, ready for reveal/qrToken/device tests. */
async function activeVoucher(): Promise<{
  voucherId: string;
  ownerId: string;
  merchantId: string;
}> {
  const { listingId, merchantId } = await seedListing();
  const sagaId = randomUUID();
  const reserved = (await client.reserve({ listingId, sagaId }))._unsafeUnwrap();
  const ownerId = randomUUID();
  expect((await client.activate({ sagaId, ownerId })).isOk()).toBe(true);
  return { voucherId: reserved.voucherId, ownerId, merchantId };
}

describe("batches", () => {
  it("requestBatch then approveBatch (two-person)", async () => {
    const { listingId, merchantId } = await seedListing();
    const batch = (
      await client.requestBatch({
        listingId,
        merchantId,
        currency: "IDR",
        faceValueMinor: toMinorUnits(50_000),
        quantity: 10,
        partialRedemptionPolicy: "single_use_forfeit",
        requestedBy: "staff-1",
      })
    )._unsafeUnwrap();
    expect(batch.state).toBe("pending");

    const selfApprove = await client.approveBatch({
      batchId: batch.batchId,
      approvedBy: "staff-1",
    });
    expect(selfApprove._unsafeUnwrapErr().code).toBe("already_granted");

    const approved = await client.approveBatch({ batchId: batch.batchId, approvedBy: "staff-2" });
    expect(approved._unsafeUnwrap().state).toBe("approved");
  });

  // D12 (a batch's supplier must match its listing's own merchant) is a
  // live-engine-only rule the fake does not model — see
  // services/voucher/internal/issue/reserve_test.go for its regression test.
});

describe("reservation lifecycle", () => {
  it("reserve, activate, reveal (owner-only), qrToken and verifyQrToken", async () => {
    const sagaId = randomUUID();
    const { listingId } = await seedListing();
    const reserved = (await client.reserve({ listingId, sagaId }))._unsafeUnwrap();
    expect(reserved.state).toBe("reserved");

    const ownerId = randomUUID();
    const activated = (await client.activate({ sagaId, ownerId }))._unsafeUnwrap();
    expect(activated.state).toBe("activated");

    const wrongOwner = await client.reveal({
      voucherId: reserved.voucherId,
      ownerId: randomUUID(),
    });
    expect(wrongOwner._unsafeUnwrapErr().code).toBe("audience_blocked");

    // The exact length is an encoding detail (the fake's is a bare 16-char
    // slice; the live engine's is Crockford Base32 with a check symbol, 17)
    // — the contract only promises a non-empty code.
    const revealed = await client.reveal({ voucherId: reserved.voucherId, ownerId });
    expect(revealed._unsafeUnwrap().code.length).toBeGreaterThan(0);

    const token = (
      await client.qrToken({ voucherId: reserved.voucherId, ownerId })
    )._unsafeUnwrap();
    const verified = await client.verifyQrToken({ token: token.token });
    expect(verified._unsafeUnwrap()).toEqual({ valid: true, voucherId: reserved.voucherId });

    const bogus = await client.verifyQrToken({ token: "not-a-real-token" });
    expect(bogus._unsafeUnwrap().valid).toBe(false);
  });

  it("release frees a reservation that was never activated", async () => {
    const sagaId = randomUUID();
    const { listingId } = await seedListing();
    expect((await client.reserve({ listingId, sagaId })).isOk()).toBe(true);
    const released = await client.release({ sagaId });
    expect(released.isOk()).toBe(true);
  });
});

describe("wallet", () => {
  it("listForUser and get return only vouchers this owner holds", async () => {
    const { voucherId, ownerId } = await activeVoucher();

    const list = (await client.listForUser({ userId: ownerId, limit: 20 }))._unsafeUnwrap();
    expect(list.vouchers.map((v) => v.voucherId)).toContain(voucherId);

    const fetched = await client.get({ voucherId, ownerId });
    expect(fetched._unsafeUnwrap().voucherId).toBe(voucherId);
  });
});

describe("device-authorized redemption", () => {
  it("authorizeAsDevice then captureAsDevice, refusing a second capture", async () => {
    const { voucherId, ownerId, merchantId } = await activeVoucher();
    const revealed = (await client.reveal({ voucherId, ownerId }))._unsafeUnwrap();

    const authorization = (
      await client.authorizeAsDevice({
        voucherCode: revealed.code,
        deviceId: "device-1",
        merchantId,
        currency: "IDR",
      })
    )._unsafeUnwrap();

    const wrongMerchant = await client.captureAsDevice({
      authorizationId: authorization.authorizationId,
      deviceId: "device-1",
      merchantId: randomUUID(),
    });
    expect(wrongMerchant._unsafeUnwrapErr().code).toBe("audience_blocked");

    const captured = await client.captureAsDevice({
      authorizationId: authorization.authorizationId,
      deviceId: "device-1",
      merchantId,
    });
    expect(captured._unsafeUnwrap().voucherId).toBe(voucherId);

    const twice = await client.captureAsDevice({
      authorizationId: authorization.authorizationId,
      deviceId: "device-1",
      merchantId,
    });
    expect(twice._unsafeUnwrapErr().code).toBe("already_granted");
  });
});

describe("kill switches", () => {
  it("setKillSwitch then listKillSwitches", async () => {
    expect(
      (
        await client.setKillSwitch({
          scope: "global",
          targetId: null,
          reason: "incident",
          setBy: "staff-1",
          active: true,
        })
      ).isOk(),
    ).toBe(true);
    const active = (await client.listKillSwitches())._unsafeUnwrap();
    expect(active.some((k) => k.scope === "global")).toBe(true);
  });
});

describe("merchant credentials", () => {
  it("issues a secret once, rotates it, then revokes", async () => {
    const merchantId = randomUUID();
    const issued = (
      await client.issueMerchantCredential({
        merchantId,
        deviceId: "device-1",
        issuedBy: "staff-1",
      })
    )._unsafeUnwrap();
    expect(issued.secret).toBeDefined();
    expect(issued.state).toBe("active");

    const rotated = (
      await client.rotate({ credentialId: issued.credentialId, rotatedBy: "staff-1" })
    )._unsafeUnwrap();
    expect(rotated.secret).not.toBe(issued.secret);

    const revoked = await client.revoke({
      credentialId: issued.credentialId,
      revokedBy: "staff-1",
    });
    expect(revoked.isOk()).toBe(true);
  });
});

describe("merchant stats", () => {
  it("merchantCaptureStats is callable", async () => {
    const result = await client.merchantCaptureStats({
      merchantId: randomUUID(),
      from: "2020-01-01",
      to: "2030-01-01",
    });
    expect(result.isOk()).toBe(true);
  });
});
