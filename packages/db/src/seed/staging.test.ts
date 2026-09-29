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
/** F74/8.2.i (reopened) — same fixed ids `staging.ts`'s own
 * `AU_AFFORDABLE_LISTING_ID`/`AU_AFFORDABLE_LOCATION_ID`/`ID_LISTING_ID`/
 * `ID_LOCATION_ID` use. */
const AU_AFFORDABLE_LISTING_ID = "00000000-0000-4000-9000-000000000303";
const AU_AFFORDABLE_LOCATION_ID = "00000000-0000-4000-9000-000000000304";
const ID_LISTING_ID = "00000000-0000-4000-9000-000000000305";
const ID_LOCATION_ID = "00000000-0000-4000-9000-000000000306";
const DEMO_EMAILS = [
  "viewer.au@demo.yourtal.test",
  "viewer.id@demo.yourtal.test",
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
  // F74/8.2.i (reopened): the same cleanup, for all three demo listings —
  // every test creates the two new ones as a side effect of a healthy
  // ledger/voucher pair, so a leftover row here would break the NEXT test's
  // own "does this listing exist yet" idempotency check.
  for (const [listingId, locationId] of [
    [LISTING_ID, LOCATION_ID],
    [AU_AFFORDABLE_LISTING_ID, AU_AFFORDABLE_LOCATION_ID],
    [ID_LISTING_ID, ID_LOCATION_ID],
  ]) {
    await owner.query(`DELETE FROM voucher.vouchers WHERE listing_id = $1`, [listingId]);
    await owner.query(`DELETE FROM store.listing_location WHERE listing_id = $1`, [listingId]);
    await owner.query(`DELETE FROM store.merchant_location WHERE id = $1`, [locationId]);
    await owner.query(`DELETE FROM store.listings WHERE id = $1`, [listingId]);
  }
}

/** F74/8.2.i (reopened) — the fake pricing formula's per-region rate
 * (minor units per point), chosen so `AU_AFFORDABLE_QUOTE_TARGET_POINTS`
 * (150) and `ID_AFFORDABLE_QUOTE_TARGET_POINTS` (250) — `staging.ts`'s own
 * constants — divide evenly through `deriveAffordableSettlementMinor`'s
 * probe (`points = ceil(settlementMinor / rate)` at a 1,000,000-minor-unit
 * probe): AU derives exactly 150,000 → 150 points; ID derives exactly
 * 1,250,000 → 250 points. Deliberately different per region, the same way
 * a real backing rate differs between AUD and IDR. */
const FAKE_RATE_MINOR_PER_POINT: Record<"AU" | "ID", number> = { AU: 1_000, ID: 5_000 };

async function marketingCashBalance(region: "AU" | "ID"): Promise<number> {
  const { rows } = await owner.query<{ balance: string }>(
    `SELECT (-COALESCE(SUM(amount_minor), 0))::text AS balance
       FROM ledger.entry WHERE account_id = $1`,
    [`plat_${region}_marketing_cash`],
  );
  return Number(rows[0]?.balance ?? "0");
}

/** A stand-in for `POST /v1/actions/grants` and `POST /v1/wallet/balance` —
 * records every request it received and answers either with a plausible
 * grant/balance view or, in `"insufficient"` mode, the real 409 body
 * staging actually got. Keyed per `idempotencyKey` (not one shared slot),
 * because F74/8.2.i's own topup calls make MANY distinct grants
 * (`staging-seed-viewer-AU-topup-1`, `-2`, ...), each independently
 * replayable, alongside the ORIGINAL fixed-key tier-0 grant.
 *
 * `"insufficient_topup"` refuses ONLY a trustTier-3 (top-up) grant, with F12's
 * OWN `velocity_capped` code, leaving pricing, the wallet-balance read and
 * the tier-0 (trustTier 0) grant healthy — the shape of the REAL ledger's
 * daily earn cap discovered by running this seed live (F74/8.2.i's own
 * verification): AU's cap is small enough that the mandatory tier-0 grant
 * alone can exhaust it. The only way to prove `"capped_for_today"` and the
 * "tops up further on a later run" behaviour without duplicating
 * `"insufficient"`'s all-paths refusal. */
class FakeLedger {
  mode: "ok" | "insufficient" | "insufficient_topup" = "ok";
  /** Every request this ledger has answered — a list, not a single slot,
   * because one `seedStaging` call makes several real ledger calls now
   * (pricing, the tier-0 grant, one or more balance reads, and one or more
   * topup grants), not one. */
  received: { path: string; signatureHeader: string; body: unknown }[] = [];
  private readonly grantedAtByKey = new Map<string, string>();
  /** Only a `trustTier >= 3` grant's points land here — the same "tier 3
   * lands in available at once" rule `contract_test.go` pins on the real
   * reward engine, reproduced here because F74/8.2.i's balance top-up
   * READS this back through `/v1/wallet/balance` to decide whether to grant
   * more; a fake that credited every tier equally would never exercise
   * that read/decide loop the way the real ledger does. */
  private readonly availableByUser = new Map<string, number>();
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

  /** Every request to this exact path, oldest first. */
  allRequestsTo(path: string): { path: string; signatureHeader: string; body: unknown }[] {
    return this.received.filter((entry) => entry.path === path);
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

    // F74/8.2.i (reopened) — the SAME per-region, purely-linear formula
    // (`points = ceil(settlementMinor / rate)`) backs BOTH pricing routes,
    // exactly like the real `priceAt` (`services/ledger/internal/pricing/
    // quotes.go`) is the ONE formula every listing price and quote uses —
    // so `deriveAffordableSettlementMinor`'s probe-then-solve is exercised
    // for real here, not against two fakes that quietly disagree. Chosen so
    // `AU_AFFORDABLE_QUOTE_TARGET_POINTS`/`ID_AFFORDABLE_QUOTE_TARGET_
    // POINTS` (`staging.ts`) divide evenly — deterministic points, no
    // rounding-driven retry, so these tests assert exact numbers.
    if (entry.path === "/v1/pricing/listing" || entry.path === "/v1/pricing/quote") {
      const body = entry.body as { region: "AU" | "ID"; settlementMinor: number };
      const rate = FAKE_RATE_MINOR_PER_POINT[body.region];
      const pricePoints = Math.ceil(body.settlementMinor / rate);
      return entry.path === "/v1/pricing/listing"
        ? [200, { pricePoints, backingRateId: "rate_test_1" }]
        : [
            200,
            {
              quoteId: randomUUID(),
              pricePoints,
              settlementMinor: body.settlementMinor,
              currency: body.region === "AU" ? "AUD" : "IDR",
              backingRateId: "rate_test_1",
              demandMultiplierBps: 10_000,
              expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
              locked: false,
            },
          ];
    }

    if (entry.path === "/v1/wallet/balance") {
      const body = entry.body as { userId: string };
      const availablePoints = this.availableByUser.get(body.userId) ?? 0;
      return [
        200,
        { userId: body.userId, availablePoints, pending: [], expiringPoints: 0, expiringAt: null },
      ];
    }

    const body = entry.body as {
      userId: string;
      kind: string;
      region: string;
      points: number;
      trustTier: number;
      idempotencyKey: string;
    };
    if (this.mode === "insufficient_topup" && body.trustTier >= 3) {
      // F12's own error code (`ErrUserCapReached`/`ErrEarnCapReached`, both
      // mapped to `velocity_capped` — `services/ledger/internal/api/
      // routes.go`), not `insufficient_available` — a DIFFERENT refusal than
      // `"insufficient"` mode's, and the one `ensureDemoRedemptionBalance`
      // treats as benign (`"capped_for_today"`), not a failure.
      return [
        409,
        {
          code: "velocity_capped",
          message: "reward: per-user daily cap reached: 500 of 500 for goodwill",
        },
      ];
    }
    // The real reward engine's replay rule looks up
    // `GetGrantByExternalRef(userId, actionType, externalRef)` —
    // `services/ledger/internal/reward/contract.go` — scoped by USER, not
    // by idempotencyKey alone: two different users can legitimately share
    // the same region-scoped topup key (F74/8.2.i's own "recovers a
    // missing demo account" test does exactly this, recreating
    // `viewer.id` under a brand-new user id that must start its topup
    // sequence fresh, not replay the deleted user's old grant). A
    // per-key-only map would misattribute the OLD user's grant to the
    // NEW one the moment they share a key.
    const grantKey = `${body.userId}::${body.idempotencyKey}`;
    const alreadyGranted = this.grantedAtByKey.has(grantKey);
    if (!alreadyGranted) {
      this.grantedAtByKey.set(grantKey, new Date().toISOString());
      if (body.trustTier >= 3) {
        this.availableByUser.set(
          body.userId,
          (this.availableByUser.get(body.userId) ?? 0) + body.points,
        );
      }
    }
    const grantedAt = this.grantedAtByKey.get(grantKey);
    return [
      200,
      {
        grantId: `grant_${body.idempotencyKey}`,
        kind: body.kind,
        userId: body.userId,
        region: body.region,
        points: body.points,
        unlockAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        grantedAt,
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

/** F74/8.2.i (reopened) — which real `store.merchant_location` row each
 * fixed demo listing's vouchers belong to (`voucher.vouchers.location_id`
 * FKs there); `insertListing` (`staging.ts`) creates all three for real, so
 * this fake only needs to pick the right existing one back. */
const LOCATION_ID_BY_LISTING: Record<string, string> = {
  [LISTING_ID]: LOCATION_ID,
  [AU_AFFORDABLE_LISTING_ID]: AU_AFFORDABLE_LOCATION_ID,
  [ID_LISTING_ID]: ID_LOCATION_ID,
};

/** A stand-in for the voucher service's `/internal/v1/batches` and
 * `/internal/v1/batches/approve` — the same two routes `ensureListingStock`
 * calls, for any of the THREE demo listings this file now exercises
 * (F74/8.2.i reopened added two). `"failing"` mode answers the real refusal
 * shape (`{code, message}`) a service error carries; `"ok"` mode plays
 * requester/approver back exactly like the real two-person check would
 * refuse a mismatch, and — because an "approved" response does not by
 * itself prove a voucher was minted — actually inserts real
 * `voucher.vouchers` rows on approve, matching whichever listing/merchant/
 * currency/face-value/quantity that SPECIFIC batch was requested with (a
 * `Map`, not one shared slot — the original single-listing fake echoed a
 * hardcoded listing back regardless of what was asked, which silently
 * passed until a second, different listing existed to expose it), so
 * `ensureListingStock`'s own database re-check has something real to find,
 * the same way a real mint would leave one. */
class FakeVoucherService {
  mode: "ok" | "failing" = "ok";
  received: { path: string; signatureHeader: string; body: unknown }[] = [];
  private readonly batches = new Map<
    string,
    {
      listingId: string;
      merchantId: string;
      currency: string;
      faceValueMinor: number;
      quantity: number;
      requestedBy: string;
    }
  >();
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
      const record = {
        listingId: String(body.listingId),
        merchantId: String(body.merchantId),
        currency: String(body.currency),
        faceValueMinor: Number(body.faceValueMinor),
        quantity: typeof body.quantity === "number" ? body.quantity : 1,
        requestedBy: String(body.requestedBy),
      };
      this.batches.set(batchId, record);
      return [
        200,
        {
          batchId,
          listingId: record.listingId,
          merchantId: record.merchantId,
          currency: record.currency,
          faceValueMinor: record.faceValueMinor,
          quantity: record.quantity,
          requestedBy: record.requestedBy,
          approvedBy: null,
          state: "pending",
        },
      ];
    }

    if (path === "/internal/v1/batches/approve") {
      const batchId = String(body.batchId);
      const record = this.batches.get(batchId);
      if (record === undefined) {
        return [
          404,
          { error: { type: "invalid_request_error", code: "not_found", message: batchId } },
        ];
      }
      for (let i = 0; i < record.quantity; i += 1) await this.mintVoucher(record);
      return [
        200,
        {
          batchId,
          listingId: record.listingId,
          merchantId: record.merchantId,
          currency: record.currency,
          faceValueMinor: record.faceValueMinor,
          quantity: record.quantity,
          requestedBy: record.requestedBy,
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
   * writes) — `batch_id` is nullable, and this seed never reads it back.
   * `region` is derived from `currency` (AUD -> AU, else ID) — the same
   * 1:1 mapping the real system enforces everywhere (AU and ID never
   * cross), not a value this fake is ever handed directly. */
  private async mintVoucher(record: {
    listingId: string;
    merchantId: string;
    currency: string;
    faceValueMinor: number;
  }): Promise<void> {
    const now = new Date();
    const region = record.currency === "AUD" ? "AU" : "ID";
    const locationId = LOCATION_ID_BY_LISTING[record.listingId];
    if (locationId === undefined) {
      throw new Error(`FakeVoucherService: no known location for listing ${record.listingId}`);
    }
    await this.pool.query(
      `INSERT INTO voucher.vouchers
         (id, listing_id, merchant_id, merchant_name, title, face_value_minor,
          remaining_value_minor, partial_redemption_policy, transferable, issued_at,
          expires_at, location_id, state, currency, region)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'minted',$13,$14)`,
      [
        randomUUID(),
        record.listingId,
        record.merchantId,
        "Snap App",
        "Snap App — Demo Voucher",
        record.faceValueMinor,
        record.faceValueMinor,
        "single_use_forfeit",
        false,
        now.toISOString(),
        new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        locationId,
        record.currency,
        region,
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
      expect(first.accounts).toBe(11);
      expect(["funded", "already_funded"]).toContain(first.marketingFunding);
      expect(first.pendingGrant).toBe("granted");
      expect(first.pendingGrantDetail).toBeUndefined();
      expect(first.demoVoucher).toBe("created");
      expect(first.demoVoucherDetail).toBe("had 0, minted 20 more");

      // The ledger calls really were the signed, shaped requests the real
      // service expects — the tier-0 grant (step 3) is found by its own
      // fixed idempotencyKey, not "the last grant call", because F74/8.2.i's
      // own balance top-up (step 5) also calls `/v1/actions/grants` many
      // more times, afterward, for both regions.
      const grantRequest = ledger.received.find(
        (entry) =>
          entry.path === "/v1/actions/grants" &&
          (entry.body as { idempotencyKey?: string }).idempotencyKey ===
            "staging-seed-tier0-viewer-pending-grant",
      );
      expect(grantRequest?.signatureHeader).toMatch(/^t=\d+,c=api,n=.+,v1=[0-9a-f]{64}$/);
      expect(grantRequest?.body).toMatchObject({
        kind: "goodwill",
        region: "AU",
        points: 500,
        trustTier: 0,
        idempotencyKey: "staging-seed-tier0-viewer-pending-grant",
      });

      // Step 5's own topup calls: exactly ONE per region (F74/8.2.i's real
      // design makes one attempt per run, never a tight loop — see
      // `ensureDemoRedemptionBalance`'s own header), each with a
      // region-scoped idempotencyKey and trustTier 3 (available at once,
      // unlike the tier-0 grant's trustTier 0). AU's target (300 — the
      // affordable listing's own 150-point live quote times
      // REDEMPTION_HEADROOM_VOUCHERS) is reachable in one 450-point chunk;
      // ID's (500) in one 1,000-point chunk.
      const auTopups = ledger
        .allRequestsTo("/v1/actions/grants")
        .filter((entry) =>
          ((entry.body as { idempotencyKey?: string }).idempotencyKey ?? "").startsWith(
            "staging-seed-viewer-AU-topup-",
          ),
        );
      const idTopups = ledger
        .allRequestsTo("/v1/actions/grants")
        .filter((entry) =>
          ((entry.body as { idempotencyKey?: string }).idempotencyKey ?? "").startsWith(
            "staging-seed-viewer-ID-topup-",
          ),
        );
      expect(auTopups).toHaveLength(1);
      expect(idTopups).toHaveLength(1);
      expect(auTopups[0]?.body).toMatchObject({
        kind: "goodwill",
        region: "AU",
        points: 450,
        trustTier: 3,
        idempotencyKey: "staging-seed-viewer-AU-topup-1",
      });
      expect(idTopups[0]?.body).toMatchObject({
        kind: "goodwill",
        region: "ID",
        points: 1_000,
        trustTier: 3,
        idempotencyKey: "staging-seed-viewer-ID-topup-1",
      });

      // F74/8.2.i (reopened): the two affordable listings this run derived
      // a LOW price for, live, and stocked to 20 — AU's second listing and
      // ID's first.
      expect(first.affordableListings).toStrictEqual([
        {
          region: "AU",
          listingId: AU_AFFORDABLE_LISTING_ID,
          locationId: AU_AFFORDABLE_LOCATION_ID,
          status: "created",
          detail: "had 0, minted 20 more",
        },
        {
          region: "ID",
          listingId: ID_LISTING_ID,
          locationId: ID_LOCATION_ID,
          status: "created",
          detail: "had 0, minted 20 more",
        },
      ]);

      // The redemption balance result itself: both regions topped up past
      // their own affordable listing's live quote times headroom.
      expect(first.redemptionBalance).toStrictEqual([
        { region: "AU", status: "topped_up", availablePoints: 450, targetPoints: 300 },
        { region: "ID", status: "topped_up", availablePoints: 1_000, targetPoints: 500 },
      ]);

      // The original 2.3.c listing's own pricing call is found by its own
      // listing id, not "the last one" — F74/8.2.i's own two new listings
      // make several more `/v1/pricing/listing`/`/v1/pricing/quote` calls
      // afterward, for different listings entirely.
      const pricingRequest = ledger.received.find(
        (entry) =>
          entry.path === "/v1/pricing/listing" &&
          (entry.body as { listingId?: string }).listingId === LISTING_ID,
      );
      expect(pricingRequest?.signatureHeader).toMatch(/^t=\d+,c=api,n=.+,v1=[0-9a-f]{64}$/);
      expect(pricingRequest?.body).toMatchObject({
        listingId: LISTING_ID,
        region: "AU",
        currency: "AUD",
        settlementMinor: 3_000,
      });

      // Same for the voucher service: SIX signed calls now (request then
      // approve, times three listings — the original plus F74/8.2.i's two
      // new ones), in the order `seedStaging` creates them: the original
      // 2.3.c listing first, then AU's affordable one, then ID's.
      expect(voucherService.received).toHaveLength(6);
      const [requested, approved, auRequested, auApproved, idRequested, idApproved] =
        voucherService.received;
      expect(requested?.path).toBe("/internal/v1/batches");
      expect(requested?.signatureHeader).toMatch(/^t=\d+,c=api,n=.+,v1=[0-9a-f]{64}$/);
      expect(requested?.body).toMatchObject({
        listingId: LISTING_ID,
        merchantId: BUSINESS_IDS[0],
        currency: "AUD",
        faceValueMinor: 4_500,
        quantity: 20,
        requestedBy: "staging-seed-requester",
      });
      expect(approved?.path).toBe("/internal/v1/batches/approve");
      expect(approved?.body).toMatchObject({ approvedBy: "staging-seed-approver" });
      const requestedBody = requested?.body as { requestedBy: string };
      const approvedBody = approved?.body as { approvedBy: string };
      expect(approvedBody.approvedBy).not.toBe(requestedBody.requestedBy);

      expect(auRequested?.body).toMatchObject({
        listingId: AU_AFFORDABLE_LISTING_ID,
        merchantId: BUSINESS_IDS[0],
        currency: "AUD",
        // 150 target points * FAKE_RATE_MINOR_PER_POINT.AU (1,000).
        faceValueMinor: 150_000,
        quantity: 20,
      });
      expect(auApproved?.body).toMatchObject({ approvedBy: "staging-seed-approver" });
      expect(idRequested?.body).toMatchObject({
        listingId: ID_LISTING_ID,
        merchantId: BUSINESS_IDS[1],
        currency: "IDR",
        // 250 target points * FAKE_RATE_MINOR_PER_POINT.ID (5,000).
        faceValueMinor: 1_250_000,
        quantity: 20,
      });
      expect(idApproved?.body).toMatchObject({ approvedBy: "staging-seed-approver" });

      // 20 real, minted vouchers per listing — enough stock that a
      // repeated staging Check doesn't run any of them dry.
      for (const [listingId, currency, region] of [
        [LISTING_ID, "AUD", "AU"],
        [AU_AFFORDABLE_LISTING_ID, "AUD", "AU"],
        [ID_LISTING_ID, "IDR", "ID"],
      ] as const) {
        const mintedVouchers = await owner.query<{
          state: string;
          currency: string;
          region: string;
        }>(`SELECT state, currency, region FROM voucher.vouchers WHERE listing_id = $1`, [
          listingId,
        ]);
        expect(mintedVouchers.rows).toHaveLength(20);
        for (const row of mintedVouchers.rows) {
          expect(row).toStrictEqual({ state: "minted", currency, region });
        }
      }

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
        redemptionBalance: [
          {
            region: "AU",
            status: "already_sufficient",
            availablePoints: 450,
            targetPoints: 300,
          },
          {
            region: "ID",
            status: "already_sufficient",
            availablePoints: 1_000,
            targetPoints: 500,
          },
        ],
        affordableListings: [
          {
            region: "AU",
            listingId: AU_AFFORDABLE_LISTING_ID,
            locationId: AU_AFFORDABLE_LOCATION_ID,
            status: "already_present",
          },
          {
            region: "ID",
            listingId: ID_LISTING_ID,
            locationId: ID_LOCATION_ID,
            status: "already_present",
          },
        ],
      });
      // Still exactly 20 vouchers per listing — the replay minted nothing
      // new (task 5's own requirement: a second run leaves the same
      // balances and stock) and re-priced no listing.
      for (const listingId of [LISTING_ID, AU_AFFORDABLE_LISTING_ID, ID_LISTING_ID]) {
        const vouchers = await owner.query(`SELECT 1 FROM voucher.vouchers WHERE listing_id = $1`, [
          listingId,
        ]);
        expect(vouchers.rowCount).toBe(20);
      }
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
      expect(first.accounts).toBe(11);
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
      expect(second.demoVoucherDetail).toBe("had 0, minted 20 more");
      const vouchers = await owner.query(`SELECT 1 FROM voucher.vouchers WHERE listing_id = $1`, [
        LISTING_ID,
      ]);
      expect(vouchers.rowCount).toBe(20);
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
    expect(result.accounts).toBe(11);
    expect(["funded", "already_funded"]).toContain(result.marketingFunding);
    expect(result.pendingGrant).toBe("failed");
    expect(result.pendingGrantDetail).toBeDefined();
    expect(result.demoVoucher).toBe("failed");
    expect(result.demoVoucherDetail).toBeDefined();
    // F74/8.2.i (reopened): the affordable listings can't even be CREATED
    // (the pricing probe is unreachable too), so they fail as well — never
    // silently skipped.
    expect(result.affordableListings).toHaveLength(2);
    for (const listing of result.affordableListings) {
      expect(listing.status).toBe("failed");
      expect(listing.detail).toBeDefined();
    }
    // The AU/ID quotes are unreachable, so the top-up never had a target
    // to work toward — reported as failed, not silently skipped.
    expect(result.redemptionBalance).toHaveLength(2);
    for (const balance of result.redemptionBalance) {
      expect(balance.status).toBe("failed");
      expect(balance.detail).toBeDefined();
    }
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

  it("tops up the redemption balance further on a later run, once F12's own daily earn cap capped a previous one", async () => {
    const ledger = new FakeLedger();
    const baseUrl = await ledger.listen();
    try {
      // The exact incident this guards against, discovered running this
      // seed against a REAL ledger (F74/8.2.i's own verification, not the
      // fake): F12's daily earn cap refuses a top-up chunk — expected, not a
      // failure, and this must say so per region (`"capped_for_today"`),
      // not silently retry forever within one run or fail the deploy.
      ledger.mode = "insufficient_topup";
      const first = await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        voucher: { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
        log: () => undefined,
        replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
      });
      expect(first.world).toBe("seeded");
      expect(first.pendingGrant).toBe("granted");
      // "insufficient_topup" only refuses a trustTier-3 GRANT — pricing and
      // the voucher service stay healthy, so both affordable listings still
      // get created and stocked normally on this very first run.
      expect(first.affordableListings.map((l) => l.status)).toStrictEqual(["created", "created"]);
      expect(first.redemptionBalance).toStrictEqual([
        {
          region: "AU",
          status: "capped_for_today",
          detail: "velocity_capped",
          availablePoints: 0,
          targetPoints: 300,
        },
        {
          region: "ID",
          status: "capped_for_today",
          detail: "velocity_capped",
          availablePoints: 0,
          targetPoints: 500,
        },
      ]);

      // The next deploy (a later real day, in production): a fresh daily
      // allowance. The world, the tier-0 grant and the voucher stock are
      // already there — only the still-short balance makes progress, and
      // the SAME derived idempotencyKey (`...-topup-1`) is retried, not a
      // new one, because the capped attempt above was never stored.
      ledger.mode = "ok";
      const second = await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        voucher: { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
        log: () => undefined,
        replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
      });
      expect(second.world).toBe("already_present");
      expect(second.redemptionBalance).toStrictEqual([
        { region: "AU", status: "topped_up", availablePoints: 450, targetPoints: 300 },
        { region: "ID", status: "topped_up", availablePoints: 1_000, targetPoints: 500 },
      ]);
      const retriedTopup = ledger.received.find(
        (entry) =>
          entry.path === "/v1/actions/grants" &&
          (entry.body as { idempotencyKey?: string }).idempotencyKey ===
            "staging-seed-viewer-AU-topup-1",
      );
      expect(retriedTopup).toBeDefined();

      // A third run finds the target already met and grants nothing further.
      const third = await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        voucher: { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
        log: () => undefined,
        replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
      });
      expect(third.redemptionBalance).toStrictEqual([
        { region: "AU", status: "already_sufficient", availablePoints: 450, targetPoints: 300 },
        { region: "ID", status: "already_sufficient", availablePoints: 1_000, targetPoints: 500 },
      ]);
    } finally {
      await ledger.close();
    }
  });

  it("recovers a demo account that is missing from an already-seeded world (F74/8.2.i's real staging incident)", async () => {
    const ledger = new FakeLedger();
    const baseUrl = await ledger.listen();
    try {
      // Simulates the OLD seed's world exactly, not a hand-written
      // approximation of it: run the CURRENT seed once (every account,
      // business and campaign real staging already had), then surgically
      // remove `viewer.id` — the account `demoAccounts()` did not have YET
      // when staging's own `identity.user_profile` was first populated,
      // weeks before `viewer.id` was ever added to the code. That is
      // exactly what "the world already exists" meant on real staging: not
      // an empty table, but one this seed itself had already written to,
      // missing one row it did not know to check for individually.
      const first = await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        voucher: { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
        log: () => undefined,
        replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
      });
      expect(first.world).toBe("seeded");

      const before = await owner.query<{ user_id: string }>(
        `SELECT user_id FROM identity.credential WHERE identifier = 'viewer.id@demo.yourtal.test'`,
      );
      const oldUserId = before.rows[0]?.user_id;
      expect(oldUserId).toBeDefined();
      await owner.query(`DELETE FROM identity.user_profile WHERE user_id = $1`, [oldUserId]);
      await owner.query(`DELETE FROM identity.credential WHERE user_id = $1`, [oldUserId]);
      const gone = await owner.query(
        `SELECT 1 FROM identity.credential WHERE identifier = 'viewer.id@demo.yourtal.test'`,
      );
      expect(gone.rowCount).toBe(0);

      // The next deploy: `identity.user_profile` is still non-empty (every
      // OTHER account is there), so the world step used to stop right
      // there. Now it checks each account by email instead, finds
      // viewer.id missing, and creates ONLY that one row — never resetting
      // anything that already existed.
      await sleep(TEST_REPLAY_WINDOW_MS + 20);
      const second = await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        voucher: { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
        log: () => undefined,
        replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
      });
      expect(second.world).toBe("already_present");

      const recreated = await owner.query<{ user_id: string; secret_hash: string }>(
        `SELECT user_id, secret_hash FROM identity.credential
          WHERE identifier = 'viewer.id@demo.yourtal.test'`,
      );
      expect(recreated.rows).toHaveLength(1);
      const newUserId = recreated.rows[0]?.user_id;
      expect(newUserId).toBeDefined();
      expect(newUserId).not.toBe(oldUserId);
      // Exists AND can log in — a real, freshly-hashed password, not a row
      // with no usable credential.
      await expect(verifyPassword(recreated.rows[0]!.secret_hash, DEMO_PASSWORD)).resolves.toBe(
        true,
      );
      // Nothing else in the world was touched a second time — still
      // exactly the two Snap App businesses this seed's own world creates.
      expect(
        (
          await owner.query(
            `SELECT count(*)::int AS n FROM business.business_accounts WHERE id = ANY($1)`,
            [BUSINESS_IDS],
          )
        ).rows[0]?.n,
      ).toBe(2);

      // Holds its balance on the SAME deploy — the existing wiring already
      // does this once `viewerIdUserId` is non-null, regardless of
      // `world.status`, so fixing account recovery alone is enough.
      const idBalance = second.redemptionBalance.find((b) => b.region === "ID");
      expect(idBalance?.status).toBe("topped_up");
      expect(idBalance?.availablePoints).toBe(1_000);

      // Running it again changes nothing further: the same account, the
      // same balance, no new grant.
      const third = await seedStaging(owner, {
        demoPassword: DEMO_PASSWORD,
        ledger: { baseUrl, serviceSecret: LEDGER_SECRET },
        voucher: { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
        log: () => undefined,
        replayDetectionWindowMs: TEST_REPLAY_WINDOW_MS,
      });
      const stillThere = await owner.query<{ user_id: string }>(
        `SELECT user_id FROM identity.credential WHERE identifier = 'viewer.id@demo.yourtal.test'`,
      );
      expect(stillThere.rows[0]?.user_id).toBe(newUserId);
      expect(third.redemptionBalance.find((b) => b.region === "ID")?.status).toBe(
        "already_sufficient",
      );
    } finally {
      await ledger.close();
    }
  });
});
