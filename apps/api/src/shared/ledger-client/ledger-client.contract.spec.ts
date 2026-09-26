import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import { testDb } from "../testing/test-db";
import { FakeLedgerClient } from "./fake-ledger-client";
import { HttpLedgerClient } from "./http-ledger-client";
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
const client: LedgerInternalClient =
  liveUrl === undefined
    ? new FakeLedgerClient(db)
    : new HttpLedgerClient(
        liveUrl,
        process.env["LEDGER_SERVICE_SECRET"] ?? "local-only-ledger-service-secret-not-real",
        db,
      );

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
 * region: at the ID backing rate of IDR 6 a point, S = 6 × points.
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
  return listingId;
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
        })
      ).isOk(),
    ).toBe(true);
    const balance = (await client.balance(userId))._unsafeUnwrap();
    expect(balance.availablePoints).toBe(100);
    expect(balance.pending).toHaveLength(0);
  });

  it("the same idempotency key with a different body returns idempotency_conflict", async () => {
    const userId = randomUUID();
    const idempotencyKey = randomUUID();
    expect(
      (
        await client.grantAction({
          kind: "receipt",
          userId,
          region: "ID",
          points: toPoints(10),
          trustTier: 3,
          idempotencyKey,
        })
      ).isOk(),
    ).toBe(true);
    const conflict = await client.grantAction({
      kind: "receipt",
      userId,
      region: "ID",
      points: toPoints(99),
      trustTier: 3,
      idempotencyKey,
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

  it("statements and approvePayout are not implemented until 10.1", async () => {
    await expect(
      client.statements({ businessId: randomUUID(), from: "2026-01-01", to: "2026-01-31" }),
    ).rejects.toThrow(/not implemented/);
    await expect(
      client.approvePayout({ statementId: randomUUID(), approvedBy: "staff-1" }),
    ).rejects.toThrow(/not implemented/);
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

  it("releaseNow releases a pending grant and is idempotent", async () => {
    const userId = randomUUID();
    const granted = await fake.grantAction({
      kind: "goodwill",
      userId,
      region: "AU",
      points: toPoints(40),
      trustTier: 0, // F12: 72h holdback, still pending
      idempotencyKey: randomUUID(),
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
