import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Statement } from "@yourtal/contracts/ledger-internal/economy";
import {
  SERVICE_SIGNATURE_HEADER,
  signServiceRequest,
} from "@yourtal/contracts/ledger-internal/service-signature";
import {
  REGIONS,
  buy,
  eventually,
  fundedViewer,
  live,
  post,
  redeemAtCounter,
  shop,
  staff,
  startJourney,
  stopJourney,
  type Journey,
} from "./journey-fixtures";

/**
 * Journey 9 (product-intent §2.2), both regions: a voucher honoured at the till
 * reaches the shop's weekly statement, which reproduces from ledger entries;
 * finance proposes the payout, a second finance approves it after the dispute
 * window, and the simulated payout moves the reserve and the shop's payable by
 * exactly the settlement value, once. The statement is generated with the
 * worker's own signed call; the dispute window is backdated as the owner,
 * because nobody can wait seven days in a test.
 */
let j: Journey | undefined;

beforeAll(async () => {
  if (live) j = await startJourney();
}, 240_000);
afterAll(async () => {
  if (live) await stopJourney(j);
});

async function generateStatement(journey: Journey, businessId: string, region: string) {
  const reqPath = "/v1/economy/statements/generate";
  const body = JSON.stringify({
    businessId,
    region,
    from: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    to: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  const response = await fetch(`${journey.services.ledgerUrl}${reqPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SERVICE_SIGNATURE_HEADER]: signServiceRequest({
        secret: journey.services.ledgerSecret,
        caller: "worker",
        method: "POST",
        pathAndQuery: reqPath,
        body,
      }),
    },
    body,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as Statement;
}

async function payable(journey: Journey, accountId: string): Promise<number> {
  const rows = await journey.owner.execute<{ balance: string | null }>(sql`
    SELECT (CASE WHEN a.kind IN ('asset', 'expense') THEN -1 ELSE 1 END
            * COALESCE(SUM(e.amount_minor), 0))::text AS balance
      FROM ledger.account a
      LEFT JOIN ledger.entry e ON e.account_id = a.id AND e.currency = a.currency
     WHERE a.id = ${accountId} GROUP BY a.kind`);
  return Number(rows.rows[0]?.balance ?? 0);
}

describe.skipIf(!live)("J9 settle", () => {
  it.each(REGIONS)(
    "%s: an honoured voucher is settled once, from the ledger",
    async (region) => {
      const journey = j!;
      const s = await shop(journey, region);
      const viewer = await fundedViewer(journey, region);
      const { voucherId } = await buy(journey, viewer, s.listingId);
      await redeemAtCounter(journey, viewer, s, region, voucherId);

      // The voucher service posts the capture to the ledger from its outbox.
      const payableId = `mer_${s.businessId}_payable_${s.currency}`;
      await eventually(async () => (await payable(journey, payableId)) > 0, 30_000);
    // 13.3.c: the shop is owed the settlement value S, not the face value it took.
    expect(await payable(journey, payableId)).toBe(s.settlementMinor);

      const statement = await generateStatement(journey, s.businessId, region);
      expect(statement).toMatchObject({
        capturesMinor: s.settlementMinor,
        closingPayableMinor: s.settlementMinor,
        status: "open",
      });
      await journey.owner.execute(sql`
      UPDATE ledger.statement SET dispute_window_ends_at = now() - interval '1 day'
       WHERE id = ${statement.id}`);

      const reserveId = `plat_${region}_reserve`;
      const reserveBefore = await payable(journey, reserveId);
      const proposer = await staff(journey, region, "finance");
      const approver = await staff(journey, region, "finance");
      const proposed = await post(
        journey,
        proposer.cookie,
        `/api/staff/settlement/${region}/statements/${statement.id}/payout-proposals`,
      );
      expect(proposed.statusCode, proposed.body).toBe(201);
      const proposalId = proposed.json<{ id: string }>().id;
      const approved = await post(
        journey,
        approver.cookie,
        `/api/staff/settlement/${region}/payout-proposals/${proposalId}/approve`,
      );
      expect(approved.statusCode, approved.body).toBe(201);

      expect(await payable(journey, payableId)).toBe(0);
      expect(await payable(journey, reserveId)).toBe(reserveBefore - s.settlementMinor);

      // Once: a second approval is refused and nothing moves again.
      const replay = await post(
        journey,
        approver.cookie,
        `/api/staff/settlement/${region}/payout-proposals/${proposalId}/approve`,
      );
      expect(replay.statusCode).toBeGreaterThanOrEqual(400);
      expect(await payable(journey, reserveId)).toBe(reserveBefore - s.settlementMinor);
    },
    120_000,
  );
});
