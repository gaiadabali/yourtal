import { randomUUID } from "node:crypto";
import { err, ok, okAsync } from "neverthrow";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CaptureRequest,
  HoldRequest,
  MarketplacePaymentsDriver,
  ReleaseRequest,
} from "@yourtal/drivers/marketplace-payments";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { VoucherInternalClient } from "../../shared/voucher-client/voucher-internal-client";
import { PaymentEventHandlers } from "../payments/payment-event-handlers";
import type { GiftParty } from "../wallet/gift-party-reader";
import { registerAuctionPaymentEvents } from "./auction-payment-events";
import { AuctionStore } from "./persistence/auction-store";
import { listVoucher, placeBid } from "./use-cases/list-and-bid";
import { settleAuction } from "./use-cases/settle-auction";

/**
 * 5.1.d against real Postgres: the bid and settlement rules with a Stripe-shaped marketplace driver
 * that records what it is asked. (The real Stripe driver against the payment simulation is
 * `auction-stripe.e2e.test.ts`.) A bid needs a card and an `acct_` charity; settlement captures into
 * that account and releases the rest by their own keys; a cancelled hold is not touched again.
 */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!;
let pool: pg.Pool;
let store: AuctionStore;

beforeAll(() => {
  pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
  store = new AuctionStore(createAppDb(DATABASE_URL));
});
afterAll(() => pool.end());

interface Recorder extends MarketplacePaymentsDriver {
  readonly holds: HoldRequest[];
  /** The `pi_�` each hold was answered with, in order. */
  readonly issued: string[];
  readonly captures: CaptureRequest[];
  readonly releases: ReleaseRequest[];
  readonly failCapture: Set<string>;
}

/** Stripe's shape: a saved card is needed, and every hold is a `pi_…` the test can name. */
function stripeLike(): Recorder {
  const recorder: Recorder = {
    holds: [],
    issued: [],
    captures: [],
    releases: [],
    failCapture: new Set(),
    mode: "live",
    provider: "stripe",
    declaredMinorUnitExponent: { AUD: 2, IDR: 0 },
    needsSavedCard: true,
    hold(request) {
      recorder.holds.push(request);
      const holdReference = `pi_${randomUUID().slice(0, 12)}`;
      recorder.issued.push(holdReference);
      return Promise.resolve(ok({ holdReference, providerAmount: request.amountMinor }));
    },
    capture(request) {
      recorder.captures.push(request);
      if (recorder.failCapture.has(request.holdReference)) {
        return Promise.resolve(
          err({ kind: "declined", boundary: "payments", detail: "no", mayHaveSucceeded: false }),
        );
      }
      return Promise.resolve(
        ok({
          captureReference: request.holdReference,
          destinationReference: request.destinationReference,
          providerAmount: request.amountMinor,
        }),
      );
    },
    release(request) {
      if (typeof request === "string") throw new Error("the string form of release is retired");
      recorder.releases.push(request);
      return Promise.resolve(ok(undefined));
    },
  };
  return recorder;
}

const vouchers = { escrowRelease: () => okAsync({}) } as unknown as VoucherInternalClient;

function party(): GiftParty {
  return {
    userId: randomUUID(),
    region: "AU",
    dateOfBirth: "1990-01-01",
    suspended: false,
    displayName: "Bidder",
    displayLocale: "en-AU",
    email: `bidder-${randomUUID()}@example.test`,
  };
}

const CARD = {
  customerRef: "cus_test",
  paymentMethodRef: "pm_test",
  card: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2034 },
};
const withCard = { liveCard: () => Promise.resolve(CARD) };
const noCard = { liveCard: () => Promise.resolve(null) };

async function charity(payout: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO charity.charity (id, region, name, cause, summary, registration,
       payout_account_name, payout_account_last4, kyb_reference, payout_reference, state,
       applied_by, decided_by, decided_at)
     VALUES ($1, 'AU', 'Coastal Test Trust', 'education', 'test', $2, 'Coastal Test Trust', '1234',
             'simkyb', $3, 'approved', $4, 'staff', now())`,
    [
      id,
      JSON.stringify({ kind: "au_acnc", abn: "51824753524", acncRegistered: true }),
      payout,
      randomUUID(),
    ],
  );
  await pool.query(`INSERT INTO charity.member (charity_id, user_id) VALUES ($1, $2)`, [
    id,
    randomUUID(),
  ]);
  return id;
}

const connectedAccount = () => `acct_${randomUUID().slice(0, 12)}`;

async function openAuction(charityId: string): Promise<string> {
  const id = randomUUID();
  await store.insert({
    id,
    region: "AU",
    currency: "AUD",
    sellerId: randomUUID(),
    charityId,
    sourceVoucherId: randomUUID(),
    voucherId: randomUUID(),
    listingId: randomUUID(),
    title: "Coffee voucher",
    merchantName: "Kopi",
    category: "food-and-drink",
    faceValueMinor: 5_000,
    voucherExpiresAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
    reserveMinor: 2_500,
    endsAt: new Date(Date.now() + 3 * 86_400_000),
  });
  return id;
}

const close = (auctionId: string) =>
  pool.query(`UPDATE auction.auction SET ends_at = now() - interval '1 second' WHERE id = $1`, [
    auctionId,
  ]);

interface BidRow {
  readonly id: string;
  readonly hold_reference: string;
  readonly state: string;
}

/** The auction's bids, lowest amount first. */
async function bids(auctionId: string): Promise<BidRow[]> {
  const { rows } = await pool.query<BidRow>(
    `SELECT id, hold_reference, state FROM auction.bid WHERE auction_id = $1 ORDER BY amount_minor`,
    [auctionId],
  );
  return rows;
}

type Accounts = { liveCard: () => Promise<typeof CARD | null> };
const deps = (marketplace: Recorder, accounts: Accounts) => ({
  store,
  marketplace: () => marketplace,
  accounts,
});
const settleDeps = (driver: Recorder) => ({ store, marketplace: () => driver, vouchers });

describe("a bid on a Stripe region (5.1.d)", () => {
  it("is refused charity_not_ready without a connected account, and card_required without a card", async () => {
    const driver = stripeLike();
    const notReady = await openAuction(await charity(`simpayout_${randomUUID().slice(0, 8)}`));
    await expect(placeBid(deps(driver, withCard), party(), notReady, 2_500)).rejects.toMatchObject({
      response: { code: "charity_not_ready" },
    });

    const ready = await openAuction(await charity(connectedAccount()));
    await expect(placeBid(deps(driver, noCard), party(), ready, 2_500)).rejects.toMatchObject({
      response: { code: "card_required" },
    });
    expect(driver.holds).toEqual([]);
    expect(await bids(notReady)).toEqual([]);
    expect(await bids(ready)).toEqual([]);
  });

  it("holds the bidder's card towards the charity's account, and releases their earlier hold by its own key", async () => {
    const driver = stripeLike();
    const account = connectedAccount();
    const auctionId = await openAuction(await charity(account));
    const bidder = party();

    await placeBid(deps(driver, withCard), bidder, auctionId, 2_500);
    await placeBid(deps(driver, withCard), bidder, auctionId, 3_000);

    expect(driver.holds).toHaveLength(2);
    expect(driver.holds[0]).toMatchObject({
      amountMinor: 2_500,
      currency: "AUD",
      reference: `auction:${auctionId}`,
      customerRef: "cus_test",
      paymentMethodRef: "pm_test",
      destinationReference: account,
    });
    const [first, second] = await bids(auctionId);
    expect(driver.releases).toEqual([
      { idempotencyKey: `auction-bid-release:${first?.id}`, holdReference: first?.hold_reference },
    ]);
    expect([first?.state, second?.state]).toEqual(["released", "held"]);
  });

  it("lets go of a hold whose bid could not be recorded", async () => {
    const driver = stripeLike();
    const auctionId = await openAuction(await charity(connectedAccount()));
    const broken = Object.create(store) as AuctionStore;
    broken.heldBids = () => Promise.reject(new Error("the database went away"));

    await expect(
      placeBid({ ...deps(driver, withCard), store: broken }, party(), auctionId, 2_500),
    ).rejects.toThrow("the database went away");
    expect(driver.releases).toEqual([
      {
        idempotencyKey: expect.stringMatching(/^auction-bid-undo:/) as string,
        holdReference: driver.issued[0],
      },
    ]);
    expect(await bids(auctionId)).toEqual([]);
  });
});

describe("listing for a charity on a Stripe region (5.1.d)", () => {
  it("is refused charity_not_ready before the voucher goes into escrow", async () => {
    const charityId = await charity(`simpayout_${randomUUID().slice(0, 8)}`);
    const untouchable = new Proxy(
      {},
      {
        get: () => () => {
          throw new Error("the voucher service must not be called");
        },
      },
    ) as VoucherInternalClient;
    await expect(
      listVoucher(
        { store, vouchers: untouchable, marketplace: () => stripeLike() },
        party(),
        randomUUID(),
        charityId,
      ),
    ).rejects.toMatchObject({ response: { code: "charity_not_ready" } });
  });
});

describe("settling a Stripe auction (5.1.d)", () => {
  it("captures the winner into the charity's account and releases the rest by their own keys", async () => {
    const driver = stripeLike();
    const account = connectedAccount();
    const auctionId = await openAuction(await charity(account));
    await placeBid(deps(driver, withCard), party(), auctionId, 2_500);
    await placeBid(deps(driver, withCard), party(), auctionId, 3_000);
    const [low, high] = await bids(auctionId);
    await close(auctionId);

    const settled = await settleAuction(settleDeps(driver), auctionId);
    expect(settled).toMatchObject({ outcome: "sold", amountMinor: 3_000 });

    expect(driver.captures).toEqual([
      {
        idempotencyKey: `auction-capture:${auctionId}:${high?.id}`,
        holdReference: high?.hold_reference,
        amountMinor: 3_000,
        currency: "AUD",
        destinationReference: account,
      },
    ]);
    expect(driver.releases).toEqual([
      { idempotencyKey: `auction-release:${low?.id}`, holdReference: low?.hold_reference },
    ]);
    expect((await bids(auctionId)).map((b) => b.state)).toEqual(["released", "captured"]);
    const { rows } = await pool.query(
      `SELECT destination_reference, capture_reference FROM auction.settlement WHERE auction_id = $1`,
      [auctionId],
    );
    expect(rows[0]).toEqual({
      destination_reference: account,
      capture_reference: high?.hold_reference,
    });
  });

  it("falls to the next bid when the capture fails", async () => {
    const driver = stripeLike();
    const auctionId = await openAuction(await charity(connectedAccount()));
    await placeBid(deps(driver, withCard), party(), auctionId, 2_500);
    await placeBid(deps(driver, withCard), party(), auctionId, 3_000);
    const [low, high] = await bids(auctionId);
    driver.failCapture.add(high?.hold_reference ?? "");
    await close(auctionId);

    const settled = await settleAuction(settleDeps(driver), auctionId);
    expect(settled).toMatchObject({ outcome: "sold", amountMinor: 2_500 });
    expect(driver.captures.map((c) => c.holdReference)).toEqual([
      high?.hold_reference,
      low?.hold_reference,
    ]);
    expect((await bids(auctionId)).map((b) => b.state)).toEqual(["captured", "capture_failed"]);
  });

  it("never captures or releases a hold the provider cancelled, and a replay changes nothing", async () => {
    const driver = stripeLike();
    const auctionId = await openAuction(await charity(connectedAccount()));
    await placeBid(deps(driver, withCard), party(), auctionId, 2_500);
    await placeBid(deps(driver, withCard), party(), auctionId, 3_000);
    const [low, high] = await bids(auctionId);

    // Stripe's 7-day sweep (or any other cancellation) of the higher bid's hold.
    const handlers = new PaymentEventHandlers();
    registerAuctionPaymentEvents(handlers, store);
    const event = {
      type: "payment.canceled" as const,
      eventId: `evt_${randomUUID()}`,
      paymentReference: high?.hold_reference ?? "",
      reference: `auction:${auctionId}`,
      reason: "automatic",
    };
    await handlers.dispatch(event);
    await handlers.dispatch(event);
    expect((await bids(auctionId)).map((b) => b.state)).toEqual(["held", "released"]);
    expect(await store.markHoldCanceled(high?.hold_reference ?? "")).toBe(false);
    // A payment that is not a bid's hold changes nothing.
    await handlers.dispatch({ ...event, paymentReference: "pi_somebody_elses" });
    expect((await bids(auctionId)).map((b) => b.state)).toEqual(["held", "released"]);

    await close(auctionId);
    const settled = await settleAuction(settleDeps(driver), auctionId);
    expect(settled).toMatchObject({ outcome: "sold", amountMinor: 2_500 });
    expect(driver.captures.map((c) => c.holdReference)).toEqual([low?.hold_reference]);
    expect(driver.releases).toEqual([]);
  });
});
