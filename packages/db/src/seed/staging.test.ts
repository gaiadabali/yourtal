import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { verify as verifyPassword } from "@node-rs/argon2";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { OWNER_URL } from "../database-urls";
import { seedStaging } from "./staging";

/**
 * 2.3.e — a real round trip against real Postgres (`OWNER_URL`, the same
 * role the seed itself writes as), plus a real HTTP server standing in for
 * the ledger so the request `ensureTierZeroPendingGrant` sends can actually
 * be inspected — same convention `apps/worker/src/jobs/points-unlocked.test.ts`
 * uses for the ledger it talks to.
 *
 * The real staging incident this file is written against: the world seeded
 * fine, but `plat_AU_marketing_cash` was unfunded, so the ledger answered
 * `409 insufficient_available`, the seed logged "unreachable" (wrong word
 * for a real error) and never retried because the whole thing was gated on
 * "no identity.user_profile rows". These tests pin the fix: funding runs
 * every time, the grant is retried every time until it exists, and a real
 * ledger failure is reported as `"failed"` with its code, not swallowed.
 *
 * `replayDetectionWindowMs` is passed small in every test below —
 * `ensureTierZeroPendingGrant`'s "was this grant just created or was it
 * already there" heuristic compares `grantedAt` to now, and a test calls
 * `seedStaging` twice milliseconds apart, not 30 real seconds apart.
 */

const DEMO_PASSWORD = "staging-seed-test-password-not-real";
const LEDGER_SECRET = "test-only-ledger-service-secret-32-bytes!";
/** Small enough that two calls in the same test are unambiguously "later"
 * than this; see this file's own header. */
const TEST_REPLAY_WINDOW_MS = 20;

let owner: pg.Pool;

beforeAll(() => {
  owner = new pg.Pool({ connectionString: OWNER_URL, max: 4 });
});

afterAll(async () => {
  await owner.end();
});

const BUSINESS_IDS = [
  "00000000-0000-4000-9000-000000000001",
  "00000000-0000-4000-9000-000000000002",
];
const CAMPAIGN_IDS = [
  "00000000-0000-4000-9000-000000000101",
  "00000000-0000-4000-9000-000000000102",
  "00000000-0000-4000-9000-000000000201",
  "00000000-0000-4000-9000-000000000202",
];
const DEMO_EMAILS = [
  "viewer.au@demo.yourtal.test",
  "owner.au@demo.yourtal.test",
  "member.au@demo.yourtal.test",
  "owner.id@demo.yourtal.test",
  "support@demo.yourtal.test",
  "moderator@demo.yourtal.test",
  "risk-analyst@demo.yourtal.test",
  "finance@demo.yourtal.test",
  "ops@demo.yourtal.test",
  "admin@demo.yourtal.test",
];

/** Deletes exactly the rows this seed's WORLD step can have written, in
 * dependency order — never a whole-table wipe (vitest.config.ts's own
 * convention). Never touches `ledger.marketing_funding`/`ledger.entry`:
 * funding is meant to persist forever once done, in tests as in reality. */
async function cleanStagingRows(): Promise<void> {
  const userIds = await owner.query<{ user_id: string }>(
    `SELECT user_id FROM identity.credential WHERE kind = 'password' AND identifier = ANY($1)`,
    [DEMO_EMAILS],
  );
  const ids = userIds.rows.map((row) => row.user_id);
  if (ids.length > 0) {
    await owner.query(`DELETE FROM business.business_members WHERE user_id = ANY($1)`, [ids]);
    await owner.query(`DELETE FROM identity.staff_role WHERE user_id = ANY($1)`, [ids]);
    await owner.query(`DELETE FROM identity.user_profile WHERE user_id = ANY($1)`, [ids]);
    await owner.query(`DELETE FROM identity.credential WHERE user_id = ANY($1)`, [ids]);
  }
  await owner.query(`DELETE FROM campaign.video_source WHERE campaign_id = ANY($1)`, [
    CAMPAIGN_IDS,
  ]);
  await owner.query(`DELETE FROM campaign.terms_version WHERE campaign_id = ANY($1)`, [
    CAMPAIGN_IDS,
  ]);
  await owner.query(`DELETE FROM campaign.campaigns WHERE id = ANY($1)`, [CAMPAIGN_IDS]);
  await owner.query(`DELETE FROM business.business_accounts WHERE id = ANY($1)`, [BUSINESS_IDS]);
}

async function marketingCashBalance(region: "AU" | "ID"): Promise<number> {
  const { rows } = await owner.query<{ balance: string }>(
    `SELECT (-COALESCE(SUM(amount_minor), 0))::text AS balance
       FROM ledger.entry WHERE account_id = $1`,
    [`plat_${region}_marketing_cash`],
  );
  return Number(rows[0]?.balance ?? "0");
}

/** A stand-in for `POST /v1/actions/grants` — records the request it
 * received and answers either with a plausible grant view (replaying the
 * SAME `grantedAt` on every success, exactly like the real reward engine's
 * replay rule does) or, in `"insufficient"` mode, the real 409 body staging
 * actually got. */
class FakeLedger {
  mode: "ok" | "insufficient" = "ok";
  received: { path: string; signatureHeader: string; body: unknown } | undefined;
  private grantedAt: string | undefined;
  server: Server = createServer((req, res) => {
    void this.answer(req).then(([status, body]) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  });

  private async answer(req: IncomingMessage): Promise<[number, unknown]> {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    this.received = {
      path: req.url ?? "",
      signatureHeader: String(req.headers["x-yourtal-service-signature"] ?? ""),
      body: JSON.parse(raw) as unknown,
    };
    if (this.mode === "insufficient") {
      return [
        409,
        {
          code: "insufficient_available",
          message:
            "ledger: insufficient funds: plat_AU_marketing_cash holds 0, the transfer takes 500",
        },
      ];
    }
    const body = this.received.body as {
      userId: string;
      kind: string;
      region: string;
      points: number;
    };
    // The real reward engine's replay rule returns the STORED grantedAt on
    // a repeat, not a fresh one — reproduced here so the "just created vs
    // already there" heuristic under test sees the same shape it would in
    // production.
    this.grantedAt ??= new Date().toISOString();
    return [
      200,
      {
        grantId: "grant_test_1",
        kind: body.kind,
        userId: body.userId,
        region: body.region,
        points: body.points,
        unlockAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        grantedAt: this.grantedAt,
      },
    ];
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${String(port)}`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  await cleanStagingRows();
});

describe("seedStaging", () => {
  it("seeds the world once, funds marketing, grants once, and a replay reports already_present", async () => {
    const ledger = new FakeLedger();
    const baseUrl = await ledger.listen();
    try {
      const first = await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        log: () => undefined,
        replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
      });
      expect(first.world).toBe("seeded");
      expect(first.businesses).toBe(2);
      expect(first.campaigns).toBe(4);
      expect(first.accounts).toBe(10);
      expect(["funded", "already_funded"]).toContain(first.marketingFunding);
      expect(first.pendingGrant).toBe("granted");
      expect(first.pendingGrantDetail).toBeUndefined();

      // The ledger call really was the signed, shaped request the real
      // service expects.
      expect(ledger.received?.path).toBe("/v1/actions/grants");
      expect(ledger.received?.signatureHeader).toMatch(/^t=\d+,c=api,n=.+,v1=[0-9a-f]{64}$/);
      expect(ledger.received?.body).toMatchObject({
        kind: "goodwill",
        region: "AU",
        points: 500,
        trustTier: 0,
        idempotencyKey: "staging-seed-tier0-viewer-pending-grant",
      });

      // Whichever it was before this call, the F12 budget is funded now —
      // the invariant that actually matters, not the state-transition label.
      expect(await marketingCashBalance("AU")).toBeGreaterThanOrEqual(500_000);
      expect(await marketingCashBalance("ID")).toBeGreaterThanOrEqual(50_000_000);

      const businesses = await owner.query<{ handle: string; region: string; currency: string }>(
        `SELECT handle, region, currency FROM business.business_accounts
          WHERE id = ANY($1) ORDER BY handle`,
        [BUSINESS_IDS],
      );
      expect(businesses.rows).toStrictEqual([
        { handle: "snap-app-au", region: "AU", currency: "AUD" },
        { handle: "snap-app-id", region: "ID", currency: "IDR" },
      ]);

      const campaigns = await owner.query<{ hls_url: string }>(
        `SELECT hls_url FROM campaign.campaigns WHERE id = ANY($1)`,
        [CAMPAIGN_IDS],
      );
      expect(campaigns.rows).toHaveLength(4);
      for (const row of campaigns.rows) expect(row.hls_url).toContain("attention-30s");

      // Real credential hashing: the stored hash actually verifies the
      // demo password, the same way AuthService.login would check it.
      const credential = await owner.query<{ secret_hash: string }>(
        `SELECT secret_hash FROM identity.credential WHERE identifier = 'owner.au@demo.yourtal.test'`,
      );
      const hash = credential.rows[0]?.secret_hash;
      expect(hash).toBeDefined();
      await expect(verifyPassword(hash!, DEMO_PASSWORD)).resolves.toBe(true);
      await expect(verifyPassword(hash!, "definitely-wrong")).resolves.toBe(false);

      const staffRoles = await owner.query<{ role: string }>(
        `SELECT sr.role FROM identity.staff_role sr
           JOIN identity.credential c ON c.user_id = sr.user_id
          WHERE c.identifier LIKE '%@demo.yourtal.test'
          ORDER BY sr.role`,
      );
      expect(staffRoles.rows.map((row) => row.role)).toStrictEqual([
        "admin",
        "finance",
        "moderator",
        "ops",
        "risk_analyst",
        "support",
      ]);

      const members = await owner.query<{ role: string }>(
        `SELECT role FROM business.business_members WHERE business_id = ANY($1) ORDER BY role`,
        [BUSINESS_IDS],
      );
      expect(members.rows.map((row) => row.role)).toStrictEqual(["marketer", "owner", "owner"]);

      // A little past the (tiny, test-only) replay window: the world is
      // already there, funding is a no-op, and the grant replays as the
      // SAME grant rather than a new one.
      await sleep(TEST_REPLAY_WINDOW_MS + 20);
      const second = await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        log: () => undefined,
        replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
      });
      expect(second).toStrictEqual({
        world: "already_present",
        businesses: 0,
        campaigns: 0,
        accounts: 0,
        marketingFunding: "already_funded",
        pendingGrant: "already_present",
      });
    } finally {
      await ledger.close();
    }
  });

  it("creates the missing grant on a later run, once the world and funding are already in place", async () => {
    const ledger = new FakeLedger();
    const baseUrl = await ledger.listen();
    try {
      // The exact incident: the world seeds, but the ledger refuses the
      // grant (unfunded marketing cash) — this must fail, loudly, not
      // report a vague "unreachable".
      ledger.mode = "insufficient";
      const first = await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        log: () => undefined,
        replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
      });
      expect(first.world).toBe("seeded");
      expect(first.accounts).toBe(10);
      expect(first.pendingGrant).toBe("failed");
      expect(first.pendingGrantDetail).toBe("insufficient_available");

      // The next deploy: the ledger (and its cash) is fixed. Nothing about
      // identity.user_profile changed, so the world step is a no-op — but
      // the grant, still missing, is created this time.
      ledger.mode = "ok";
      const second = await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        log: () => undefined,
        replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
      });
      expect(second.world).toBe("already_present");
      expect(second.pendingGrant).toBe("granted");
      expect(second.pendingGrantDetail).toBeUndefined();
    } finally {
      await ledger.close();
    }
  });

  it("reports a network failure the same honest way — failed, with a detail, not unreachable", async () => {
    const result = await seedStaging(owner, {
      demoPassword: DEMO_PASSWORD,
      // Nothing listens here — a closed port on loopback, not a hostname
      // that could resolve to something real.
      ledger: { baseUrl: "http://127.0.0.1:1", serviceSecret: LEDGER_SECRET },
      log: () => undefined,
      replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
    });
    // Everything else this seed writes is unaffected by the ledger being
    // unreachable — only the grant step reports the failure.
    expect(result.world).toBe("seeded");
    expect(result.accounts).toBe(10);
    expect(["funded", "already_funded"]).toContain(result.marketingFunding);
    expect(result.pendingGrant).toBe("failed");
    expect(result.pendingGrantDetail).toBeDefined();
  });

  it("funds marketing exactly once across repeated runs", async () => {
    const ledger = new FakeLedger();
    const baseUrl = await ledger.listen();
    try {
      await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        log: () => undefined,
        replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
      });
      const balanceAfterFirst = [
        await marketingCashBalance("AU"),
        await marketingCashBalance("ID"),
      ];

      const second = await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        log: () => undefined,
        replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
      });
      expect(second.marketingFunding).toBe("already_funded");
      expect([await marketingCashBalance("AU"), await marketingCashBalance("ID")]).toStrictEqual(
        balanceAfterFirst,
      );
    } finally {
      await ledger.close();
    }
  });
});
