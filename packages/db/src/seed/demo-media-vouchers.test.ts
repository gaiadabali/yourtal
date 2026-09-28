import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listDemoMediaBusinesses, runDemoMedia } from "@yourtal/media/demo-media";
import type { Manifest } from "@yourtal/media/demo-media";
import { OWNER_URL } from "../database-urls";
import { runDemoMediaVouchers } from "./demo-media-vouchers";

/**
 * TASKS.md 7.2.e — the same real-ffmpeg-fixture technique
 * `packages/media/src/demo-media.test.ts` uses (its own header explains why:
 * no external network dependency, no minutes-long real ffmpeg pass against
 * the committed manifest's real clips), extended one step further: once the
 * fixture businesses are real rows, this proves each gets a real listing
 * priced by a fake ledger and 6 real vouchers minted through a fake voucher
 * service — the same two-call (request, then approve) shape `staging.test.ts`
 * already proves for the single 2.3.c demo voucher, generalized to N
 * businesses and a caller-supplied `quantity` rather than always 1.
 */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
if (DATABASE_URL === undefined) throw new Error("DATABASE_URL/TEST_DATABASE_URL must be set");

const LEDGER_SECRET = "test-only-ledger-service-secret-32-bytes!";
const VOUCHER_SECRET = "test-only-voucher-service-secret-32-bytes!";

let workDir: string;
let clipServer: Server;
let clipBaseUrl: string;
const pool = new pg.Pool({ connectionString: DATABASE_URL });
const ownerPool = new pg.Pool({ connectionString: OWNER_URL });

/** Answers `/v1/pricing/listing` with a fixed points price, regardless of
 * which of the N listings asks — the real formula is the real ledger's to
 * reproduce, not this fake's; `priceListing` only reads `pricePoints`. */
class FakeLedger {
  received: { path: string; body: unknown }[] = [];
  server: Server = createServer((req, res) => {
    void this.answer(req).then(([status, body]) => {
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  });

  private async answer(req: IncomingMessage): Promise<[number, unknown]> {
    let raw = "";
    for await (const chunk of req) raw += String(chunk);
    const body = JSON.parse(raw) as unknown;
    this.received.push({ path: req.url ?? "", body });
    return [200, { pricePoints: 1_000, backingRateId: "rate_test_1" }];
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${String((this.server.address() as AddressInfo).port)}`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

/** Answers the voucher service's real two routes for N businesses at once —
 * tracks each batch's own `listingId`/`merchantId`/`quantity` so `approve`
 * mints the RIGHT number of rows for the RIGHT listing, the same real-mint
 * proof `staging.test.ts`'s own fake makes (an "approved" response alone
 * does not prove anything minted — see `ensureDemoVoucher`'s own header). */
class FakeVoucherService {
  mode: "ok" | "failing" = "ok";
  received: { path: string; body: unknown }[] = [];
  private readonly batches = new Map<
    string,
    {
      listingId: string;
      merchantId: string;
      currency: string;
      faceValueMinor: number;
      quantity: number;
    }
  >();
  server: Server = createServer((req, res) => {
    this.answer(req)
      .then(([status, body]) => {
        res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      })
      .catch((error: unknown) => {
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
    this.received.push({ path, body });

    if (this.mode === "failing") {
      return [409, { code: "allocation_exhausted", message: "voucher: no stock for this batch" }];
    }

    if (path === "/internal/v1/batches") {
      const batchId = crypto.randomUUID();
      this.batches.set(batchId, {
        listingId: String(body.listingId),
        merchantId: String(body.merchantId),
        currency: String(body.currency),
        faceValueMinor: Number(body.faceValueMinor),
        quantity: Number(body.quantity),
      });
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
      const batch = this.batches.get(String(body.batchId));
      if (batch === undefined) {
        return [404, { code: "not_found", message: "no such batch" }];
      }
      await this.mintVouchers(batch);
      return [
        200,
        {
          batchId: body.batchId,
          listingId: batch.listingId,
          merchantId: batch.merchantId,
          currency: batch.currency,
          faceValueMinor: batch.faceValueMinor,
          quantity: batch.quantity,
          requestedBy: "requester",
          approvedBy: body.approvedBy,
          state: "approved",
        },
      ];
    }

    return [404, { error: { type: "invalid_request_error", code: "not_found", message: path } }];
  }

  private async mintVouchers(batch: {
    listingId: string;
    merchantId: string;
    currency: string;
    faceValueMinor: number;
    quantity: number;
  }): Promise<void> {
    const now = new Date();
    const location = await this.pool.query<{ location_id: string }>(
      "SELECT location_id FROM store.listing_location WHERE listing_id = $1 LIMIT 1",
      [batch.listingId],
    );
    const locationId = location.rows[0]?.location_id;
    if (locationId === undefined) throw new Error(`no location for listing ${batch.listingId}`);

    for (let i = 0; i < batch.quantity; i++) {
      await this.pool.query(
        `INSERT INTO voucher.vouchers
           (id, listing_id, merchant_id, merchant_name, title, face_value_minor,
            remaining_value_minor, partial_redemption_policy, transferable, issued_at,
            expires_at, location_id, state, currency, region)
         VALUES ($1,$2,$3,'Test Merchant','Test Voucher',$4,$4,'single_use_forfeit',
                 false,$5,$6,$7,'minted',$8,$9)`,
        [
          crypto.randomUUID(),
          batch.listingId,
          batch.merchantId,
          batch.faceValueMinor,
          now.toISOString(),
          new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          locationId,
          batch.currency,
          batch.currency === "AUD" ? "AU" : "ID",
        ],
      );
    }
  }

  async listen(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${String((this.server.address() as AddressInfo).port)}`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

function fixtureManifest(slugAu: string, slugId: string): Manifest {
  return {
    musicBed: {
      url: `${clipBaseUrl}/music.ogg`,
      licence: "test-fixture",
      attribution: "test-fixture",
      sourcePage: clipBaseUrl,
    },
    clips: {
      test: {
        url: `${clipBaseUrl}/clip.mp4`,
        licence: "test-fixture",
        attribution: "test-fixture",
        sourcePage: clipBaseUrl,
      },
    },
    campaigns: [
      {
        slug: slugAu,
        region: "AU",
        brand: "Demo Voucher Test AU Co.",
        clip: "test",
        teaserStartSeconds: 1,
        facts: [{ at: 0.5, text: "Fact one" }],
      },
      {
        slug: slugId,
        region: "ID",
        brand: "Demo Voucher Test ID Co.",
        clip: "test",
        teaserStartSeconds: 1,
        facts: [{ at: 0.5, text: "Fact one" }],
      },
    ],
  };
}

beforeAll(async () => {
  workDir = mkdtempSync(path.join(tmpdir(), "yt-demo-media-voucher-fixture-"));
  const clipPath = path.join(workDir, "clip.mp4");
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x360:rate=30:duration=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    clipPath,
  ]);
  const musicPath = path.join(workDir, "music.ogg");
  execFileSync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=44100:duration=2",
    "-c:a",
    "libvorbis",
    musicPath,
  ]);
  clipServer = createServer((req, res) => {
    const file = req.url === "/clip.mp4" ? clipPath : req.url === "/music.ogg" ? musicPath : null;
    if (file === null) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200).end(readFileSync(file));
  });
  await new Promise<void>((resolve) => clipServer.listen(0, "127.0.0.1", resolve));
  clipBaseUrl = `http://127.0.0.1:${String((clipServer.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => clipServer.close(resolve));
  rmSync(workDir, { recursive: true, force: true });
  await pool.end();
  await ownerPool.end();
});

describe("runDemoMediaVouchers", () => {
  it("prices and mints 6 real vouchers per business, region/currency held, idempotent on rerun", async () => {
    const stamp = Date.now();
    const slugAu = `demo-voucher-test-au-${stamp}`;
    const slugId = `demo-voucher-test-id-${stamp}`;
    const manifest = fixtureManifest(slugAu, slugId);

    const mediaResults = await runDemoMedia({ databaseUrl: DATABASE_URL ?? "", manifest });
    expect(mediaResults).toEqual([
      { slug: slugAu, status: "seeded" },
      { slug: slugId, status: "seeded" },
    ]);

    const businesses = listDemoMediaBusinesses(manifest);
    expect(businesses).toHaveLength(2);

    const ledger = new FakeLedger();
    const ledgerBaseUrl = await ledger.listen();
    const voucher = new FakeVoucherService(ownerPool);
    const voucherBaseUrl = await voucher.listen();

    try {
      const first = await runDemoMediaVouchers(
        pool,
        businesses,
        { baseUrl: ledgerBaseUrl, serviceSecret: LEDGER_SECRET },
        { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
        () => undefined,
      );
      expect(first).toEqual([
        { slug: slugAu, status: "seeded" },
        { slug: slugId, status: "seeded" },
      ]);

      const listings = await pool.query<{
        merchant_id: string;
        region: string;
        currency: string;
        face_value_minor: string;
      }>(
        `SELECT merchant_id, region, currency, face_value_minor FROM store.listings
           WHERE merchant_id = ANY($1) ORDER BY region`,
        [businesses.map((b) => b.businessId)],
      );
      expect(listings.rows).toHaveLength(2);
      expect(listings.rows[0]).toMatchObject({ region: "AU", currency: "AUD" });
      expect(listings.rows[1]).toMatchObject({ region: "ID", currency: "IDR" });

      for (const business of businesses) {
        const listingId = listings.rows.find((r) => r.merchant_id === business.businessId);
        expect(listingId).toBeDefined();
      }

      const voucherCounts = await pool.query<{ merchant_id: string; count: string }>(
        `SELECT merchant_id, count(*)::text AS count FROM voucher.vouchers
           WHERE merchant_id = ANY($1) GROUP BY merchant_id`,
        [businesses.map((b) => b.businessId)],
      );
      expect(voucherCounts.rows).toHaveLength(2);
      for (const row of voucherCounts.rows) expect(row.count).toBe("6");

      // Region/currency wall: no AU business's voucher rows carry IDR or vice versa.
      const crossRegion = await pool.query(
        `SELECT 1 FROM voucher.vouchers v
           JOIN business.business_accounts b ON b.id = v.merchant_id
          WHERE b.id = ANY($1) AND v.region <> b.region`,
        [businesses.map((b) => b.businessId)],
      );
      expect(crossRegion.rowCount).toBe(0);

      // Idempotent rerun: nothing new priced or minted.
      const requestCountBefore = voucher.received.filter(
        (r) => r.path === "/internal/v1/batches",
      ).length;
      const second = await runDemoMediaVouchers(
        pool,
        businesses,
        { baseUrl: ledgerBaseUrl, serviceSecret: LEDGER_SECRET },
        { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
        () => undefined,
      );
      expect(second).toEqual([
        { slug: slugAu, status: "already_present" },
        { slug: slugId, status: "already_present" },
      ]);
      const requestCountAfter = voucher.received.filter(
        (r) => r.path === "/internal/v1/batches",
      ).length;
      expect(requestCountAfter).toBe(requestCountBefore);
      const voucherCountsAfter = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM voucher.vouchers WHERE merchant_id = ANY($1)`,
        [businesses.map((b) => b.businessId)],
      );
      expect(voucherCountsAfter.rows[0]?.count).toBe("12");
    } finally {
      await ledger.close();
      await voucher.close();
    }
  }, 60_000);

  it("reports a per-business failure loudly without stopping the others", async () => {
    const stamp = Date.now();
    const slugAu = `demo-voucher-test-fail-au-${stamp}`;
    const slugId = `demo-voucher-test-fail-id-${stamp}`;
    const manifest = fixtureManifest(slugAu, slugId);
    await runDemoMedia({ databaseUrl: DATABASE_URL ?? "", manifest });
    const businesses = listDemoMediaBusinesses(manifest);

    const ledger = new FakeLedger();
    const ledgerBaseUrl = await ledger.listen();
    const voucher = new FakeVoucherService(ownerPool);
    voucher.mode = "failing";
    const voucherBaseUrl = await voucher.listen();

    try {
      const results = await runDemoMediaVouchers(
        pool,
        businesses,
        { baseUrl: ledgerBaseUrl, serviceSecret: LEDGER_SECRET },
        { baseUrl: voucherBaseUrl, serviceSecret: VOUCHER_SECRET },
        () => undefined,
      );
      expect(results).toEqual([
        { slug: slugAu, status: "failed", detail: expect.stringContaining("allocation_exhausted") },
        { slug: slugId, status: "failed", detail: expect.stringContaining("allocation_exhausted") },
      ]);
      // The listing itself was still created — only the mint failed, same
      // convention `ensureDemoVoucher`'s own test proves.
      const listings = await pool.query(
        `SELECT 1 FROM store.listings WHERE merchant_id = ANY($1)`,
        [businesses.map((b) => b.businessId)],
      );
      expect(listings.rowCount).toBe(2);
    } finally {
      await ledger.close();
      await voucher.close();
    }
  }, 60_000);
});
