import { randomUUID } from "node:crypto";
import { errAsync, okAsync, ok } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { PurchasePointsRequest } from "@yourtal/contracts/ledger-internal/funding";
import type { QuotePackageRequest } from "@yourtal/contracts/ledger-internal/pricing";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { createSimulatedPayments, simulatedProcessorUnits } from "@yourtal/drivers/payments";
import type { PaymentsDriver } from "@yourtal/drivers/payments";
import { createStripePayments } from "@yourtal/drivers/stripe/payments";
import { PaymentEventHandlers } from "../../payments/payment-event-handlers";
import { stripeRouteFetch } from "../../payments/testing/stripe-route-fetch";
import type { CardPurchaseRow, NewCardPurchase } from "../persistence/card-purchase.repository";
import { fulfilPurchase } from "./fulfil-purchase.use-case";
import { registerPurchaseEvents } from "./purchase-events";
import { listPackages, quotePurchase } from "./quote-purchase.use-case";
import { startPurchase } from "./start-purchase.use-case";

const BUSINESS = "0c4f0e8e-6a8f-4a39-9b67-2f4b4d1a0b11";
const NOW = new Date("2026-10-20T10:00:00.000Z");

function memoryPurchases() {
  const rows = new Map<string, CardPurchaseRow>();
  const update = (id: string, open: readonly string[], patch: Partial<CardPurchaseRow>) => {
    const row = rows.get(id);
    if (row !== undefined && open.includes(row.status)) rows.set(id, { ...row, ...patch });
    return Promise.resolve();
  };
  return {
    rows,
    insertOnce: (p: NewCardPurchase) => {
      const existing = [...rows.values()].find((r) => r.idempotencyKey === p.idempotencyKey);
      if (existing !== undefined) return Promise.resolve(existing);
      const row: CardPurchaseRow = {
        ...p,
        id: randomUUID(),
        checkoutRef: null,
        status: "pending",
        allocationId: null,
        createdAt: NOW,
        paidAt: null,
      };
      rows.set(row.id, row);
      return Promise.resolve(row);
    },
    find: (id: string) => Promise.resolve(rows.get(id) ?? null),
    attachCheckout: (id: string, checkoutRef: string) => update(id, ["pending"], { checkoutRef }),
    markPaid: (id: string, _ref: string | null, allocationId: string) =>
      update(id, ["pending", "expired"], { status: "paid", allocationId, paidAt: NOW }),
    markNeedsReview: (id: string) => update(id, ["pending", "expired"], { status: "needs_review" }),
    markExpired: (id: string) => update(id, ["pending"], { status: "expired" }),
  };
}

/** F122's AU tiers as the ledger prices them (P_issue 4.5c a point). */
const TIERS = {
  starter: { points: 1_000, discountBps: 0, totalMinor: 4_500, undiscountedMinor: 4_500 },
  grow: { points: 10_000, discountBps: 500, totalMinor: 42_750, undiscountedMinor: 45_000 },
} as const;

function tierQuote(tierKey: keyof typeof TIERS) {
  const tier = TIERS[tierKey];
  return {
    tierKey,
    points: toPoints(tier.points),
    discountBps: tier.discountBps,
    totalMinor: toMinorUnits(tier.totalMinor),
    undiscountedMinor: toMinorUnits(tier.undiscountedMinor),
    currency: "AUD" as const,
    pricing: "tier" as const,
  };
}

function fakeLedger(refuse?: {
  code: "refused" | "kill_switch" | "already_granted";
  message: string;
}) {
  const grants: PurchasePointsRequest[] = [];
  return {
    grants,
    packageTiers: () => okAsync([tierQuote("starter"), tierQuote("grow")]),
    quotePackage: (request: QuotePackageRequest) =>
      request.tierKey in TIERS
        ? okAsync(tierQuote(request.tierKey as keyof typeof TIERS))
        : errAsync({ code: "refused" as const, message: "no such package tier" }),
    purchasePoints: (request: PurchasePointsRequest) => {
      grants.push(request);
      if (refuse !== undefined) return errAsync(refuse);
      return okAsync({
        allocationId: `alloc_${request.idempotencyKey}`,
        businessId: request.businessId,
        region: request.region,
        funderType: "partner" as const,
        totalPoints: request.points,
        remainingPoints: request.points,
        programme: null,
        createdAt: NOW.toISOString(),
      });
    },
    getAllocation: () => errAsync({ code: "refused" as const, message: "not used" }),
  };
}

function memoryRefunds() {
  const settled: { paymentRef: string; refundRef: string }[] = [];
  return {
    settled,
    settleFromEvent: (paymentRef: string, refundRef: string) => {
      settled.push({ paymentRef, refundRef });
      return Promise.resolve(true);
    },
  };
}

function deps(driver: PaymentsDriver, ledger = fakeLedger(), purchases = memoryPurchases()) {
  return {
    ledger,
    purchases,
    refunds: memoryRefunds(),
    businesses: {
      findRegionAndCurrency: () =>
        Promise.resolve({ region: "AU" as const, currency: "AUD" as const }),
    },
    settings: { getSetting: <T>() => Promise.resolve({ rateBps: 1_000 } as T) },
    accounts: { ensureCustomer: () => Promise.resolve(ok("cus_1")), driverFor: () => driver },
    webOrigin: "https://web.test",
    now: () => NOW,
  };
}

const command = (key = "biz:key-1") => ({
  merchantId: BUSINESS,
  tierKey: "starter",
  currency: "AUD",
  idempotencyKey: key,
});

function stripe() {
  const double = stripeRouteFetch({
    "POST /v1/checkout/sessions": {
      id: "cs_test_buy",
      object: "checkout.session",
      url: "http://pay.test/cs",
    },
  });
  const driver = createStripePayments({
    apiBase: "http://stripe.test",
    secretKey: "sk_test_unit",
    webhookSecret: "whsec_unit",
    fetch: double.fetch,
  });
  return { driver, calls: double.calls };
}

describe("point packages (F118, F122)", () => {
  it("adds GST on top of the ex-GST package price", async () => {
    const d = deps(createSimulatedPayments());
    const quote = (await quotePurchase(d, BUSINESS, "starter"))._unsafeUnwrap();
    expect(quote).toEqual({
      tierKey: "starter",
      points: 1_000,
      discountBps: 0,
      subtotalMinor: 4_500,
      taxMinor: 450,
      totalMinor: 4_950,
      taxRateBps: 1_000,
      currency: "AUD",
      pricePer1000Minor: 4_500,
      savingMinor: 0,
      pricing: "tier",
    });
  });

  it("lists every package with its price per 1,000 and its saving", async () => {
    const d = deps(createSimulatedPayments());
    const { packages } = (await listPackages(d, BUSINESS))._unsafeUnwrap();
    expect(packages.map((p) => p.tierKey)).toEqual(["starter", "grow"]);
    // Grow: A$427.50 ex-GST, A$42.75 GST, A$470.25 total; A$42.75 per 1,000; A$22.50 saved.
    expect(packages[1]).toMatchObject({
      subtotalMinor: 42_750,
      taxMinor: 4_275,
      totalMinor: 47_025,
      pricePer1000Minor: 4_275,
      savingMinor: 2_250,
    });
  });

  it("passes an unknown package's refusal through", async () => {
    const d = deps(createSimulatedPayments());
    expect((await quotePurchase(d, BUSINESS, "platinum"))._unsafeUnwrapErr()).toMatchObject({
      type: "ledger_refused",
      code: "refused",
    });
  });
});

describe("startPurchase on Stripe", () => {
  it("opens a 31-minute checkout for the GST-inclusive total and grants nothing yet", async () => {
    const { driver, calls } = stripe();
    const d = deps(driver);
    const result = (await startPurchase(d, command()))._unsafeUnwrap();

    expect(result).toMatchObject({
      status: "awaiting_payment",
      checkoutUrl: "http://pay.test/cs",
      allocation: null,
    });
    expect(result.purchase).toMatchObject({
      subtotalMinor: 4_500,
      taxMinor: 450,
      totalMinor: 4_950,
    });
    const body = calls[0]?.body;
    expect(body?.get("line_items[0][price_data][unit_amount]")).toBe("4950");
    expect(body?.get("client_reference_id")).toBe(`card-purchase:${result.purchaseId}`);
    expect(body?.get("success_url")).toBe(
      `https://web.test/studio/billing?business=${BUSINESS}&purchase=${result.purchaseId}`,
    );
    expect(body?.get("cancel_url")).toContain("&cancelled=1");
    expect(Number(body?.get("expires_at"))).toBe(NOW.getTime() / 1000 + 31 * 60);
    expect(calls[0]?.idempotencyKey).toBe(`card-purchase:${result.purchaseId}`);
    expect(d.ledger.grants).toEqual([]);
    expect(d.purchases.rows.get(result.purchaseId)?.checkoutRef).toBe("cs_test_buy");
  });

  it("answers a replayed key with the same purchase and the same checkout request", async () => {
    const { driver, calls } = stripe();
    const d = deps(driver);
    const first = (await startPurchase(d, command()))._unsafeUnwrap();
    const again = (await startPurchase(d, command()))._unsafeUnwrap();
    expect(again.purchaseId).toBe(first.purchaseId);
    expect(calls.map((c) => c.idempotencyKey)).toEqual([
      calls[0]?.idempotencyKey,
      calls[0]?.idempotencyKey,
    ]);
    expect(calls[1]?.body.toString()).toBe(calls[0]?.body.toString());
    expect(d.purchases.rows.size).toBe(1);
  });

  it("refuses a key reused for a different purchase, and a currency the business is not billed in", async () => {
    const d = deps(stripe().driver);
    expect((await startPurchase(d, command())).isOk()).toBe(true);
    expect((await startPurchase(d, { ...command(), tierKey: "grow" }))._unsafeUnwrapErr()).toEqual({
      type: "purchase_conflict",
    });
    expect(
      (await startPurchase(d, { ...command("other"), currency: "IDR" }))._unsafeUnwrapErr(),
    ).toMatchObject({
      type: "currency_mismatch",
    });
  });
});

describe("startPurchase on the simulated driver (Indonesia, tests)", () => {
  it("settles at once and grants the ex-GST subtotal under the purchase's own key", async () => {
    const d = deps(
      createSimulatedPayments(undefined, { declaredMinorUnitExponent: simulatedProcessorUnits() }),
    );
    const result = (await startPurchase(d, command()))._unsafeUnwrap();
    expect(result.status).toBe("paid");
    expect(result.allocation?.totalPoints).toBe(1_000);
    expect(d.ledger.grants).toEqual([
      expect.objectContaining({
        paidMinor: 4_500,
        points: 1_000,
        idempotencyKey: "biz:key-1",
        tierKey: "starter",
      }),
    ]);
  });

  it("buys Grow's 10,000 points at its discount, the tier recorded on the purchase", async () => {
    const d = deps(
      createSimulatedPayments(undefined, { declaredMinorUnitExponent: simulatedProcessorUnits() }),
    );
    const result = (await startPurchase(d, { ...command(), tierKey: "grow" }))._unsafeUnwrap();
    expect(result.purchase).toMatchObject({
      tierKey: "grow",
      points: 10_000,
      subtotalMinor: 42_750,
      totalMinor: 47_025,
    });
    expect(d.ledger.grants).toEqual([
      expect.objectContaining({ paidMinor: 42_750, points: 10_000, tierKey: "grow" }),
    ]);
  });
});

describe("fulfilPurchase and the webhook handlers", () => {
  async function pendingOnStripe(ledger = fakeLedger()) {
    const d = deps(stripe().driver, ledger);
    const started = (await startPurchase(d, command()))._unsafeUnwrap();
    const handlers = new PaymentEventHandlers();
    registerPurchaseEvents(handlers, d);
    const paid = (amountMinor: number, eventId = "evt_1", checkoutReference = "cs_test_buy") =>
      handlers.dispatch({
        type: "checkout.completed",
        eventId,
        checkoutReference,
        mode: "payment",
        reference: `card-purchase:${started.purchaseId}`,
        paymentReference: "pi_1",
        amountMinor,
        currency: "AUD",
        customerRef: "cus_1",
        paymentMethodRef: null,
      });
    return { d, handlers, id: started.purchaseId, paid };
  }

  it("grants once for the paid total, however many deliveries arrive", async () => {
    const { d, id, paid } = await pendingOnStripe();
    await paid(4_950);
    await paid(4_950, "evt_2");
    expect(d.ledger.grants).toHaveLength(1);
    expect(d.purchases.rows.get(id)).toMatchObject({
      status: "paid",
      allocationId: "alloc_biz:key-1",
    });
  });

  it("parks a payment that does not match the purchase, and grants nothing", async () => {
    const { d, id, paid } = await pendingOnStripe();
    await paid(4_500);
    expect(d.ledger.grants).toEqual([]);
    expect(d.purchases.rows.get(id)?.status).toBe("needs_review");
  });

  it("parks money paid through a checkout this purchase did not open", async () => {
    const { d, id, paid } = await pendingOnStripe();
    await paid(4_950, "evt_3", "cs_test_other");
    expect(d.purchases.rows.get(id)?.status).toBe("needs_review");
  });

  it("parks a paid purchase the ledger refuses (the rate rose), never dropping it", async () => {
    const { d, id, paid } = await pendingOnStripe(
      fakeLedger({ code: "refused", message: "below the issue price" }),
    );
    await paid(4_950);
    expect(d.purchases.rows.get(id)?.status).toBe("needs_review");
  });

  it("throws on a refusal that passes, so the delivery is retried", async () => {
    const { d, id, paid } = await pendingOnStripe(
      fakeLedger({ code: "kill_switch", message: "paused" }),
    );
    await expect(paid(4_950)).rejects.toThrow(/kill_switch/);
    expect(d.purchases.rows.get(id)?.status).toBe("pending");
  });

  it("retries, never parks, when a concurrent delivery recorded the purchase first", async () => {
    const { d, id, paid } = await pendingOnStripe(
      fakeLedger({ code: "already_granted", message: "purchase recorded" }),
    );
    await expect(paid(4_950)).rejects.toThrow(/already_granted/);
    expect(d.purchases.rows.get(id)?.status).toBe("pending");
  });

  it("closes a purchase whose checkout expired, and still grants if it is paid after all", async () => {
    const { d, handlers, id, paid } = await pendingOnStripe();
    await handlers.dispatch({
      type: "checkout.expired",
      eventId: "evt_x",
      checkoutReference: "cs_test_buy",
      reference: `card-purchase:${id}`,
    });
    expect(d.purchases.rows.get(id)?.status).toBe("expired");
    await paid(4_950);
    expect(d.purchases.rows.get(id)?.status).toBe("paid");
  });

  it("ignores events that are not a card purchase", async () => {
    const { d, handlers } = await pendingOnStripe();
    await handlers.dispatch({
      type: "checkout.expired",
      eventId: "evt_y",
      checkoutReference: "cs_other",
      reference: "card-setup:6f0e1d1a-3b7e-4c55-9d43-2b1d2d1f0a01",
    });
    expect([...d.purchases.rows.values()].map((r) => r.status)).toEqual(["pending"]);
  });

  it("never turns a refunded purchase into points when its payment is delivered again (F123)", async () => {
    const { d, id } = await pendingOnStripe();
    const row = d.purchases.rows.get(id);
    if (row === undefined) throw new Error("no row");
    const refunded = { ...row, status: "refunded" as const };
    const result = await fulfilPurchase(d, refunded, {
      amountMinor: row.totalMinor,
      currency: "AUD",
      paymentRef: "pi_1",
    });
    expect(result.row).toBe(refunded);
    expect(d.ledger.grants).toEqual([]);
  });

  it("hands a refund.succeeded to the refund settler, by the payment it refunds", async () => {
    const { d, handlers } = await pendingOnStripe();
    await handlers.dispatch({
      type: "refund.succeeded",
      eventId: "evt_refund",
      refundReference: "re_1",
      paymentReference: "pi_1",
      amountMinor: 4_950,
      currency: "AUD",
    });
    expect(d.refunds.settled).toEqual([{ paymentRef: "pi_1", refundRef: "re_1" }]);
  });

  it("leaves an already-paid purchase alone", async () => {
    const { d, id } = await pendingOnStripe();
    const row = d.purchases.rows.get(id);
    if (row === undefined) throw new Error("no row");
    const paidRow = { ...row, status: "paid" as const, allocationId: "alloc" };
    const result = await fulfilPurchase(d, paidRow, {
      amountMinor: 1,
      currency: "AUD",
      paymentRef: null,
    });
    expect(result.row).toBe(paidRow);
    expect(d.ledger.grants).toEqual([]);
    expect(toPoints(row.points)).toBe(1_000);
  });
});
