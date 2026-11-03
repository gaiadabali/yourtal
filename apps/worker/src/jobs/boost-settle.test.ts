import { randomUUID } from "node:crypto";
import { err, ok } from "neverthrow";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { createSimulatedPayments, simulatedProcessorUnits } from "@yourtal/drivers/payments";
import type { PaymentsDriver, SavedChargeRequest } from "@yourtal/drivers/payments";
import type { PaymentProviders } from "@yourtal/drivers/payment-providers";
import { runBoostSettle } from "./boost-settle";

/** 13.23.c / 5.1.a against real Postgres: the simulated driver, and a Stripe-shaped one. */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");
const pool = new Pool({ connectionString: DATABASE_URL });

afterAll(async () => {
  await pool.end();
});

const TODAY = `(now() AT TIME ZONE 'Australia/Sydney')::date`;

/** A boosted AU campaign; `days` maps days-ago to spend in thousandths of a cent. */
async function seedSpend(
  days: Record<number, number>,
): Promise<{ campaignId: string; businessId: string }> {
  const campaignId = randomUUID();
  const businessId = randomUUID();
  await pool.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds, reward_points,
        question_count, scoring_rule, lifecycle_state, business_id, region, audience,
        content_category, starts_at, ends_at, open_viewing, teaser_start_seconds)
     VALUES ($1, 'quick', 'Boost settle', $2, 'Boost settle', 'x', 30, 3, 0, 'base_only', 'draft',
             $2, 'AU', 'all_ages', 'food-and-drink', now(), now() + interval '9 days', false, 0)`,
    [campaignId, businessId],
  );
  await pool.query(
    `INSERT INTO feed.boost (campaign_id, business_id, region, currency, daily_budget_minor,
                             max_bid_cpm_minor, starts_at, ends_at, state)
     VALUES ($1, $2, 'AU', 'AUD', 100, 500, now() - interval '9 days', now() + interval '5 days', 'active')`,
    [campaignId, businessId],
  );
  for (const [ago, milli] of Object.entries(days)) {
    await pool.query(
      `INSERT INTO feed.boost_spend_day (campaign_id, day, impressions, spent_milli)
       VALUES ($1, ${TODAY} - $2::int, 4, $3)`,
      [campaignId, Number(ago), milli],
    );
  }
  return { campaignId, businessId };
}

async function charges(campaignId: string) {
  const { rows } = await pool.query<{
    day_ago: number;
    amount_minor: string;
    subtotal_minor: string;
    tax_minor: string;
    provider_reference: string;
  }>(
    `SELECT (${TODAY} - day) AS day_ago, amount_minor, subtotal_minor, tax_minor, provider_reference
       FROM feed.boost_charge WHERE campaign_id = $1 ORDER BY day`,
    [campaignId],
  );
  return rows;
}

function providers(au: PaymentsDriver): Readonly<Record<"AU" | "ID", PaymentProviders>> {
  const id = createSimulatedPayments(undefined, {
    declaredMinorUnitExponent: simulatedProcessorUnits(),
  });
  const unused = {} as PaymentProviders["marketplace"];
  const payouts = {} as PaymentProviders["payoutAccounts"];
  return {
    AU: { payments: au, marketplace: unused, payoutAccounts: payouts },
    ID: { payments: id, marketplace: unused, payoutAccounts: payouts },
  };
}

type Answer = "ok" | "timeout" | "declined";

/**
 * Stripe's shape: a saved card is required and A$0.50 is the least it charges. Records each
 * charge; `script` lists the answers for one campaign's charges, then "ok" (other tests' rows
 * share this database, so answers are per campaign).
 */
function stripeShaped(script: Record<string, Answer[]> = {}) {
  const calls: SavedChargeRequest[] = [];
  const driver: PaymentsDriver = {
    ...createSimulatedPayments(),
    provider: "stripe",
    needsSavedCard: true,
    minimumChargeMinor: { AUD: 50 },
    chargeSaved: (request) => {
      calls.push(request);
      const campaign = request.idempotencyKey.split(":")[1] ?? "";
      const answer = script[campaign]?.shift() ?? "ok";
      if (answer === "ok")
        return Promise.resolve(
          ok({ paymentReference: `pi_${request.idempotencyKey}`, status: "succeeded" as const }),
        );
      return Promise.resolve(
        err({
          kind: answer === "timeout" ? ("timeout" as const) : ("declined" as const),
          boundary: "payments",
          detail: answer,
          mayHaveSucceeded: answer === "timeout",
        }),
      );
    },
  };
  return { driver, calls };
}

async function saveCard(businessId: string) {
  await pool.query(
    `INSERT INTO payment.saved_card (owner_kind, owner_id, region, provider, customer_ref,
                                     payment_method_ref, brand, last4, exp_month, exp_year)
     VALUES ('business', $1, 'AU', 'stripe', 'cus_test', 'pm_test', 'visa', '4242', 12, 2034)`,
    [businessId],
  );
}

describe("boost-settle job", () => {
  it("a stopped boost still pays for the days it served, once, and a later run adds nothing", async () => {
    // Served three and two days ago, stopped a day ago (14.22.f: stopping keeps the row, so the
    // served days are billed; days after the stop have no spend row because nothing was served).
    const { campaignId } = await seedSpend({ 3: 30_000, 2: 30_000 });
    await pool.query(
      `UPDATE feed.boost SET state = 'paused', ends_at = now() - interval '1 day' WHERE campaign_id = $1`,
      [campaignId],
    );
    const sim = providers(createSimulatedPayments());

    await runBoostSettle(pool, sim);
    await runBoostSettle(pool, sim);

    const rows = await charges(campaignId);
    expect(rows.map((r) => [r.day_ago, r.subtotal_minor])).toEqual([
      [3, "30"],
      [2, "30"],
    ]);
  });

  it("charges each closed day once with GST on top, and never today (simulated driver)", async () => {
    const { campaignId } = await seedSpend({ 1: 21_070, 0: 602 });
    const sim = providers(createSimulatedPayments());

    await runBoostSettle(pool, sim);
    await runBoostSettle(pool, sim); // a rerun charges nothing twice

    // 21.07 cents rounds up to 22; GST 2.2 rounds to 2 (F118).
    const rows = await charges(campaignId);
    expect(rows.map((r) => [r.day_ago, r.subtotal_minor, r.tax_minor, r.amount_minor])).toEqual([
      [1, "22", "2", "24"],
    ]);
    // The simulated driver saved a card on demand.
    const { rows: cards } = await pool.query(
      `SELECT 1 FROM payment.saved_card s JOIN feed.boost b ON b.business_id = s.owner_id
        WHERE b.campaign_id = $1 AND s.replaced_at IS NULL`,
      [campaignId],
    );
    expect(cards).toHaveLength(1);
  });

  it("skips a business with no saved card where the processor needs one", async () => {
    const { campaignId } = await seedSpend({ 1: 90_000 });
    const { driver, calls } = stripeShaped();
    const result = await runBoostSettle(pool, providers(driver));
    expect(result.noCard).toBeGreaterThanOrEqual(1);
    expect(calls.filter((c) => c.idempotencyKey.includes(campaignId))).toEqual([]);
    expect(await charges(campaignId)).toEqual([]);
  });

  it("waits below the minimum, then charges the days together once with one reference", async () => {
    const { campaignId, businessId } = await seedSpend({ 3: 20_000, 2: 20_000 });
    await saveCard(businessId);
    const { driver, calls } = stripeShaped();
    const mine = () => calls.filter((c) => c.idempotencyKey.includes(campaignId));

    await runBoostSettle(pool, providers(driver)); // 40c + 4c GST < 50c: waits
    expect(mine()).toEqual([]);

    await pool.query(
      `INSERT INTO feed.boost_spend_day (campaign_id, day, impressions, spent_milli)
       VALUES ($1, ${TODAY} - 1, 4, 10000)`,
      [campaignId],
    );
    await runBoostSettle(pool, providers(driver));
    await runBoostSettle(pool, providers(driver));

    expect(mine()).toHaveLength(1);
    expect(mine()[0]).toMatchObject({
      amountMinor: 55,
      currency: "AUD",
      paymentMethodRef: "pm_test",
    });
    const rows = await charges(campaignId);
    expect(rows.map((r) => [r.day_ago, r.subtotal_minor, r.tax_minor])).toEqual([
      [3, "20", "2"],
      [2, "20", "2"],
      [1, "10", "1"],
    ]);
    expect(new Set(rows.map((r) => r.provider_reference)).size).toBe(1);
  });

  it("retries an unsure charge under the same key, and charges its days once", async () => {
    const { campaignId, businessId } = await seedSpend({ 2: 60_000 });
    await saveCard(businessId);
    const { driver, calls } = stripeShaped({ [campaignId]: ["timeout"] });
    const mine = () => calls.filter((c) => c.idempotencyKey.includes(campaignId));

    const first = await runBoostSettle(pool, providers(driver));
    expect(first.unsure).toBeGreaterThanOrEqual(1);
    expect(await charges(campaignId)).toEqual([]);

    // A new day closing in between must not change the key of the unsure charge.
    await pool.query(
      `INSERT INTO feed.boost_spend_day (campaign_id, day, impressions, spent_milli)
       VALUES ($1, ${TODAY} - 1, 4, 1000)`,
      [campaignId],
    );
    await runBoostSettle(pool, providers(driver));

    expect(mine().map((c) => c.idempotencyKey)).toHaveLength(2);
    expect(mine()[0]?.idempotencyKey).toBe(mine()[1]?.idempotencyKey);
    expect((await charges(campaignId)).map((r) => [r.day_ago, r.amount_minor])).toEqual([
      [2, "66"],
    ]);
  });

  it("marks a declined batch and tries the days again on the next run", async () => {
    const { campaignId, businessId } = await seedSpend({ 1: 70_000 });
    await saveCard(businessId);
    const { driver, calls } = stripeShaped({ [campaignId]: ["declined"] });
    const result = await runBoostSettle(pool, providers(driver));
    expect(result.declined).toBeGreaterThanOrEqual(1);
    await runBoostSettle(pool, providers(driver));
    expect(calls.filter((c) => c.idempotencyKey.includes(campaignId))).toHaveLength(2);
    expect((await charges(campaignId)).map((r) => r.amount_minor)).toEqual(["77"]);
  });
});
