import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { OWNER_URL } from "../database-urls";
import { runDemoCampaignFunding } from "./demo-campaign-funding";

/**
 * TASKS.md 11.4.h. A real Postgres round trip (`OWNER_URL`, the same role
 * `main-staging.ts` connects as) plus a real HTTP server standing in for the
 * ledger, same convention `staging.test.ts`/`demo-media-vouchers.test.ts`
 * already use — this proves the actual request `/v1/allocations/purchase`
 * receives (points, paidMinor, currency) and the actual `campaign.
 * reward_config` row that lands, not just that something was called.
 *
 * Reads the REAL F12 settings rows (`demo_reward_points_per_minute`,
 * `demo_accuracy_bonus`, `reward_ceiling_points_per_minute`) migration
 * 20260925193000 seeds into every test database — never re-declares 5/80/25
 * here, so a change to those settings would break this test the same way it
 * would break the real deploy.
 */
const LEDGER_SECRET = "test-only-ledger-service-secret-32-bytes!";

let owner: pg.Pool;

beforeAll(() => {
  owner = new pg.Pool({ connectionString: OWNER_URL, max: 4 });
});

afterAll(async () => {
  await owner.end();
});

/** Answers `/v1/allocations/purchase` with an Allocation echoing the
 * request — the real math this test cares about is what `runDemoCampaignFunding`
 * SENT, captured in `received`, not anything the ledger computes. */
class FakeLedger {
  received: { path: string; body: Record<string, unknown> }[] = [];
  mode: "ok" | "failing" = "ok";
  server: Server = createServer((req, res) => {
    void this.answer(req).then(([status, body]) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  });

  private async answer(req: IncomingMessage): Promise<[number, unknown]> {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    const body = JSON.parse(raw) as Record<string, unknown>;
    this.received.push({ path: req.url ?? "", body });
    if (this.mode === "failing") return [500, { code: "kill_switch", message: "nope" }];
    return [
      200,
      {
        allocationId: `alloc_${String(body.idempotencyKey)}`,
        businessId: body.businessId,
        region: body.region,
        funderType: "partner",
        totalPoints: body.points,
        remainingPoints: body.points,
        createdAt: new Date().toISOString(),
      },
    ];
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${String((this.server.address() as AddressInfo).port)}`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

let ledgerService: FakeLedger;
let ledgerBaseUrl: string;

beforeAll(async () => {
  ledgerService = new FakeLedger();
  ledgerBaseUrl = await ledgerService.listen();
});

afterAll(async () => {
  await ledgerService.close();
});

afterEach(() => {
  ledgerService.mode = "ok";
  ledgerService.received = [];
});

async function insertLiveCampaign(params: {
  region: "AU" | "ID";
  durationSeconds: number;
}): Promise<{ campaignId: string; businessId: string }> {
  const campaignId = randomUUID();
  const businessId = randomUUID();
  await owner.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
        estimated_data_mb, reward_points, question_count, scoring_rule,
        lifecycle_state, published_at, business_id, region, audience, content_category,
        poster_url, teaser_url, hls_url, captions_url, aspect, estimated_bytes,
        starts_at, ends_at, open_viewing, teaser_start_seconds)
     VALUES ($1,'long_form',$2,$3,'Test Merchant','A test campaign',$4,
             10.5, 0, 0, 'base_only',
             'live', now(), $3, $5, 'all_ages', 'entertainment',
             'http://127.0.0.1:26900/x/poster.jpg', 'http://127.0.0.1:26900/x/teaser.mp4',
             'http://127.0.0.1:26900/x/index.m3u8', null, '9:16', 1000,
             now(), now() + interval '90 days', true, 0)`,
    [campaignId, `Demo campaign funding test ${campaignId}`, businessId, params.durationSeconds, params.region],
  );
  return { campaignId, businessId };
}

async function cleanupCampaign(campaignId: string): Promise<void> {
  await owner.query(`DELETE FROM campaign.reward_config WHERE campaign_id = $1`, [campaignId]);
  await owner.query(`DELETE FROM campaign.campaigns WHERE id = $1`, [campaignId]);
}

interface RewardConfigRow {
  readonly allocation_id: string;
  readonly max_points_for_campaign: string;
  readonly reward_points_per_completion: string;
  readonly accuracy_bonus_points: string;
}

async function rewardConfigRow(campaignId: string): Promise<RewardConfigRow | undefined> {
  const result = await owner.query<RewardConfigRow>(
    `SELECT allocation_id, max_points_for_campaign, reward_points_per_completion, accuracy_bonus_points
       FROM campaign.reward_config WHERE campaign_id = $1`,
    [campaignId],
  );
  return result.rows[0];
}

describe("runDemoCampaignFunding", () => {
  it("funds an unfunded AU and ID campaign at the F12 demo rates, and is a no-op the second time", async () => {
    const au = await insertLiveCampaign({ region: "AU", durationSeconds: 65 });
    const id = await insertLiveCampaign({ region: "ID", durationSeconds: 65 });
    try {
      const results = await runDemoCampaignFunding(
        owner,
        { baseUrl: ledgerBaseUrl, serviceSecret: LEDGER_SECRET },
        () => undefined,
      );

      const auResult = results.find((r) => r.campaignId === au.campaignId);
      const idResult = results.find((r) => r.campaignId === id.campaignId);
      expect(auResult?.status).toBe("funded");
      expect(idResult?.status).toBe("funded");

      // AU: 5 pts/min * (65/60) min = 5.4167 -> 5; 25% bonus, capped at 40% -> 1.
      const auConfig = await rewardConfigRow(au.campaignId);
      expect(auConfig?.reward_points_per_completion).toBe("5");
      expect(auConfig?.accuracy_bonus_points).toBe("1");
      expect(auConfig?.max_points_for_campaign).toBe(String((5 + 1) * 1000));

      // ID: 80 pts/min * (65/60) min = 86.667 -> 87; 25% bonus -> 22 (<= 40% of 87 = 34).
      const idConfig = await rewardConfigRow(id.campaignId);
      expect(idConfig?.reward_points_per_completion).toBe("87");
      expect(idConfig?.accuracy_bonus_points).toBe("22");
      expect(idConfig?.max_points_for_campaign).toBe(String((87 + 22) * 1000));

      // Purchased in multiples of 1,000, priced off CLAUDE.md's own pack
      // rates (AU 1,000 pts = AUD 4500 minor; ID 1,000 pts = IDR 9,000).
      // Matched by OUR OWN businessId, never by region alone -- this test
      // database also carries the local dev seed's own mock campaigns
      // (`seedStudio`), which this same funding pass also funds.
      const auRequest = ledgerService.received.find((call) => call.body.businessId === au.businessId);
      expect(auRequest?.body.points).toBe(6000);
      expect(auRequest?.body.paidMinor).toBe(27_000);
      expect(auRequest?.body.currency).toBe("AUD");

      const idRequest = ledgerService.received.find((call) => call.body.businessId === id.businessId);
      expect(idRequest?.body.points).toBe(109_000);
      expect(idRequest?.body.paidMinor).toBe(981_000);
      expect(idRequest?.body.currency).toBe("IDR");

      // Re-running finds nothing left to fund for OUR campaigns (whatever
      // else this database holds may or may not already be funded).
      const second = await runDemoCampaignFunding(
        owner,
        { baseUrl: ledgerBaseUrl, serviceSecret: LEDGER_SECRET },
        () => undefined,
      );
      expect(
        second.filter((r) => r.campaignId === au.campaignId || r.campaignId === id.campaignId),
      ).toEqual([]);
    } finally {
      await cleanupCampaign(au.campaignId);
      await cleanupCampaign(id.campaignId);
    }
  });

  it("reports a ledger failure as failed and leaves no reward_config row", async () => {
    const campaign = await insertLiveCampaign({ region: "AU", durationSeconds: 30 });
    ledgerService.mode = "failing";
    try {
      const results = await runDemoCampaignFunding(
        owner,
        { baseUrl: ledgerBaseUrl, serviceSecret: LEDGER_SECRET },
        () => undefined,
      );
      const result = results.find((r) => r.campaignId === campaign.campaignId);
      expect(result?.status).toBe("failed");
      expect(await rewardConfigRow(campaign.campaignId)).toBeUndefined();
    } finally {
      await cleanupCampaign(campaign.campaignId);
    }
  });

  it("clamps to the region's reward ceiling when a lower one is in effect", async () => {
    // A newer, lower AU ceiling than F12's real 8/min -- proves the clamp
    // path in `rewardShapeFor` without needing a campaign hours long, since
    // the real demo rate (5/min, 6.25/min with its bonus) never itself
    // exceeds the real 8/min ceiling at any duration.
    await owner.query(
      `INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from)
       VALUES ('AU', 'reward_ceiling_points_per_minute', '2'::jsonb, 'test', 'test-approver', now())`,
    );
    const campaign = await insertLiveCampaign({ region: "AU", durationSeconds: 60 });
    try {
      const results = await runDemoCampaignFunding(
        owner,
        { baseUrl: ledgerBaseUrl, serviceSecret: LEDGER_SECRET },
        () => undefined,
      );
      expect(results.find((r) => r.campaignId === campaign.campaignId)?.status).toBe("funded");
      const config = await rewardConfigRow(campaign.campaignId);
      // ceiling 2 pts/min * 1 min = 2: bonus dropped to 0, base capped at 2.
      expect(config?.reward_points_per_completion).toBe("2");
      expect(config?.accuracy_bonus_points).toBe("0");
    } finally {
      await cleanupCampaign(campaign.campaignId);
      await owner.query(
        `DELETE FROM platform.region_setting WHERE region = 'AU' AND key = 'reward_ceiling_points_per_minute' AND set_by = 'test'`,
      );
    }
  });
});
