import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { testDb } from "../testing/test-db";
import { FakeVoucherClient } from "./fake-voucher-client";

/** TASKS.md 1.2.e — see `ledger-client.contract.spec.ts`'s header for the fake-vs-live split. */
const db = testDb();
const client = new FakeVoucherClient(db);

describe("batches", () => {
  it("requestBatch then approveBatch (two-person)", async () => {
    const batch = (
      await client.requestBatch({
        listingId: randomUUID(),
        merchantId: randomUUID(),
        currency: "IDR",
        faceValueMinor: 50_000,
        quantity: 10,
        partialRedemptionPolicy: "single_use_forfeit",
        requestedBy: "staff-1",
      })
    )._unsafeUnwrap();
    expect(batch.state).toBe("pending");

    const selfApprove = await client.approveBatch({ batchId: batch.batchId, approvedBy: "staff-1" });
    expect(selfApprove._unsafeUnwrapErr().code).toBe("already_granted");

    const approved = await client.approveBatch({ batchId: batch.batchId, approvedBy: "staff-2" });
    expect(approved._unsafeUnwrap().state).toBe("approved");
  });
});

describe("reservation lifecycle", () => {
  it("reserve, activate, reveal (owner-only), qrToken and verifyQrToken", async () => {
    const sagaId = randomUUID();
    const listingId = randomUUID();
    const reserved = (await client.reserve({ listingId, sagaId }))._unsafeUnwrap();
    expect(reserved.state).toBe("reserved");

    const ownerId = randomUUID();
    const activated = (await client.activate({ sagaId, ownerId }))._unsafeUnwrap();
    expect(activated.state).toBe("activated");

    const wrongOwner = await client.reveal({ voucherId: reserved.voucherId, ownerId: randomUUID() });
    expect(wrongOwner._unsafeUnwrapErr().code).toBe("audience_blocked");

    const revealed = await client.reveal({ voucherId: reserved.voucherId, ownerId });
    expect(revealed._unsafeUnwrap().code).toHaveLength(16);

    const token = (await client.qrToken({ voucherId: reserved.voucherId, ownerId }))._unsafeUnwrap();
    const verified = await client.verifyQrToken({ token: token.token });
    expect(verified._unsafeUnwrap()).toEqual({ valid: true, voucherId: reserved.voucherId });

    const bogus = await client.verifyQrToken({ token: "not-a-real-token" });
    expect(bogus._unsafeUnwrap().valid).toBe(false);
  });

  it("release frees a reservation that was never activated", async () => {
    const sagaId = randomUUID();
    await client.reserve({ listingId: randomUUID(), sagaId });
    const released = await client.release({ sagaId });
    expect(released.isOk()).toBe(true);
  });
});

describe("wallet", () => {
  it("listForUser and get return only vouchers this owner holds", async () => {
    const ownerId = randomUUID();
    const sagaId = randomUUID();
    const reserved = (await client.reserve({ listingId: randomUUID(), sagaId }))._unsafeUnwrap();
    await client.activate({ sagaId, ownerId });

    const list = (await client.listForUser({ userId: ownerId, limit: 20 }))._unsafeUnwrap();
    expect(list.vouchers.map((v) => v.voucherId)).toContain(reserved.voucherId);

    const fetched = await client.get({ voucherId: reserved.voucherId, ownerId });
    expect(fetched._unsafeUnwrap().voucherId).toBe(reserved.voucherId);
  });
});

describe("device-authorized redemption", () => {
  it("authorizeAsDevice then captureAsDevice, refusing a second capture", async () => {
    const sagaId = randomUUID();
    const reserved = (await client.reserve({ listingId: randomUUID(), sagaId }))._unsafeUnwrap();
    const ownerId = randomUUID();
    await client.activate({ sagaId, ownerId });
    const revealed = (await client.reveal({ voucherId: reserved.voucherId, ownerId }))._unsafeUnwrap();

    const merchantId = randomUUID();
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
    expect(captured._unsafeUnwrap().voucherId).toBe(reserved.voucherId);

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
    await client.setKillSwitch({ scope: "global", targetId: null, reason: "incident", setBy: "staff-1", active: true });
    const active = (await client.listKillSwitches())._unsafeUnwrap();
    expect(active.some((k) => k.scope === "global")).toBe(true);
  });
});

describe("merchant credentials", () => {
  it("issues a secret once, rotates it, then revokes", async () => {
    const merchantId = randomUUID();
    const issued = (
      await client.issueMerchantCredential({ merchantId, deviceId: "device-1", issuedBy: "staff-1" })
    )._unsafeUnwrap();
    expect(issued.secret).toBeDefined();
    expect(issued.state).toBe("active");

    const rotated = (await client.rotate({ credentialId: issued.credentialId, rotatedBy: "staff-1" }))._unsafeUnwrap();
    expect(rotated.secret).not.toBe(issued.secret);

    const revoked = await client.revoke({ credentialId: issued.credentialId, revokedBy: "staff-1" });
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

// 4.5 (voucher internal API on the real service) makes these real.
describe.todo("HttpVoucherClient against a live services/voucher (4.5)");
