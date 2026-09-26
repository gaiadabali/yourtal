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
 * the ledger so the request `seedTierZeroPendingGrant` sends can actually be
 * inspected — same convention `apps/worker/src/jobs/points-unlocked.test.ts`
 * uses for the ledger it talks to.
 */

const DEMO_PASSWORD = "staging-seed-test-password-not-real";
const LEDGER_SECRET = "test-only-ledger-service-secret-32-bytes!";

let owner: pg.Pool;

beforeAll(() => {
  owner = new pg.Pool({ connectionString: OWNER_URL, max: 4 });
});

afterAll(async () => {
  await owner.end();
});

/** Deletes exactly the rows this seed can have written, in dependency
 * order — never a whole-table wipe (vitest.config.ts's own convention). */
async function cleanStagingRows(): Promise<void> {
  const emails = [
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
  const userIds = await owner.query<{ user_id: string }>(
    `SELECT user_id FROM identity.credential WHERE kind = 'password' AND identifier = ANY($1)`,
    [emails],
  );
  const ids = userIds.rows.map((row) => row.user_id);
  if (ids.length > 0) {
    await owner.query(`DELETE FROM business.business_members WHERE user_id = ANY($1)`, [ids]);
    await owner.query(`DELETE FROM identity.staff_role WHERE user_id = ANY($1)`, [ids]);
    await owner.query(`DELETE FROM identity.user_profile WHERE user_id = ANY($1)`, [ids]);
    await owner.query(`DELETE FROM identity.credential WHERE user_id = ANY($1)`, [ids]);
  }
  const campaignIds = [
    "00000000-0000-4000-9000-000000000101",
    "00000000-0000-4000-9000-000000000102",
    "00000000-0000-4000-9000-000000000201",
    "00000000-0000-4000-9000-000000000202",
  ];
  await owner.query(`DELETE FROM campaign.video_source WHERE campaign_id = ANY($1)`, [campaignIds]);
  await owner.query(`DELETE FROM campaign.terms_version WHERE campaign_id = ANY($1)`, [
    campaignIds,
  ]);
  await owner.query(`DELETE FROM campaign.campaigns WHERE id = ANY($1)`, [campaignIds]);
  await owner.query(`DELETE FROM business.business_accounts WHERE id = ANY($1)`, [
    ["00000000-0000-4000-9000-000000000001", "00000000-0000-4000-9000-000000000002"],
  ]);
}

/** A minimal stand-in for `POST /v1/actions/grants` — records the request it
 * received and answers with a plausible grant view. */
class FakeLedger {
  received: { path: string; signatureHeader: string; body: unknown } | undefined;
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
    const body = this.received.body as {
      userId: string;
      kind: string;
      region: string;
      points: number;
    };
    const now = new Date();
    return [
      200,
      {
        grantId: "grant_test_1",
        kind: body.kind,
        userId: body.userId,
        region: body.region,
        points: body.points,
        unlockAt: new Date(now.getTime() + 72 * 60 * 60 * 1000).toISOString(),
        grantedAt: now.toISOString(),
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

afterEach(async () => {
  await cleanStagingRows();
});

describe("seedStaging", () => {
  it("seeds businesses, campaigns, ten demo accounts and a real pending grant — idempotently", async () => {
    const ledger = new FakeLedger();
    const baseUrl = await ledger.listen();
    try {
      const first = await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        log: () => undefined,
      });
      expect(first).toStrictEqual({
        skipped: false,
        businesses: 2,
        campaigns: 4,
        accounts: 10,
        pendingGrant: "granted",
      });

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

      const businesses = await owner.query<{ handle: string; region: string; currency: string }>(
        `SELECT handle, region, currency FROM business.business_accounts
          WHERE id = ANY($1) ORDER BY handle`,
        [["00000000-0000-4000-9000-000000000001", "00000000-0000-4000-9000-000000000002"]],
      );
      expect(businesses.rows).toStrictEqual([
        { handle: "snap-app-au", region: "AU", currency: "AUD" },
        { handle: "snap-app-id", region: "ID", currency: "IDR" },
      ]);

      const campaigns = await owner.query<{ hls_url: string; region: string }>(
        `SELECT hls_url, region FROM campaign.campaigns
          WHERE id = ANY($1)`,
        [
          [
            "00000000-0000-4000-9000-000000000101",
            "00000000-0000-4000-9000-000000000102",
            "00000000-0000-4000-9000-000000000201",
            "00000000-0000-4000-9000-000000000202",
          ],
        ],
      );
      expect(campaigns.rows).toHaveLength(4);
      for (const row of campaigns.rows) {
        expect(row.hls_url).toContain("attention-30s");
      }

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
        `SELECT role FROM business.business_members
          WHERE business_id = ANY($1) ORDER BY role`,
        [["00000000-0000-4000-9000-000000000001", "00000000-0000-4000-9000-000000000002"]],
      );
      expect(members.rows.map((row) => row.role)).toStrictEqual(["marketer", "owner", "owner"]);

      // Re-running does nothing: identity.user_profile is not empty any more.
      const second = await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        log: () => undefined,
      });
      expect(second).toStrictEqual({
        skipped: true,
        businesses: 0,
        campaigns: 0,
        accounts: 0,
        pendingGrant: "skipped",
      });
    } finally {
      await ledger.close();
    }
  });

  it("still seeds everything else when the ledger cannot be reached", async () => {
    const result = await seedStaging(owner, {
      demoPassword: DEMO_PASSWORD,
      // Nothing listens here — a closed port on loopback, not a hostname
      // that could resolve to something real.
      ledger: { baseUrl: "http://127.0.0.1:1", serviceSecret: LEDGER_SECRET },
      log: () => undefined,
    });
    expect(result.skipped).toBe(false);
    expect(result.accounts).toBe(10);
    expect(result.pendingGrant).toBe("unreachable");
  });
});
