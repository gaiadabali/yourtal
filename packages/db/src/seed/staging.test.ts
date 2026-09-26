import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { verify as verifyPassword } from "@node-rs/argon2";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
 * 2.3.c's own follow-up (a real, decryptable voucher for the restore
 * rehearsal) gets the same treatment: `FakeVoucherService` stands in for
 * `services/voucher`'s `/internal/v1/batches` and `/internal/v1/batches/
 * approve`, and — because approval only ANSWERS success, it does not prove
 * a voucher exists (see `ensureDemoVoucher`'s own header) — actually inserts
 * a `voucher.vouchers` row on a successful approve, exactly like the real
 * mint would, so `ensureDemoVoucher`'s own re-check has something real to
 * find.
 *
 * `replayDetectionWindowMs` is passed small in every test below —
 * `ensureTierZeroPendingGrant`'s "was this grant just created or was it
 * already there" heuristic compares `grantedAt` to now, and a test calls
 * `seedStaging` twice milliseconds apart, not 30 real seconds apart.
 */

const DEMO_PASSWORD = "staging-seed-test-password-not-real";
const LEDGER_SECRET = "test-only-ledger-service-secret-32-bytes!";
const VOUCHER_SECRET = "test-only-voucher-service-secret-32-bytes!";
/** Small enough that two calls in the same test are unambiguously "later"
 * than this; see this file's own header. */
const TEST_REPLAY_WINDOW_MS = 20;

let owner: pg.Pool;
let voucherService: FakeVoucherService;
let voucherBaseUrl: string;

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: OWNER_URL, max: 4 });
  voucherService = new FakeVoucherService(owner);
  voucherBaseUrl = await voucherService.listen();
});

afterAll(async () => {
  await voucherService.close();
  await owner.end();
});

beforeEach(() => {
  voucherService.mode = "ok";
  voucherService.received = [];
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
/** Same fixed ids `staging.ts`'s own `DEMO_LISTING_ID`/`DEMO_LOCATION_ID` use. */
const LISTING_ID = "00000000-0000-4000-9000-000000000301";
const LOCATION_ID = "00000000-0000-4000-9000-000000000302";
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
  await owner.query(`DELETE FROM voucher.vouchers WHERE listing_id = $1`, [LISTING_ID]);
  await owner.query(`DELETE FROM store.listing_location WHERE listing_id = $1`, [LISTING_ID]);
  await owner.query(`DELETE FROM store.merchant_location WHERE id = $1`, [LOCATION_ID]);
  await owner.query(`DELETE FROM store.listings WHERE id = $1`, [LISTING_ID]);
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
  /** Every request this ledger has answered — a list, not a single slot,
   * because one `seedStaging` call makes TWO real ledger calls now
   * (`/v1/pricing/listing` then `/v1/actions/grants`), not one. */
  received: { path: string; signatureHeader: string; body: unknown }[] = [];
  private grantedAt: string | undefined;
  server: Server = createServer((req, res) => {
    void this.answer(req).then(([status, body]) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  });

  /** The most recent request to this exact path, or `undefined`. */
  lastRequestTo(
    path: string,
  ): { path: string; signatureHeader: string; body: unknown } | undefined {
    return [...this.received].reverse().find((entry) => entry.path === path);
  }

  private async answer(req: IncomingMessage): Promise<[number, unknown]> {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    const entry = {
      path: req.url ?? "",
      signatureHeader: String(req.headers["x-yourtal-service-signature"] ?? ""),
      body: JSON.parse(raw) as unknown,
    };
    this.received.push(entry);
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

    if (entry.path === "/v1/pricing/listing") {
      // A plausible priced-listing response — `priceDemoListing` only reads
      // `pricePoints`, and the exact formula is the real ledger's, not this
      // fake's to reproduce.
      return [200, { pricePoints: 1_000, backingRateId: "rate_test_1" }];
    }

    const body = entry.body as {
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

/** A stand-in for the voucher service's `/internal/v1/batches` and
 * `/internal/v1/batches/approve` — the same two routes
 * `ensureDemoVoucher` calls. `"failing"` mode answers the real refusal
 * shape (`{code, message}`) a service error carries; `"ok"` mode plays
 * requester/approver back exactly like the real two-person check would
 * refuse a mismatch, and — because an "approved" response does not by
 * itself prove a voucher was minted — actually inserts a `voucher.vouchers`
 * row on approve, so `ensureDemoVoucher`'s own database re-check has
 * something real to find, the same way a real mint would leave one. */
class FakeVoucherService {
  mode: "ok" | "failing" = "ok";
  received: { path: string; signatureHeader: string; body: unknown }[] = [];
  private lastRequestedBy: string | undefined;
  server: Server = createServer((req, res) => {
    this.answer(req)
      .then(([status, body]) => {
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      })
      .catch((error: unknown) => {
        // Without this, a thrown error inside `answer` (the FK violation
        // this file's own history had) leaves the response never sent —
        // the client's `fetch` hangs until the test's own timeout, which is
        // a much worse failure to debug than a plain 500.
        res
          .writeHead(500, { "content-type": "application/json" })
          .end(JSON.stringify({ error: String(error) }));
      });
  });

  constructor(private readonly pool: pg.Pool) {}

  private async answer(req: IncomingMessage): Promise<[number, unknown]> {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    const path = req.url ?? "";
    const body = JSON.parse(raw) as Record<string, unknown>;
    this.received.push({
      path,
      signatureHeader: String(req.headers["x-yourtal-service-signature"] ?? ""),
      body,
    });

    if (this.mode === "failing") {
      return [409, { code: "allocation_exhausted", message: "voucher: no stock for this batch" }];
    }

    if (path === "/internal/v1/batches") {
      const batchId = randomUUID();
      this.lastRequestedBy = String(body.requestedBy);
      return [
        200,
        {
          batchId,
          listingId: body.listingId,
          merchantId: body.merchantId,
          currency: body.currency,
          faceValueMinor: body.faceValueMinor,
          quantity: body.quantity,
          requestedBy: body.requestedBy,
          approvedBy: null,
          state: "pending",
        },
      ];
    }

    if (path === "/internal/v1/batches/approve") {
      await this.mintOneVoucher();
      return [
        200,
        {
          batchId: body.batchId,
          listingId: LISTING_ID,
          merchantId: BUSINESS_IDS[0],
          currency: "AUD",
          faceValueMinor: 4_500,
          quantity: 1,
          requestedBy: this.lastRequestedBy ?? "unknown",
          approvedBy: body.approvedBy,
          state: "approved",
        },
      ];
    }

    return [404, { error: { type: "invalid_request_error", code: "not_found", message: path } }];
  }

  /** Exactly the shape a real mint leaves — unclaimed (`owner_id` NULL,
   * `state = 'minted'`), matching `vouchers_owner_iff_issued`'s own CHECK.
   * No `batch_id`: that column FKs to `voucher.batch`, a table only the
   * real service writes to (this fake mocks the HTTP layer, not its DB
   * writes) — `batch_id` is nullable, and this seed never reads it back. */
  private async mintOneVoucher(): Promise<void> {
    const now = new Date();
    await this.pool.query(
      `INSERT INTO voucher.vouchers
         (id, listing_id, merchant_id, merchant_name, title, face_value_minor,
          remaining_value_minor, partial_redemption_policy, transferable, issued_at,
          expires_at, location_id, state, currency, region)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'minted',$13,$14)`,
      [
        randomUUID(),
        LISTING_ID,
        BUSINESS_IDS[0],
        "Snap App",
        "Snap App — Demo Voucher",
        4_500,
        4_500,
        "single_use_forfeit",
        false,
        now.toISOString(),
        new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        LOCATION_ID,
        "AUD",
        "AU",
      ],
    );
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
        voucher: { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
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
      expect(first.demoVoucher).toBe("created");
      expect(first.demoVoucherDetail).toBeUndefined();

      // The ledger calls really were the signed, shaped requests the real
      // service expects — both the pricing call (step 4) and the grant
      // (step 3).
      const grantRequest = ledger.lastRequestTo("/v1/actions/grants");
      expect(grantRequest?.signatureHeader).toMatch(/^t=\d+,c=api,n=.+,v1=[0-9a-f]{64}$/);
      expect(grantRequest?.body).toMatchObject({
        kind: "goodwill",
        region: "AU",
        points: 500,
        trustTier: 0,
        idempotencyKey: "staging-seed-tier0-viewer-pending-grant",
      });
      const pricingRequest = ledger.lastRequestTo("/v1/pricing/listing");
      expect(pricingRequest?.signatureHeader).toMatch(/^t=\d+,c=api,n=.+,v1=[0-9a-f]{64}$/);
      expect(pricingRequest?.body).toMatchObject({
        listingId: LISTING_ID,
        region: "AU",
        currency: "AUD",
        settlementMinor: 3_000,
      });

      // Same for the voucher service: two signed calls, request then
      // approve, with a DIFFERENT requester and approver (the two-person
      // rule) and the listing's own economics on the wire.
      expect(voucherService.received).toHaveLength(2);
      const [requested, approved] = voucherService.received;
      expect(requested?.path).toBe("/internal/v1/batches");
      expect(requested?.signatureHeader).toMatch(/^t=\d+,c=api,n=.+,v1=[0-9a-f]{64}$/);
      expect(requested?.body).toMatchObject({
        listingId: LISTING_ID,
        merchantId: BUSINESS_IDS[0],
        currency: "AUD",
        faceValueMinor: 4_500,
        quantity: 1,
        requestedBy: "staging-seed-requester",
      });
      expect(approved?.path).toBe("/internal/v1/batches/approve");
      expect(approved?.body).toMatchObject({ approvedBy: "staging-seed-approver" });
      const requestedBody = requested?.body as { requestedBy: string };
      const approvedBody = approved?.body as { approvedBy: string };
      expect(approvedBody.approvedBy).not.toBe(requestedBody.requestedBy);

      // A real, minted voucher — the whole point (2.3.c).
      const mintedVouchers = await owner.query<{
        state: string;
        currency: string;
        region: string;
      }>(`SELECT state, currency, region FROM voucher.vouchers WHERE listing_id = $1`, [
        LISTING_ID,
      ]);
      expect(mintedVouchers.rows).toStrictEqual([
        { state: "minted", currency: "AUD", region: "AU" },
      ]);

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
        voucher: { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
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
        demoVoucher: "already_present",
      });
      // Still exactly one voucher — the replay minted nothing new.
      const vouchers = await owner.query(`SELECT 1 FROM voucher.vouchers WHERE listing_id = $1`, [
        LISTING_ID,
      ]);
      expect(vouchers.rowCount).toBe(1);
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
        voucher: { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
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
        voucher: { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
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

  it("creates the missing voucher on a later run, once the world is already in place", async () => {
    const ledger = new FakeLedger();
    const baseUrl = await ledger.listen();
    try {
      // The voucher service refuses (no stock) on the first run — same
      // shape as the ledger incident, for the same reason: this must fail
      // loudly, not silently, and must not stop the world/grant from
      // seeding.
      voucherService.mode = "failing";
      const first = await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        voucher: { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
        log: () => undefined,
        replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
      });
      expect(first.world).toBe("seeded");
      expect(first.pendingGrant).toBe("granted");
      expect(first.demoVoucher).toBe("failed");
      expect(first.demoVoucherDetail).toBe("allocation_exhausted");
      // The listing itself was still created — only the mint failed.
      const listingRow = await owner.query(`SELECT 1 FROM store.listings WHERE id = $1`, [
        LISTING_ID,
      ]);
      expect(listingRow.rowCount).toBe(1);

      // The next deploy: the voucher service is healthy. The world and the
      // listing are already there — only the still-missing voucher is minted.
      voucherService.mode = "ok";
      const second = await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        voucher: { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
        log: () => undefined,
        replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
      });
      expect(second.world).toBe("already_present");
      expect(second.demoVoucher).toBe("created");
      expect(second.demoVoucherDetail).toBeUndefined();
      const vouchers = await owner.query(`SELECT 1 FROM voucher.vouchers WHERE listing_id = $1`, [
        LISTING_ID,
      ]);
      expect(vouchers.rowCount).toBe(1);
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
      voucher: { baseUrl: "http://127.0.0.1:1", serviceSecret: VOUCHER_SECRET },
      log: () => undefined,
      replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
    });
    // Everything else this seed writes is unaffected by the ledger/voucher
    // service being unreachable — only those two steps report the failure.
    expect(result.world).toBe("seeded");
    expect(result.accounts).toBe(10);
    expect(["funded", "already_funded"]).toContain(result.marketingFunding);
    expect(result.pendingGrant).toBe("failed");
    expect(result.pendingGrantDetail).toBeDefined();
    expect(result.demoVoucher).toBe("failed");
    expect(result.demoVoucherDetail).toBeDefined();
  });

  it("funds marketing exactly once across repeated runs", async () => {
    const ledger = new FakeLedger();
    const baseUrl = await ledger.listen();
    try {
      await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        voucher: { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
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
        voucher: { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
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
