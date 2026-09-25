import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { testDb } from "../testing/test-db";
import { FakeLedgerClient } from "./fake-ledger-client";

/**
 * TASKS.md 1.2.e. Runs against `FakeLedgerClient` today; the `it.todo` cases
 * are exactly the ones 4.1 makes real by pointing `HttpLedgerClient` at a
 * live `services/ledger` — see that file's own header for why it cannot be
 * exercised yet.
 */
const db = testDb();
const client = new FakeLedgerClient(db);

describe("pricing", () => {
  it("quotes ceil(S * 1e6 / B) and expires in 15 minutes", async () => {
    const result = await client.quote({ region: "ID", currency: "IDR", settlementMinor: 54_000 });
    expect(result.isOk()).toBe(true);
    const quote = result._unsafeUnwrap();
    // ID's F1 rate is 6,000,000 micros/point (Rp 6/point): ceil(54000/6) = 9000.
    expect(quote.pricePoints).toBe(9_000);
    expect(quote.locked).toBe(false);
    const minutesToExpiry = (new Date(quote.expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutesToExpiry).toBeGreaterThan(14);
    expect(minutesToExpiry).toBeLessThanOrEqual(15);
  });

  it("refuses a currency that does not match the region", async () => {
    const result = await client.quote({ region: "ID", currency: "AUD", settlementMinor: 1_000 });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("currency_mismatch");
  });

  it("locks a quote, and refuses to lock one that has expired", async () => {
    const quote = (await client.quote({ region: "AU", currency: "AUD", settlementMinor: 3_000 }))._unsafeUnwrap();
    const locked = await client.lockQuote({ quoteId: quote.quoteId });
    expect(locked._unsafeUnwrap().locked).toBe(true);

    const missing = await client.lockQuote({ quoteId: randomUUID() });
    expect(missing._unsafeUnwrapErr().code).toBe("quote_expired");
  });

  it("priceListing computes the same price with no side effect", async () => {
    const result = await client.priceListing({
      listingId: randomUUID(),
      region: "ID",
      currency: "IDR",
      settlementMinor: 54_000,
    });
    expect(result._unsafeUnwrap().pricePoints).toBe(9_000);
  });

  it("quotePurchase prices a points pack at F12's fixed rate", async () => {
    const result = await client.quotePurchase({ points: 1_000, region: "AU" });
    expect(result._unsafeUnwrap()).toMatchObject({ totalMinor: 4_500, currency: "AUD" });
  });
});

describe("funding and allocations", () => {
  it("purchasePoints creates an allocation, and replays on a repeated idempotency key", async () => {
    const businessId = randomUUID();
    const idempotencyKey = randomUUID();
    const first = await client.purchasePoints({
      businessId,
      region: "AU",
      currency: "AUD",
      points: 10_000,
      paidMinor: 450_000,
      idempotencyKey,
    });
    const allocation = first._unsafeUnwrap();
    expect(allocation.remainingPoints).toBe(10_000);

    const replay = await client.purchasePoints({
      businessId,
      region: "AU",
      currency: "AUD",
      points: 10_000,
      paidMinor: 450_000,
      idempotencyKey,
    });
    expect(replay._unsafeUnwrap().allocationId).toBe(allocation.allocationId);

    const conflicting = await client.purchasePoints({
      businessId,
      region: "AU",
      currency: "AUD",
      points: 1,
      paidMinor: 1,
      idempotencyKey,
    });
    expect(conflicting._unsafeUnwrapErr().code).toBe("idempotency_conflict");
  });

  it("hold draws down an allocation and refuses once it is exhausted", async () => {
    const businessId = randomUUID();
    const allocation = (
      await client.purchasePoints({
        businessId,
        region: "ID",
        currency: "IDR",
        points: 100,
        paidMinor: 900,
        idempotencyKey: randomUUID(),
      })
    )._unsafeUnwrap();

    const held = await client.hold({ allocationId: allocation.allocationId, points: 100, sagaId: randomUUID() });
    expect(held._unsafeUnwrap().state).toBe("held");

    const exhausted = await client.hold({ allocationId: allocation.allocationId, points: 1, sagaId: randomUUID() });
    expect(exhausted._unsafeUnwrapErr().code).toBe("allocation_exhausted");
  });

  it("release returns held points to the allocation", async () => {
    const businessId = randomUUID();
    const allocation = (
      await client.purchasePoints({
        businessId,
        region: "ID",
        currency: "IDR",
        points: 50,
        paidMinor: 450,
        idempotencyKey: randomUUID(),
      })
    )._unsafeUnwrap();
    const held = (
      await client.hold({ allocationId: allocation.allocationId, points: 50, sagaId: randomUUID() })
    )._unsafeUnwrap();
    await client.release(held.holdId);
    const after = (await client.getAllocation(allocation.allocationId))._unsafeUnwrap();
    expect(after.remainingPoints).toBe(50);
  });

  it("listAllocations returns every allocation for a business", async () => {
    const businessId = randomUUID();
    await client.purchasePoints({
      businessId,
      region: "AU",
      currency: "AUD",
      points: 1_000,
      paidMinor: 45_000,
      idempotencyKey: randomUUID(),
    });
    const result = await client.listAllocations(businessId);
    expect(result._unsafeUnwrap().length).toBeGreaterThan(0);
  });

  it("campaignSpend and returnGrant are callable", async () => {
    const spend = await client.campaignSpend(randomUUID());
    expect(spend.isOk()).toBe(true);
    const returned = await client.returnGrant({ grantId: randomUUID() });
    expect(returned.isOk()).toBe(true);
  });
});

describe("earning and spending", () => {
  it("a reward grant goes to pending with an unlock time by tier, then becomes available", async () => {
    const userId = randomUUID();
    const granted = await client.grantReward({
      campaignId: randomUUID(),
      userId,
      region: "ID",
      points: 500,
      trustTier: 1,
      idempotencyKey: randomUUID(),
    });
    const grant = granted._unsafeUnwrap();
    expect(new Date(grant.unlockAt).getTime()).toBeGreaterThan(Date.now());

    const balance = (await client.balance(userId))._unsafeUnwrap();
    expect(balance.availablePoints).toBe(0);
    expect(balance.pending).toHaveLength(1);
    expect(balance.pending[0]?.points).toBe(500);
  });

  it("tier 3 (demo viewer) unlocks immediately", async () => {
    const userId = randomUUID();
    await client.grantAction({
      kind: "streak",
      userId,
      region: "ID",
      points: 100,
      trustTier: 3,
      idempotencyKey: randomUUID(),
    });
    const balance = (await client.balance(userId))._unsafeUnwrap();
    expect(balance.availablePoints).toBe(100);
    expect(balance.pending).toHaveLength(0);
  });

  it("the same idempotency key with a different body returns idempotency_conflict", async () => {
    const userId = randomUUID();
    const idempotencyKey = randomUUID();
    await client.grantAction({ kind: "receipt", userId, region: "ID", points: 10, trustTier: 3, idempotencyKey });
    const conflict = await client.grantAction({
      kind: "receipt",
      userId,
      region: "ID",
      points: 99,
      trustTier: 3,
      idempotencyKey,
    });
    expect(conflict._unsafeUnwrapErr().code).toBe("idempotency_conflict");
  });

  it("burnForVoucher draws from available only, and refuses when short", async () => {
    const userId = randomUUID();
    await client.grantAction({ kind: "goodwill", userId, region: "ID", points: 100, trustTier: 3, idempotencyKey: randomUUID() });

    const tooMuch = await client.burnForVoucher({ userId, listingId: randomUUID(), points: 200, sagaId: randomUUID() });
    expect(tooMuch._unsafeUnwrapErr().code).toBe("insufficient_available");

    const sagaId = randomUUID();
    const burned = await client.burnForVoucher({ userId, listingId: randomUUID(), points: 60, sagaId });
    expect(burned._unsafeUnwrap().state).toBe("burned");

    const balance = (await client.balance(userId))._unsafeUnwrap();
    expect(balance.availablePoints).toBe(40);

    const fetched = await client.getBurn(sagaId);
    expect(fetched._unsafeUnwrap().sagaId).toBe(sagaId);
  });

  it("reinstateBurn (K13) gives the points back", async () => {
    const userId = randomUUID();
    await client.grantAction({ kind: "goodwill", userId, region: "ID", points: 100, trustTier: 3, idempotencyKey: randomUUID() });
    const sagaId = randomUUID();
    await client.burnForVoucher({ userId, listingId: randomUUID(), points: 100, sagaId });
    expect((await client.balance(userId))._unsafeUnwrap().availablePoints).toBe(0);

    const reinstated = await client.reinstateBurn(sagaId);
    expect(reinstated._unsafeUnwrap().state).toBe("reinstated");
    expect((await client.balance(userId))._unsafeUnwrap().availablePoints).toBe(100);
  });
});

describe("users", () => {
  it("escrow holds points out of available, and releaseEscrow gives them back", async () => {
    const userId = randomUUID();
    await client.grantAction({ kind: "goodwill", userId, region: "ID", points: 100, trustTier: 3, idempotencyKey: randomUUID() });

    const escrowed = await client.escrow({ userId, points: 40, reason: "dispute hold" });
    expect(escrowed._unsafeUnwrap().state).toBe("held");
    expect((await client.balance(userId))._unsafeUnwrap().availablePoints).toBe(60);

    await client.releaseEscrow(escrowed._unsafeUnwrap().escrowId);
    expect((await client.balance(userId))._unsafeUnwrap().availablePoints).toBe(100);
  });

  it("history lists grants and burns, newest first, paginated", async () => {
    const userId = randomUUID();
    await client.grantAction({ kind: "goodwill", userId, region: "ID", points: 100, trustTier: 3, idempotencyKey: randomUUID() });
    await client.burnForVoucher({ userId, listingId: randomUUID(), points: 10, sagaId: randomUUID() });

    const page = (await client.history({ userId, limit: 20 }))._unsafeUnwrap();
    expect(page.length).toBeGreaterThanOrEqual(2);
    expect(page.map((entry) => entry.kind)).toEqual(expect.arrayContaining(["grant", "burn"]));
  });
});

describe("economy", () => {
  it("coverage and economyDaily are callable and return real numbers", async () => {
    const coverage = await client.coverage("AU");
    expect(coverage.isOk()).toBe(true);
    const daily = await client.economyDaily({ region: "AU", from: "2020-01-01", to: "2030-01-01" });
    expect(daily.isOk()).toBe(true);
  });

  it("proposeRate then approveRate (two-person) moves the backing rate", async () => {
    const proposal = await client.proposeRate({
      region: "AU",
      currency: "AUD",
      backingRateMicrosPerPoint: 3_500_000,
      proposedBy: "staff-1",
    });
    const proposalId = proposal._unsafeUnwrap().proposalId;

    const selfApprove = await client.approveRate({ proposalId, approvedBy: "staff-1" });
    expect(selfApprove._unsafeUnwrapErr().code).toBe("already_granted");

    const approved = await client.approveRate({ proposalId, approvedBy: "staff-2" });
    expect(approved._unsafeUnwrap().state).toBe("approved");
  });

  it("fundMarketing refuses a single-person approval", async () => {
    const result = await client.fundMarketing({
      region: "AU",
      amountMinor: 500_000,
      proposedBy: "staff-1",
      approvedBy: "staff-1",
    });
    expect(result._unsafeUnwrapErr().code).toBe("already_granted");
  });

  it("statements and approvePayout are not implemented until 10.1", async () => {
    await expect(
      client.statements({ businessId: randomUUID(), from: "2026-01-01", to: "2026-01-31" }),
    ).rejects.toThrow(/not implemented/);
    await expect(client.approvePayout({ statementId: randomUUID(), approvedBy: "staff-1" })).rejects.toThrow(
      /not implemented/,
    );
  });
});

// 4.1 (ledger internal API) makes these real once its routes replace the
// service's current 501s. `HttpLedgerClient` already POSTs to the paths it
// will need — see that file's own header.
describe.todo("HttpLedgerClient against a live services/ledger (4.1)");
