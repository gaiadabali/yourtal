import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { receiptFunderKey } from "@yourtal/contracts/billing/receipt-funder";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { regionDateString } from "@yourtal/contracts/me/streak";
import type {
  GenerateStatementRequest,
  Statement,
} from "@yourtal/contracts/ledger-internal/economy";
import {
  SERVICE_SIGNATURE_HEADER,
  signServiceRequest,
} from "@yourtal/contracts/ledger-internal/service-signature";
import { testDb } from "../testing/test-db";
import { withEarnCaps } from "../testing/with-earn-caps";
import { FakeLedgerClient } from "./fake-ledger-client";
import { HttpLedgerClient } from "./http-ledger-client";
import { generateStatementFake } from "./fake/fake-ledger-economy";
import { signRewardAttestation } from "./reward-attestation";
import type { LedgerInternalClient } from "./ledger-internal-client";

/**
 * TASKS.md 1.2.e and 4.1.d: one spec, two clients. `pnpm check` runs it
 * against `FakeLedgerClient`; `scripts/ledger-contract-live.mjs` runs the same
 * cases against a live `services/ledger` by setting
 * `LEDGER_CONTRACT_LIVE_URL`, which picks the signed `HttpLedgerClient`.
 */
const db = testDb();
const liveUrl = process.env["LEDGER_CONTRACT_LIVE_URL"];
const ledgerSecret =
  process.env["LEDGER_SERVICE_SECRET"] ?? "local-only-ledger-service-secret-not-real";
const client: LedgerInternalClient =
  liveUrl === undefined
    ? new FakeLedgerClient(db)
    : new HttpLedgerClient(liveUrl, ledgerSecret, db);

/**
 * 10.1.b: `generateStatement` is deliberately NOT on `LedgerInternalClient`
 * — the live route only answers apps/worker's own signed caller, since it is
 * the one caller that knows a business's region without inferring it.
 * `apps/worker/src/ledger-client.ts` is its real caller; this signs the same
 * way, standing in for that worker-only client so this one spec can still
 * set up a statement to list, dispute, resolve and approve against both a
 * fake and a live ledger.
 */
async function generateStatement(request: GenerateStatementRequest): Promise<Statement> {
  if (liveUrl === undefined) return generateStatementFake(db, request);
  const path = "/v1/economy/statements/generate";
  const body = JSON.stringify(request);
  const response = await fetch(`${liveUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SERVICE_SIGNATURE_HEADER]: signServiceRequest({
        secret: ledgerSecret,
        caller: "worker",
        method: "POST",
        pathAndQuery: path,
        body,
      }),
    },
    body,
  });
  if (!response.ok) {
    throw new Error(
      `generateStatement answered ${String(response.status)}: ${await response.text()}`,
    );
  }
  return (await response.json()) as Statement;
}

// Marketing-funded grants (streak, receipt, goodwill) are backed by marketing
// cash at issue (K6), so the region has some before any test grants one.
beforeAll(async () => {
  for (const region of ["ID", "AU"] as const) {
    const funded = await client.fundMarketing({
      region,
      amountMinor: toMinorUnits(region === "ID" ? 50_000_000 : 500_000),
      proposedBy: "staff-1",
      approvedBy: "staff-2",
    });
    expect(funded.isOk()).toBe(true);
  }
});

/**
 * A listing the ledger has priced at `points`, so a burn can read its S and
 * region: at the ID backing rate of IDR 6 a point, S = 6 × points. Unchanged
 * from before 10.7 for every existing (ID) caller.
 */
async function pricedListing(points: number): Promise<string> {
  const listingId = randomUUID();
  const priced = await client.priceListing({
    listingId,
    region: "ID",
    currency: "IDR",
    settlementMinor: toMinorUnits(6 * points),
  });
  expect(priced._unsafeUnwrap().pricePoints).toBe(points);
  await insertTestListing(listingId, "ID", "IDR", points);
  return listingId;
}

/**
 * 10.7.b's own AU listing: unlike `pricedListing` above, this does not
 * assume a fixed backing rate — `proposeRate`/`approveRate` elsewhere in
 * this same file move AU's rate in force, and other suites sharing this
 * database may too, so it reads the CURRENT rate and returns whatever
 * `pricePoints` it actually prices to, rather than insisting the caller's
 * own requested amount survives two roundings intact.
 */
async function pricedAuListing(
  targetPoints: number,
): Promise<{ listingId: string; points: number }> {
  const listingId = randomUUID();
  const rateRows = await db.execute<{ backing_rate_micros_per_pt: string }>(sql`
    SELECT backing_rate_micros_per_pt FROM platform.ledger_fake_backing_rate
     WHERE region = 'AU' ORDER BY effective_from DESC LIMIT 1
  `);
  const micros = Number(rateRows.rows[0]?.backing_rate_micros_per_pt ?? 3_000_000);
  const settlementMinor = Math.ceil((targetPoints * micros) / 1_000_000);
  const priced = await client.priceListing({
    listingId,
    region: "AU",
    currency: "AUD",
    settlementMinor: toMinorUnits(settlementMinor),
  });
  const points = priced._unsafeUnwrap().pricePoints;
  await insertTestListing(listingId, "AU", "AUD", points);
  return { listingId, points };
}

async function insertTestListing(
  listingId: string,
  region: "AU" | "ID",
  currency: "AUD" | "IDR",
  points: number,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO store.listings
      (id, merchant_id, merchant_name, title, description, category,
       face_value_minor, settlement_value_minor, price_in_points,
       stock_remaining, stock_total, transferable, partial_redemption_policy,
       minimum_spend_minor, expires_at, status, currency, region, audience,
       content_category, image_url, channel, partial_redemption)
    VALUES
      (${listingId}, ${randomUUID()}, 'Contract spec listing', 'Contract spec listing',
       'a listing minted for the ledger contract spec', 'food_beverage',
       ${points}, ${points}, ${points},
       1, 1, false, 'single_use_forfeit',
       NULL, now() + interval '90 days', 'available', ${currency}, ${region}, 'all_ages',
       'food-and-drink', 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg', 'both', 'single_use')
  `);
}

const attestationSecret =
  process.env["REWARD_ATTESTATION_SECRET"] ?? "local-only-reward-attestation-secret-not-real";

interface PayingCampaign {
  readonly campaignId: string;
  readonly termsVersion: number;
}

/**
 * A campaign that pays 500 points: its OWN fresh campaign row made live with
 * a terms version, and a reward config drawing on its own owner's purchased
 * allocation (4.4.a). The studio (C) writes these; the fake never reads
 * them, the live ledger does.
 *
 * This used to borrow a seeded ID campaign that had no `reward_config` row
 * yet (a `LEFT JOIN … WHERE r.campaign_id IS NULL`). `seed/watch.ts` (5.1.b)
 * now funds and configures every seeded campaign with `reward_points > 0` —
 * correctly, so the watch session's allocation hold has something real to
 * hold against — which means no such unconfigured campaign is left to find.
 * The fallback `randomUUID()` this spec used when the query came up empty
 * then hit `campaign.terms_version`'s FK to a `campaign.campaigns` row that
 * was never inserted. Owning a fresh row here removes the dependency on the
 * seeded catalogue's shape entirely, which is what this spec should have
 * done from the start: it does not need to reuse fixture data, it needs a
 * campaign, and it can make one.
 *
 * Also gives it a `campaign.video_source` row and one `campaign.chapter`
 * (required for `kind = 'long_form'`) — without them `assemble()`'s
 * `campaignSchema` parse fails (`videoSource` is required; a `long_form`
 * campaign needs `chapters.length > 0`) and `findVisibleById` returns
 * `null`. The first version of this fix left the row `live` but
 * unparseable, and it stays `live` for the rest of this file's whole run
 * (no per-test cleanup, unlike other e2e fixtures) — any OTHER file in the
 * same `with-test-db.mjs`-shared database that reads "a live campaign"
 * without pinning an id (`session-and-region-wall.check.e2e.test.ts`'s own
 * `ORDER BY random()` control read, found the hard way) could land on it
 * and 404.
 */
async function rewardedCampaign(): Promise<PayingCampaign> {
  const campaignId = randomUUID();
  const businessId = randomUUID();
  await db.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule,
       lifecycle_state, published_at, business_id, region, audience, content_category,
       poster_url, teaser_url, hls_url, aspect, estimated_bytes,
       starts_at, ends_at, open_viewing, teaser_start_seconds)
    VALUES
      (${campaignId}, 'long_form', 'ledger-client contract fixture', ${randomUUID()}, 'contract-spec merchant',
       'fixture', 600, 5, 500, 0, 'base_only',
       'live', now(), ${businessId}, 'ID', 'all_ages', 'entertainment',
       'https://example.test/poster.jpg', 'https://example.test/teaser.m3u8',
       'https://example.test/hls.m3u8', '16:9', 1000000,
       now(), now() + interval '30 days', false, 0)
  `);
  await db.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${campaignId}::uuid, 'hls', 'https://example.test/hls.m3u8')
  `);
  await db.execute(sql`
    INSERT INTO campaign.chapter (campaign_id, ordinal, title, start_seconds, reward_weight)
    VALUES (${campaignId}::uuid, 0, 'Chapter 1', 0, 1)
  `);
  const allocation = (
    await client.purchasePoints({
      businessId,
      region: "ID",
      currency: "IDR",
      points: toPoints(100_000),
      paidMinor: toMinorUnits(900_000),
      idempotencyKey: randomUUID(),
    })
  )._unsafeUnwrap();
  const versions = await db.execute<{ next: number | string }>(sql`
    SELECT COALESCE(max(version), 0) + 1 AS next FROM campaign.terms_version WHERE campaign_id = ${campaignId}::uuid
  `);
  const termsVersion = Number(versions.rows[0]?.next ?? 1);
  await db.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds, effective_from, accuracy_bonus_points)
    VALUES (${campaignId}::uuid, ${termsVersion}, 500, 0, 'base_only', 600, now(), 0)
  `);
  await db.execute(
    sql`UPDATE campaign.campaigns SET lifecycle_state = 'live' WHERE id = ${campaignId}::uuid`,
  );
  await db.execute(sql`
    INSERT INTO campaign.reward_config
      (campaign_id, allocation_id, funder_type, max_points_for_campaign, reward_points_per_completion, accuracy_bonus_points)
    VALUES (${campaignId}::uuid, ${allocation.allocationId}, 'partner', 100000, 500, 0)
    ON CONFLICT (campaign_id) DO NOTHING
  `);
  return { campaignId, termsVersion };
}

/** A grantReward request for one attested, completed session. */
function reward(campaign: PayingCampaign, userId: string, trustTier: 0 | 1 | 2 | 3) {
  return {
    campaignId: campaign.campaignId,
    userId,
    region: "ID" as const,
    points: toPoints(500),
    trustTier,
    idempotencyKey: randomUUID(),
    // 12.1.c: none of these fixtures exercise the teen cap, so "adult" —
    // the enriching ledger-client layer is what derives it for real callers.
    ageBand: "adult" as const,
    attestation: signRewardAttestation(attestationSecret, {
      sessionId: randomUUID(),
      userId,
      campaignId: campaign.campaignId,
      termsVersion: campaign.termsVersion,
      completedAt: new Date(),
      asked: 0,
      correct: 0,
    }),
  };
}

describe("pricing", () => {
  it("quotes ceil(S * 1e6 / B) and expires in 15 minutes", async () => {
    const result = await client.quote({
      region: "ID",
      currency: "IDR",
      settlementMinor: toMinorUnits(54_000),
    });
    expect(result.isOk()).toBe(true);
    const quote = result._unsafeUnwrap();
    // ID's F1 rate is 6,000,000 micros/point (Rp 6/point): ceil(54000/6) = 9000.
    expect(quote.pricePoints).toBe(9_000);
    expect(quote.locked).toBe(false);
    const minutesToExpiry = (new Date(quote.expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutesToExpiry).toBeGreaterThan(14);
    // The ledger stamps the quote with the database's clock, not this host's.
    expect(minutesToExpiry).toBeLessThanOrEqual(15 + 1 / 60);
  });

  it("refuses a currency that does not match the region", async () => {
    const result = await client.quote({
      region: "ID",
      currency: "AUD",
      settlementMinor: toMinorUnits(1_000),
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().code).toBe("currency_mismatch");
  });

  it("locks a quote, and refuses to lock one that has expired", async () => {
    const quote = (
      await client.quote({ region: "AU", currency: "AUD", settlementMinor: toMinorUnits(3_000) })
    )._unsafeUnwrap();
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
      settlementMinor: toMinorUnits(54_000),
    });
    expect(result._unsafeUnwrap().pricePoints).toBe(9_000);
  });

  it("quotePurchase prices a points pack at F12's fixed rate", async () => {
    const result = await client.quotePurchase({ points: toPoints(1_000), region: "AU" });
    expect(result._unsafeUnwrap()).toMatchObject({ totalMinor: 4_500, currency: "AUD" });
  });

  /**
   * F61/TASKS.md 7.3.h: `quotePurchase` above refuses anything that is not a
   * multiple of 1,000 points -- exactly what broke every real reward save
   * (an 8-point or 150-point completion is never a pack). `valuePoints` is
   * the correct operation for a single completion's cash value: same P_issue
   * rate, no pack-multiple requirement.
   */
  it("valuePoints prices an 8-point AU reward and a 150-point ID reward at P_issue", async () => {
    // AU: F1's rate_f1_aud is 4,500,000 micros/point (AUD 0.045) -- 8 × 4.5c
    // = 36c exactly, no rounding.
    const au = await client.valuePoints({ points: toPoints(8), region: "AU" });
    expect(au._unsafeUnwrap()).toMatchObject({ totalMinor: 36, currency: "AUD" });

    // ID: rate_f1_idr is 9,000,000 micros/point (Rp 9) -- 150 × 9 = 1,350
    // exactly.
    const id = await client.valuePoints({ points: toPoints(150), region: "ID" });
    expect(id._unsafeUnwrap()).toMatchObject({ totalMinor: 1_350, currency: "IDR" });
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
      points: toPoints(10_000),
      paidMinor: toMinorUnits(450_000),
      idempotencyKey,
    });
    const allocation = first._unsafeUnwrap();
    expect(allocation.remainingPoints).toBe(10_000);

    const replay = await client.purchasePoints({
      businessId,
      region: "AU",
      currency: "AUD",
      points: toPoints(10_000),
      paidMinor: toMinorUnits(450_000),
      idempotencyKey,
    });
    expect(replay._unsafeUnwrap().allocationId).toBe(allocation.allocationId);

    const conflicting = await client.purchasePoints({
      businessId,
      region: "AU",
      currency: "AUD",
      points: toPoints(1),
      paidMinor: toMinorUnits(1),
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
        points: toPoints(1_000),
        paidMinor: toMinorUnits(9_000),
        idempotencyKey: randomUUID(),
      })
    )._unsafeUnwrap();

    const held = await client.hold({
      allocationId: allocation.allocationId,
      points: toPoints(1_000),
      sagaId: randomUUID(),
    });
    expect(held._unsafeUnwrap().state).toBe("held");

    const exhausted = await client.hold({
      allocationId: allocation.allocationId,
      points: toPoints(1),
      sagaId: randomUUID(),
    });
    expect(exhausted._unsafeUnwrapErr().code).toBe("allocation_exhausted");
  });

  it("release returns held points to the allocation", async () => {
    const businessId = randomUUID();
    const allocation = (
      await client.purchasePoints({
        businessId,
        region: "ID",
        currency: "IDR",
        points: toPoints(1_000),
        paidMinor: toMinorUnits(9_000),
        idempotencyKey: randomUUID(),
      })
    )._unsafeUnwrap();
    const held = (
      await client.hold({
        allocationId: allocation.allocationId,
        points: toPoints(1_000),
        sagaId: randomUUID(),
      })
    )._unsafeUnwrap();
    expect((await client.release(held.holdId)).isOk()).toBe(true);
    const after = (await client.getAllocation(allocation.allocationId))._unsafeUnwrap();
    expect(after.remainingPoints).toBe(1_000);
  });

  it("listAllocations returns every allocation for a business", async () => {
    const businessId = randomUUID();
    expect(
      (
        await client.purchasePoints({
          businessId,
          region: "AU",
          currency: "AUD",
          points: toPoints(1_000),
          paidMinor: toMinorUnits(45_000),
          idempotencyKey: randomUUID(),
        })
      ).isOk(),
    ).toBe(true);
    const result = await client.listAllocations(businessId);
    expect(result._unsafeUnwrap().length).toBeGreaterThan(0);
  });

  it("campaignSpend and returnGrant are callable", async () => {
    const campaign = await rewardedCampaign();
    const grant = (await client.grantReward(reward(campaign, randomUUID(), 3)))._unsafeUnwrap();
    const spend = await client.campaignSpend(campaign.campaignId);
    expect(spend.isOk()).toBe(true);
    const returned = await client.returnGrant({ grantId: grant.grantId });
    expect(returned.isOk()).toBe(true);
  });

  it("14.2: a campaign hold reserves its budget and today's cap; its own grant is still paid", async () => {
    const campaign = await rewardedCampaign();
    const configs = await db.execute<{ allocation_id: string }>(sql`
      UPDATE campaign.reward_config SET max_points_for_campaign = 1000, daily_cap_points = 500
       WHERE campaign_id = ${campaign.campaignId}::uuid RETURNING allocation_id
    `);
    const allocationId = configs.rows[0]?.allocation_id ?? "";
    const hold = (points: number) =>
      client.hold({
        allocationId,
        points: toPoints(points),
        sagaId: randomUUID(),
        ttlSeconds: 3_600,
        campaignId: campaign.campaignId,
      });

    const first = (await hold(500))._unsafeUnwrap();
    expect((await hold(500))._unsafeUnwrapErr().code).toBe("campaign_daily_cap_reached");
    const budgets = await client.campaignBudgets({
      region: "ID",
      campaignIds: [campaign.campaignId],
    });
    expect(budgets._unsafeUnwrap()).toEqual([
      { campaignId: campaign.campaignId, remainingPoints: 500, remainingTodayPoints: 0 },
    ]);

    const paid = await client.grantReward({
      ...reward(campaign, randomUUID(), 3),
      holdId: first.holdId,
    });
    expect(paid.isOk()).toBe(true);
    const unheld = await client.grantReward(reward(campaign, randomUUID(), 3));
    expect(unheld._unsafeUnwrapErr().code).toBe("campaign_daily_cap_reached");
  });
});

describe("earning and spending", () => {
  it("a reward grant goes to pending with an unlock time by tier, then becomes available", async () => {
    const userId = randomUUID();
    const granted = await client.grantReward(reward(await rewardedCampaign(), userId, 1));
    const grant = granted._unsafeUnwrap();
    expect(new Date(grant.unlockAt).getTime()).toBeGreaterThan(Date.now());

    const balance = (await client.balance(userId))._unsafeUnwrap();
    expect(balance.availablePoints).toBe(0);
    expect(balance.pending).toHaveLength(1);
    expect(balance.pending[0]?.points).toBe(500);
  });

  it("tier 3 (demo viewer) unlocks immediately", async () => {
    const userId = randomUUID();
    expect(
      (
        await client.grantAction({
          kind: "streak",
          userId,
          region: "ID",
          points: toPoints(100),
          trustTier: 3,
          idempotencyKey: randomUUID(),
          ageBand: "adult",
        })
      ).isOk(),
    ).toBe(true);
    const balance = (await client.balance(userId))._unsafeUnwrap();
    expect(balance.availablePoints).toBe(100);
    expect(balance.pending).toHaveLength(0);
  });

  // A goodwill grant: a receipt replays its first grant whatever the points (2.10.b, below).
  it("the same idempotency key with a different body returns idempotency_conflict", async () => {
    const userId = randomUUID();
    const idempotencyKey = randomUUID();
    expect(
      (
        await client.grantAction({
          kind: "goodwill",
          userId,
          region: "ID",
          points: toPoints(10),
          trustTier: 3,
          idempotencyKey,
          ageBand: "adult",
        })
      ).isOk(),
    ).toBe(true);
    const conflict = await client.grantAction({
      kind: "goodwill",
      userId,
      region: "ID",
      points: toPoints(99),
      trustTier: 3,
      idempotencyKey,
      ageBand: "adult",
    });
    expect(conflict._unsafeUnwrapErr().code).toBe("idempotency_conflict");
  });

  it("burnForVoucher draws from available only, and refuses when short", async () => {
    const userId = randomUUID();
    expect(
      (
        await client.grantAction({
          kind: "goodwill",
          userId,
          region: "ID",
          points: toPoints(100),
          trustTier: 3,
          idempotencyKey: randomUUID(),
          ageBand: "adult",
        })
      ).isOk(),
    ).toBe(true);

    const tooMuch = await client.burnForVoucher({
      userId,
      listingId: await pricedListing(200),
      points: toPoints(200),
      sagaId: randomUUID(),
    });
    expect(tooMuch._unsafeUnwrapErr().code).toBe("insufficient_available");

    const sagaId = randomUUID();
    const burned = await client.burnForVoucher({
      userId,
      listingId: await pricedListing(60),
      points: toPoints(60),
      sagaId,
    });
    expect(burned._unsafeUnwrap().state).toBe("burned");

    const balance = (await client.balance(userId))._unsafeUnwrap();
    expect(balance.availablePoints).toBe(40);

    const fetched = await client.getBurn(sagaId);
    expect(fetched._unsafeUnwrap().sagaId).toBe(sagaId);
  });

  it("reinstateBurn (K13) gives the points back", async () => {
    const userId = randomUUID();
    expect(
      (
        await client.grantAction({
          kind: "goodwill",
          userId,
          region: "ID",
          points: toPoints(100),
          trustTier: 3,
          idempotencyKey: randomUUID(),
          ageBand: "adult",
        })
      ).isOk(),
    ).toBe(true);
    const sagaId = randomUUID();
    expect(
      (
        await client.burnForVoucher({
          userId,
          listingId: await pricedListing(100),
          points: toPoints(100),
          sagaId,
        })
      ).isOk(),
    ).toBe(true);
    expect((await client.balance(userId))._unsafeUnwrap().availablePoints).toBe(0);

    const reinstated = await client.reinstateBurn(sagaId);
    expect(reinstated._unsafeUnwrap().state).toBe("reinstated");
    expect((await client.balance(userId))._unsafeUnwrap().availablePoints).toBe(100);
  });

  // 10.7: fake-ledger parity with the real one's K6 rule (4.4.h) and its
  // region-tagged burns.
  it("10.7.a: a grant the region's marketing fund cannot back is refused; one comfortably within it succeeds", async () => {
    // A dedicated top-up, so "within it" does not depend on how much other
    // tests in this file have already drawn from AU's marketing fund.
    expect(
      (
        await client.fundMarketing({
          region: "AU",
          amountMinor: toMinorUnits(9_000),
          proposedBy: "staff-1",
          approvedBy: "staff-2",
        })
      ).isOk(),
    ).toBe(true);

    // The earn caps (F12) are checked BEFORE K6 on both ledgers, and F12's
    // real AU cap (500 a day) is far below anything this file funds, so a
    // grant only the fund can refuse needs the cap out of the way. Both
    // ledgers read the caps per grant with no cache, so raise them for this
    // test and restore them after; the cap's own refusal is pinned below.
    await withEarnCaps(client, "AU", { daily: 2_000_000_000, monthly: 2_000_000_000 }, async () => {
      // 100 pts × 3¢ = 300¢, comfortably inside the 9,000¢ top-up above.
      const withinFund = await client.grantAction({
        kind: "goodwill",
        userId: randomUUID(),
        region: "AU",
        points: toPoints(100),
        trustTier: 3,
        idempotencyKey: randomUUID(),
        ageBand: "adult",
      });
      expect(withinFund.isOk()).toBe(true);

      // Far beyond anything this file funds anywhere, in either region:
      // refused regardless of leftover state from earlier tests.
      const tooMuch = await client.grantAction({
        kind: "goodwill",
        userId: randomUUID(),
        region: "AU",
        points: toPoints(1_000_000_000),
        trustTier: 3,
        idempotencyKey: randomUUID(),
        ageBand: "adult",
      });
      expect(tooMuch._unsafeUnwrapErr().code).toBe("insufficient_available");
    });
  });

  // 14.20.b: the adult daily and monthly earn caps (F12, 4.4.k) apply to every
  // grant on both ledgers, "earned + this grant > limit", and refuse with
  // velocity_capped. Caps are set explicitly, not read from the seed.
  describe("adult earn caps (F12)", () => {
    const goodwill = (userId: string, points: number, region: "AU" | "ID" = "AU") =>
      client.grantAction({
        kind: "goodwill",
        userId,
        region,
        points: toPoints(points),
        trustTier: 3,
        idempotencyKey: randomUUID(),
        ageBand: "adult",
      });

    it("a grant that would take a user over the daily cap is refused; one that reaches it exactly is not", async () => {
      await withEarnCaps(client, "AU", { daily: 500, monthly: 100_000 }, async () => {
        const userId = randomUUID();
        expect((await goodwill(userId, 300)).isOk()).toBe(true);
        const over = await goodwill(userId, 300);
        expect(over._unsafeUnwrapErr().code).toBe("velocity_capped");
        expect(over._unsafeUnwrapErr().message).toContain("day cap of 500");
        // 300 + 200 = 500, which is not over the cap; a refusal wrote nothing.
        expect((await goodwill(userId, 200)).isOk()).toBe(true);
        expect((await goodwill(userId, 1))._unsafeUnwrapErr().code).toBe("velocity_capped");
        // Another user's earnings are not this user's.
        expect((await goodwill(randomUUID(), 500)).isOk()).toBe(true);
      });
    });

    it("a grant that would take a user over the monthly cap is refused while the daily cap has room", async () => {
      await withEarnCaps(client, "AU", { daily: 100_000, monthly: 500 }, async () => {
        const userId = randomUUID();
        expect((await goodwill(userId, 300)).isOk()).toBe(true);
        const over = await goodwill(userId, 300);
        expect(over._unsafeUnwrapErr().code).toBe("velocity_capped");
        expect(over._unsafeUnwrapErr().message).toContain("month cap of 500");
        expect((await goodwill(userId, 200)).isOk()).toBe(true);
      });
    });

    it("the cap also binds a campaign reward, and a replay of an earlier grant is answered, not refused", async () => {
      // ID's real daily cap is 5,000; a reward pays 500. Set it so the second reward does not fit.
      await withEarnCaps(client, "ID", { daily: 800, monthly: 100_000 }, async () => {
        const userId = randomUUID();
        const first = reward(await rewardedCampaign(), userId, 3);
        expect((await client.grantReward(first)).isOk()).toBe(true);
        const over = await client.grantReward(reward(await rewardedCampaign(), userId, 3));
        expect(over._unsafeUnwrapErr().code).toBe("velocity_capped");
        // The first reward's own key replays its grant even though the user is now near the cap.
        expect((await client.grantReward(first)).isOk()).toBe(true);
      });
    });
  });

  it("10.7.b: a burn in AU shows in AU's pointsRedeemed and never in ID's", async () => {
    // The ledger buckets a day in the REGION's own zone (services/ledger
    // internal/ledger/chart.go: Sydney for AU, Jakarta for ID), not UTC. A UTC
    // "today" made this case fail whenever the runner's clock sat in the hours
    // where the region's date had already rolled over (CI runs in UTC).
    const redeemedToday = async (region: "AU" | "ID"): Promise<number> => {
      const today = regionDateString(new Date(), region);
      const rows = (await client.economyDaily({ region, from: today, to: today }))._unsafeUnwrap();
      return rows.find((row) => row.date === today)?.pointsRedeemed ?? 0;
    };
    const auBefore = await redeemedToday("AU");
    const idBefore = await redeemedToday("ID");

    // A generous top-up: comfortably covers 500 points at any rate this
    // file's own proposeRate/approveRate tests could plausibly move AU to
    // (F1's margin rule keeps B within a small multiple of P_issue).
    expect(
      (
        await client.fundMarketing({
          region: "AU",
          amountMinor: toMinorUnits(10_000_000),
          proposedBy: "staff-1",
          approvedBy: "staff-2",
        })
      ).isOk(),
    ).toBe(true);

    // 200, not 500: the listing's rounded price can land a point or two above its
    // target, and a user cannot earn more than AU's 500-point daily cap (F12).
    const { listingId, points } = await pricedAuListing(200);
    const userId = randomUUID();
    expect(
      (
        await client.grantAction({
          kind: "goodwill",
          userId,
          region: "AU",
          points: toPoints(points),
          trustTier: 3,
          idempotencyKey: randomUUID(),
          ageBand: "adult",
        })
      ).isOk(),
    ).toBe(true);
    const burned = await client.burnForVoucher({
      userId,
      listingId,
      points: toPoints(points),
      sagaId: randomUUID(),
    });
    expect(burned._unsafeUnwrap().state).toBe("burned");

    expect((await redeemedToday("AU")) - auBefore).toBe(points);
    expect(await redeemedToday("ID")).toBe(idBefore);
  });
});

describe("captures (4.6.f.2)", () => {
  it("captureVoucher posts a merchant payable, and replays rather than posting twice", async () => {
    const captureId = randomUUID();
    const merchantId = randomUUID();
    const request = {
      captureId,
      region: "AU" as const,
      merchantId,
      amountMinor: toMinorUnits(45),
      currency: "AUD" as const,
    };
    const first = (await client.captureVoucher(request))._unsafeUnwrap();
    expect(first.transferId).not.toBe("");

    expect(first).toMatchObject({ captureId, merchantId, amountMinor: 45, currency: "AUD" });

    const replayed = (await client.captureVoucher(request))._unsafeUnwrap();
    expect(replayed).toEqual(first);
  });

  it("a different amount for the same captureId is idempotency_conflict", async () => {
    const captureId = randomUUID();
    const merchantId = randomUUID();
    (
      await client.captureVoucher({
        captureId,
        region: "AU",
        merchantId,
        amountMinor: toMinorUnits(10),
        currency: "AUD",
      })
    )._unsafeUnwrap();
    const conflict = await client.captureVoucher({
      captureId,
      region: "AU",
      merchantId,
      amountMinor: toMinorUnits(20),
      currency: "AUD",
    });
    expect(conflict._unsafeUnwrapErr().code).toBe("idempotency_conflict");
  });

  it("a merchant paid in one region cannot be captured in the other", async () => {
    const merchantId = randomUUID();
    (
      await client.captureVoucher({
        captureId: randomUUID(),
        region: "ID",
        merchantId,
        amountMinor: toMinorUnits(10_000),
        currency: "IDR",
      })
    )._unsafeUnwrap();
    const crossed = await client.captureVoucher({
      captureId: randomUUID(),
      region: "AU",
      merchantId,
      amountMinor: toMinorUnits(10),
      currency: "AUD",
    });
    expect(crossed._unsafeUnwrapErr().code).toBe("region_mismatch");
  });

  it("a currency that does not match the region is region_mismatch", async () => {
    const mismatched = await client.captureVoucher({
      captureId: randomUUID(),
      region: "AU",
      merchantId: randomUUID(),
      amountMinor: toMinorUnits(10),
      currency: "IDR",
    });
    expect(mismatched._unsafeUnwrapErr().code).toBe("region_mismatch");
  });
});

describe("users", () => {
  it("escrow takes available then pending, replays by key, and releaseEscrow gives both back", async () => {
    const userId = randomUUID();
    for (const trustTier of [3, 0] as const) {
      const granted = await client.grantAction({
        kind: "goodwill",
        userId,
        region: "ID",
        points: toPoints(trustTier === 3 ? 100 : 50),
        trustTier,
        idempotencyKey: randomUUID(),
        ageBand: "adult",
      });
      expect(granted.isOk()).toBe(true);
    }
    const pendingOf = async () =>
      (await client.balance(userId))
        ._unsafeUnwrap()
        .pending.reduce((sum, bucket) => sum + bucket.points, 0);

    const request = {
      userId,
      points: toPoints(120),
      reason: "dispute hold",
      idempotencyKey: randomUUID(),
    };
    const escrowed = (await client.escrow(request))._unsafeUnwrap();
    expect(escrowed.state).toBe("held");
    expect((await client.escrow(request))._unsafeUnwrap().escrowId).toBe(escrowed.escrowId);
    expect((await client.balance(userId))._unsafeUnwrap().availablePoints).toBe(0);
    expect(await pendingOf()).toBe(30);

    const beyond = await client.escrow({ userId, points: toPoints(31), reason: "dispute hold" });
    expect(beyond._unsafeUnwrapErr().code).toBe("insufficient_available");

    const released = await client.releaseEscrow(escrowed.escrowId);
    expect(released._unsafeUnwrap().state).toBe("released");
    expect((await client.balance(userId))._unsafeUnwrap().availablePoints).toBe(100);
    expect(await pendingOf()).toBe(50);
  });

  it("history lists grants and burns, newest first, paginated", async () => {
    const userId = randomUUID();
    expect(
      (
        await client.grantAction({
          kind: "goodwill",
          userId,
          region: "ID",
          points: toPoints(100),
          trustTier: 3,
          idempotencyKey: randomUUID(),
          ageBand: "adult",
        })
      ).isOk(),
    ).toBe(true);
    expect(
      (
        await client.burnForVoucher({
          userId,
          listingId: await pricedListing(10),
          points: toPoints(10),
          sagaId: randomUUID(),
        })
      ).isOk(),
    ).toBe(true);

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
      amountMinor: toMinorUnits(500_000),
      proposedBy: "staff-1",
      approvedBy: "staff-1",
    });
    expect(result._unsafeUnwrapErr().code).toBe("already_granted");
  });

  it("statements: apps/worker generates, everyone else only lists, disputes, resolves and approves (10.1)", async () => {
    const businessId = randomUUID();
    const captureId = randomUUID();
    (
      await client.captureVoucher({
        captureId,
        region: "AU",
        merchantId: businessId,
        amountMinor: toMinorUnits(80),
        currency: "AUD",
      })
    )._unsafeUnwrap();

    const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const stmt = await generateStatement({ businessId, region: "AU", from, to });
    expect(stmt).toMatchObject({ capturesMinor: 80, closingPayableMinor: 80, status: "open" });

    const listed = (
      await client.statements({ businessId, from: "2020-01-01", to: "2030-01-01" })
    )._unsafeUnwrap();
    expect(listed.map((s) => s.id)).toContain(stmt.id);

    const queued = (await client.statementQueue("AU"))._unsafeUnwrap();
    expect(queued.map((s) => s.id)).toContain(stmt.id);

    const early = await client.approvePayout({ statementId: stmt.id, approvedBy: "staff-1" });
    expect(early._unsafeUnwrapErr().code).toBe("dispute_window_open");

    const disputed = (
      await client.disputeStatement({ statementId: stmt.id, reason: "amount looks wrong" })
    )._unsafeUnwrap();
    expect(disputed.status).toBe("disputed");

    const stillDisputed = await client.approvePayout({
      statementId: stmt.id,
      approvedBy: "staff-1",
    });
    expect(stillDisputed._unsafeUnwrapErr().code).toBe("statement_not_open");

    const resolved = (
      await client.resolveStatementDispute({ statementId: stmt.id, note: "reviewed, releasing" })
    )._unsafeUnwrap();
    expect(resolved.status).toBe("open");
  });

  it("recoverCapture posts a K13 recovery line once, and replays idempotently (10.5.b)", async () => {
    const merchantId = randomUUID();
    const captureId = randomUUID();
    (
      await client.captureVoucher({
        captureId,
        region: "AU",
        merchantId,
        amountMinor: toMinorUnits(50),
        currency: "AUD",
      })
    )._unsafeUnwrap();

    const first = (
      await client.recoverCapture({ captureId, reason: "K13: voucher not honoured" })
    )._unsafeUnwrap();
    expect(first.amountMinor).toBe(50);

    const replay = (
      await client.recoverCapture({ captureId, reason: "K13: voucher not honoured" })
    )._unsafeUnwrap();
    expect(replay.transferId).toBe(first.transferId);
  });

  it("releaseVoucherLiability replays idempotently on the same key (10.1.c/10.2.b)", async () => {
    const idempotencyKey = `expire_${randomUUID()}`;
    const first = (
      await client.releaseVoucherLiability({
        idempotencyKey,
        region: "AU",
        amountMinor: toMinorUnits(20),
      })
    )._unsafeUnwrap();
    const replay = (
      await client.releaseVoucherLiability({
        idempotencyKey,
        region: "AU",
        amountMinor: toMinorUnits(20),
      })
    )._unsafeUnwrap();
    expect(replay.transferId).toBe(first.transferId);
  });
});

describe("settings (1.2.f/1.2.g)", () => {
  it("proposeSetting starts a pending row; getSettings never returns it until approved", async () => {
    const key = `test_setting_${randomUUID()}`;
    const proposed = await client.proposeSetting({
      region: "AU",
      key,
      value: 42,
      proposedBy: "staff-1",
    });
    expect(proposed.approvedBy).toBeNull();
    expect(proposed.effectiveFrom).toBeNull();

    const beforeApproval = await client.getSettings("AU");
    expect(beforeApproval.some((setting) => setting.key === key)).toBe(false);

    const selfApprove = client.approveSetting({ id: proposed.id, approvedBy: "staff-1" });
    await expect(selfApprove).rejects.toThrow();

    const approved = await client.approveSetting({ id: proposed.id, approvedBy: "staff-2" });
    expect(approved.approvedBy).toBe("staff-2");
    expect(approved.effectiveFrom).not.toBeNull();

    const afterApproval = await client.getSettings("AU");
    const found = afterApproval.find((setting) => setting.key === key);
    expect(found?.value).toBe(42);
  });

  it("F12's own seeded default reads back through getSettings", async () => {
    const settings = await client.getSettings("AU");
    const dailyEarnCap = settings.find((setting) => setting.key === "daily_earn_cap");
    expect(dailyEarnCap?.value).toBe(500);
  });
});

// 2.3.d/2.3.f's `/dev/clock`. Against `FakeLedgerClient` specifically, not
// the shared `client` var: this op is refused (404) by a live ledger outside
// dev/staging, and `ledger-contract-live.mjs` starts the ledger with no
// APP_ENV set (production's default) — so exercising it through `client`
// would fail that script for a reason unrelated to what this test checks.
describe("dev/staging holdback (2.3.d/2.3.f)", () => {
  const fake = new FakeLedgerClient(db);

  // The file's own `beforeAll` funds `client`'s marketing cash, which is the
  // live ledger's in a live run, not this fake's (it keeps its own table);
  // without this the goodwill grants below are refused by K6.
  beforeAll(async () => {
    const funded = await fake.fundMarketing({
      region: "AU",
      amountMinor: toMinorUnits(1_000),
      proposedBy: "staff-1",
      approvedBy: "staff-2",
    });
    expect(funded.isOk()).toBe(true);
  });

  it("releaseNow releases a pending grant and is idempotent", async () => {
    const userId = randomUUID();
    const granted = await fake.grantAction({
      kind: "goodwill",
      userId,
      region: "AU",
      points: toPoints(40),
      trustTier: 0, // F12: 72h holdback, still pending
      idempotencyKey: randomUUID(),
      ageBand: "adult",
    });
    expect(granted.isOk()).toBe(true);
    expect((await fake.balance(userId))._unsafeUnwrap().availablePoints).toBe(0);

    const released = (await fake.advanceHoldback({ userId, releaseNow: true }))._unsafeUnwrap();
    expect(released).toStrictEqual({ shifted: 1, released: 1, escrowHeld: false });
    expect((await fake.balance(userId))._unsafeUnwrap().availablePoints).toBe(40);

    // Nothing left to release.
    const replay = (await fake.advanceHoldback({ userId, releaseNow: true }))._unsafeUnwrap();
    expect(replay).toStrictEqual({ shifted: 0, released: 0, escrowHeld: false });
  });

  it("advancing by fewer days than the holdback shifts without releasing", async () => {
    const userId = randomUUID();
    const granted = await fake.grantAction({
      kind: "goodwill",
      userId,
      region: "AU",
      points: toPoints(25),
      trustTier: 0, // 72h holdback
      idempotencyKey: randomUUID(),
      ageBand: "adult",
    });
    expect(granted.isOk()).toBe(true);

    const tooSoon = (await fake.advanceHoldback({ userId, days: 1 }))._unsafeUnwrap();
    expect(tooSoon).toStrictEqual({ shifted: 1, released: 0, escrowHeld: false });
    expect((await fake.balance(userId))._unsafeUnwrap().availablePoints).toBe(0);
  });

  it("advancing by enough days releases the grant", async () => {
    const userId = randomUUID();
    const granted = await fake.grantAction({
      kind: "goodwill",
      userId,
      region: "AU",
      points: toPoints(25),
      trustTier: 0, // 72h holdback
      idempotencyKey: randomUUID(),
      ageBand: "adult",
    });
    expect(granted.isOk()).toBe(true);

    const cleared = (await fake.advanceHoldback({ userId, days: 4 }))._unsafeUnwrap();
    expect(cleared).toStrictEqual({ shifted: 1, released: 1, escrowHeld: false });
    expect((await fake.balance(userId))._unsafeUnwrap().availablePoints).toBe(25);
  });
});

// 4.1 (ledger internal API) makes these real once its routes replace the
// service's current 501s. `HttpLedgerClient` already POSTs to the paths it
// will need — see that file's own header.
describe.todo("HttpLedgerClient against a live services/ledger (4.1)");

/**
 * 14.13 (F122): the same tier rules on both clients. Tier prices depend on
 * P_issue only (AU 4.5c, ID IDR 9), which nothing in this file moves; B
 * moves (AU to 3.5c above), and every F122 tier stays above it.
 */
describe("point packages (14.13, F122)", () => {
  it("lists the seeded tiers at P_issue less each discount, rounded up", async () => {
    const au = (await client.packageTiers("AU"))._unsafeUnwrap();
    expect(au.map((t) => [t.tierKey, t.points, t.totalMinor, t.undiscountedMinor])).toEqual([
      ["starter", 1_000, 4_500, 4_500],
      ["grow", 10_000, 42_750, 45_000],
      ["scale", 50_000, 202_500, 225_000],
    ]);
    const grow = (await client.quotePackage({ region: "ID", tierKey: "grow" }))._unsafeUnwrap();
    expect(grow).toEqual({
      tierKey: "grow",
      points: 10_000,
      discountBps: 500,
      totalMinor: 85_500,
      undiscountedMinor: 90_000,
      currency: "IDR",
      pricing: "tier",
    });
    const unknown = await client.quotePackage({ region: "ID", tierKey: "platinum" });
    expect(unknown._unsafeUnwrapErr().code).toBe("refused");
  });

  it("checks a proposed catalogue's shape and its B floor", async () => {
    const ok = await client.checkPackageTiers({
      region: "AU",
      tiers: [{ key: "starter", points: 1_000, discountBps: 0 }],
    });
    expect(ok.isOk()).toBe(true);
    for (const tiers of [
      // 50% off 4.5c is 2.25c, under any AU B this file sets.
      [{ key: "deep", points: 1_000, discountBps: 5_000 }],
      [{ key: "odd", points: 1_500, discountBps: 0 }],
      [{ key: "a", points: 1_000, discountBps: 0, priceMinor: 1 }],
    ]) {
      const refused = await client.checkPackageTiers({ region: "AU", tiers });
      expect(refused._unsafeUnwrapErr().code).toBe("refused");
    }
  });

  it("buys a tier at its price, and refuses less, another size, or an unknown tier", async () => {
    const buy = (overrides: { points?: number; paidMinor?: number; tierKey?: string }) =>
      client.purchasePoints({
        businessId: randomUUID(),
        region: "ID",
        currency: "IDR",
        points: toPoints(overrides.points ?? 10_000),
        paidMinor: toMinorUnits(overrides.paidMinor ?? 85_500),
        idempotencyKey: randomUUID(),
        tierKey: overrides.tierKey ?? "grow",
      });
    expect((await buy({}))._unsafeUnwrap().totalPoints).toBe(10_000);
    expect((await buy({ paidMinor: 85_499 }))._unsafeUnwrapErr().code).toBe("refused");
    expect((await buy({ points: 1_000 }))._unsafeUnwrapErr().code).toBe("refused");
    expect((await buy({ tierKey: "platinum" }))._unsafeUnwrapErr().code).toBe("refused");
    // Untiered, the same 10,000 points cost P_issue in full.
    const untiered = await client.purchasePoints({
      businessId: randomUUID(),
      region: "ID",
      currency: "IDR",
      points: toPoints(10_000),
      paidMinor: toMinorUnits(85_500),
      idempotencyKey: randomUUID(),
    });
    expect(untiered._unsafeUnwrapErr().code).toBe("refused");
  });
});

/**
 * 2.10.b (F127, docs/27 §3.2–3.3): receipt packages. Prices are ID's, at
 * B = IDR 6 a point (the same rate `pricedListing` assumes), which nothing
 * in this file moves: IDR 6,000 / 60,000 / 300,000 for the three tiers.
 * Receipts draw from them on both legs (T2b's switch).
 */

/** A partner with an approved receipt funder (two people) in `region`. */
async function receiptFunder(
  region: "AU" | "ID" = "ID",
): Promise<{ partnerId: string; businessId: string }> {
  const partnerId = `contract-partner-${randomUUID()}`;
  const businessId = randomUUID();
  const proposed = await client.proposeSetting({
    region,
    key: receiptFunderKey(partnerId),
    value: { businessId },
    proposedBy: "staff-1",
  });
  await client.approveSetting({ id: proposed.id, approvedBy: "staff-2" });
  return { partnerId, businessId };
}

const AT_COST_ID = { starter: 6_000, grow: 60_000, scale: 300_000 } as const;

/** One ID receipt package bought at cost by `businessId`. */
function buyReceipts(
  businessId: string,
  overrides: {
    tierKey?: keyof typeof AT_COST_ID | "platinum";
    points?: number;
    paidMinor?: number;
    idempotencyKey?: string;
  } = {},
) {
  const tierKey = overrides.tierKey ?? "starter";
  return client.purchasePoints({
    businessId,
    region: "ID",
    currency: "IDR",
    points: toPoints(overrides.points ?? 1_000),
    paidMinor: toMinorUnits(overrides.paidMinor ?? AT_COST_ID.starter),
    idempotencyKey: overrides.idempotencyKey ?? randomUUID(),
    tierKey,
    programme: "receipts",
  });
}

/** A receipt grant to a fresh ID adult, as the partner call sends it. */
function receiptGrant(
  partnerId: string | undefined,
  points: number,
  idempotencyKey = randomUUID(),
) {
  return {
    kind: "receipt" as const,
    userId: randomUUID(),
    region: "ID" as const,
    points: toPoints(points),
    trustTier: 3 as const,
    idempotencyKey,
    ageBand: "adult" as const,
    ...(partnerId === undefined ? {} : { partnerId }),
  };
}

async function remaining(allocationId: string): Promise<number> {
  return (await client.getAllocation(allocationId))._unsafeUnwrap().remainingPoints;
}

describe("receipt packages at cost (2.10.b, F127)", () => {
  it("quotes every tier size at B with no discount, to the funder only", async () => {
    const { businessId } = await receiptFunder();
    const tiers = (await client.receiptPackageTiers({ region: "ID", businessId }))._unsafeUnwrap();
    expect(
      tiers.map((t) => [t.tierKey, t.points, t.discountBps, t.totalMinor, t.undiscountedMinor]),
    ).toEqual([
      ["starter", 1_000, 0, 6_000, 6_000],
      ["grow", 10_000, 0, 60_000, 60_000],
      ["scale", 50_000, 0, 300_000, 300_000],
    ]);
    expect(tiers.every((t) => t.pricing === "at_cost" && t.currency === "IDR")).toBe(true);

    const grow = await client.quotePackage({
      region: "ID",
      tierKey: "grow",
      programme: "receipts",
      businessId,
    });
    expect(grow._unsafeUnwrap()).toEqual({
      tierKey: "grow",
      points: 10_000,
      discountBps: 0,
      totalMinor: 60_000,
      undiscountedMinor: 60_000,
      currency: "IDR",
      pricing: "at_cost",
    });

    // Not a funder: a stranger, or the funder in the other region.
    const stranger = randomUUID();
    for (const refused of [
      await client.receiptPackageTiers({ region: "ID", businessId: stranger }),
      await client.receiptPackageTiers({ region: "AU", businessId }),
      await client.quotePackage({
        region: "ID",
        tierKey: "grow",
        programme: "receipts",
        businessId: stranger,
      }),
    ]) {
      expect(refused._unsafeUnwrapErr().code).toBe("refused");
    }
    // Without the programme, the same tier is the ordinary discounted one.
    const ordinary = (await client.quotePackage({ region: "ID", tierKey: "grow" }))._unsafeUnwrap();
    expect([ordinary.totalMinor, ordinary.pricing]).toEqual([85_500, "tier"]);
  });

  it("sells the funder a tier's size at cost, refuses anyone else, less, or another size", async () => {
    const { businessId } = await receiptFunder();
    const key = randomUUID();
    const bought = (await buyReceipts(businessId, { idempotencyKey: key }))._unsafeUnwrap();
    expect(bought).toMatchObject({
      businessId,
      region: "ID",
      funderType: "partner",
      totalPoints: 1_000,
      remainingPoints: 1_000,
      programme: "receipts",
    });
    const scale = await buyReceipts(businessId, {
      tierKey: "scale",
      points: 50_000,
      paidMinor: AT_COST_ID.scale,
    });
    expect(scale._unsafeUnwrap().totalPoints).toBe(50_000);

    for (const refused of [
      await buyReceipts(businessId, { paidMinor: AT_COST_ID.starter - 1 }),
      await buyReceipts(businessId, { points: 10_000, paidMinor: AT_COST_ID.grow }),
      await buyReceipts(businessId, { tierKey: "platinum" }),
      await buyReceipts(randomUUID()),
    ]) {
      expect(refused._unsafeUnwrapErr().code).toBe("refused");
    }
    const untiered = await client.purchasePoints({
      businessId,
      region: "ID",
      currency: "IDR",
      points: toPoints(1_000),
      paidMinor: toMinorUnits(AT_COST_ID.starter),
      idempotencyKey: randomUUID(),
      programme: "receipts",
    });
    expect(untiered._unsafeUnwrapErr().code).toBe("refused");

    // A replay answers the same package; the same key as an ordinary purchase conflicts.
    const replay = (await buyReceipts(businessId, { idempotencyKey: key }))._unsafeUnwrap();
    expect(replay.allocationId).toBe(bought.allocationId);
    const ordinaryReplay = await client.purchasePoints({
      businessId,
      region: "ID",
      currency: "IDR",
      points: toPoints(1_000),
      paidMinor: toMinorUnits(AT_COST_ID.starter),
      idempotencyKey: key,
      tierKey: "starter",
    });
    expect(ordinaryReplay._unsafeUnwrapErr().code).toBe("idempotency_conflict");
  });

  it("names the programme on every allocation view", async () => {
    const { businessId } = await receiptFunder();
    const receipts = (await buyReceipts(businessId))._unsafeUnwrap();
    const ordinary = (
      await client.purchasePoints({
        businessId,
        region: "ID",
        currency: "IDR",
        points: toPoints(1_000),
        paidMinor: toMinorUnits(9_000),
        idempotencyKey: randomUUID(),
        tierKey: "starter",
      })
    )._unsafeUnwrap();
    expect(ordinary.programme).toBeNull();
    expect((await client.getAllocation(receipts.allocationId))._unsafeUnwrap().programme).toBe(
      "receipts",
    );
    const listed = (await client.listAllocations(businessId))._unsafeUnwrap();
    expect(
      Object.fromEntries(
        listed.map((allocation) => [allocation.allocationId, allocation.programme]),
      ),
    ).toEqual({ [receipts.allocationId]: "receipts", [ordinary.allocationId]: null });
  });
});

describe("the receipt draw (2.10.b T2b, F127)", () => {
  it("pays from the oldest package with room, never split, then stops", async () => {
    const { partnerId, businessId } = await receiptFunder();
    const first = (await buyReceipts(businessId))._unsafeUnwrap().allocationId;
    const second = (await buyReceipts(businessId))._unsafeUnwrap().allocationId;
    const grant = (points: number) => client.grantAction(receiptGrant(partnerId, points));

    expect((await grant(400))._unsafeUnwrap().points).toBe(400);
    expect((await grant(400)).isOk()).toBe(true);
    // 200 left in the first: 400 more comes whole from the second.
    expect((await grant(400)).isOk()).toBe(true);
    expect([await remaining(first), await remaining(second)]).toEqual([200, 600]);
    // The oldest with room again.
    expect((await grant(200)).isOk()).toBe(true);
    expect((await grant(400)).isOk()).toBe(true);
    expect([await remaining(first), await remaining(second)]).toEqual([0, 200]);

    const exhausted = await grant(400);
    expect(exhausted._unsafeUnwrapErr().code).toBe("allocation_exhausted");
    expect([await remaining(first), await remaining(second)]).toEqual([0, 200]);
  });

  it("is allocation_exhausted with no funder or no package, and never takes marketing cash", async () => {
    const noFunder = await client.grantAction(receiptGrant(`contract-${randomUUID()}`, 1));
    expect(noFunder._unsafeUnwrapErr().code).toBe("allocation_exhausted");
    const { partnerId, businessId } = await receiptFunder();
    const noPackage = await client.grantAction(receiptGrant(partnerId, 1));
    expect(noPackage._unsafeUnwrapErr().code).toBe("allocation_exhausted");

    (await buyReceipts(businessId))._unsafeUnwrap();
    const paid = (await client.grantAction(receiptGrant(partnerId, 1)))._unsafeUnwrap();
    if (liveUrl === undefined) {
      const backed = await db.execute(sql`
        SELECT 1 FROM platform.ledger_fake_marketing_backing WHERE grant_id = ${paid.grantId}
      `);
      expect(backed.rows).toHaveLength(0);
    }
  });

  it("replays a paid receipt's first grant after the package is spent, whatever the points", async () => {
    const { partnerId, businessId } = await receiptFunder();
    const allocationId = (await buyReceipts(businessId))._unsafeUnwrap().allocationId;
    const first = receiptGrant(partnerId, 400);
    const paid = (await client.grantAction(first))._unsafeUnwrap();
    expect((await client.grantAction(receiptGrant(partnerId, 600))).isOk()).toBe(true);
    expect(await remaining(allocationId)).toBe(0);

    for (const points of [400, 1]) {
      const replay = await client.grantAction({ ...first, points: toPoints(points) });
      expect(replay._unsafeUnwrap()).toMatchObject({ grantId: paid.grantId, points: 400 });
    }
    const fresh = await client.grantAction(receiptGrant(partnerId, 1));
    expect(fresh._unsafeUnwrapErr().code).toBe("allocation_exhausted");
  });

  it("refuses a receipt that names no partner", async () => {
    const unnamed = await client.grantAction(receiptGrant(undefined, 1));
    expect(unnamed._unsafeUnwrapErr().code).toBe("refused");
  });

  it("never lets a campaign hold or pay from a receipt package", async () => {
    const { businessId } = await receiptFunder();
    const allocationId = (await buyReceipts(businessId))._unsafeUnwrap().allocationId;
    const held = await client.hold({ allocationId, points: toPoints(1), sagaId: randomUUID() });
    expect(held._unsafeUnwrapErr().code).toBe("refused");

    const campaign = await rewardedCampaign();
    await db.execute(sql`
      UPDATE campaign.reward_config SET allocation_id = ${allocationId}
       WHERE campaign_id = ${campaign.campaignId}::uuid
    `);
    const paid = await client.grantReward(reward(campaign, randomUUID(), 3));
    expect(paid._unsafeUnwrapErr().code).toBe("refused");
    expect(await remaining(allocationId)).toBe(1_000);
  });
});
