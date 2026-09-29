import { randomUUID } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, openSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toMinorUnits } from "@yourtal/contracts/money";
import type {
  GenerateStatementRequest,
  Statement,
} from "@yourtal/contracts/ledger-internal/economy";
import {
  SERVICE_SIGNATURE_HEADER,
  signServiceRequest,
} from "@yourtal/contracts/ledger-internal/service-signature";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import { sessionFor } from "../../../shared/testing/session-for";
import { HttpLedgerClient } from "../../../shared/ledger-client/http-ledger-client";
import { grantStaffRole, ownerPool } from "../staff.test-helper";

/**
 * TASKS.md 10.6.c's full Check, against the REAL ledger (not the fake): an
 * approved statement produces exactly one simulated payout after the
 * dispute window, with the reserve AND the merchant's payable both down by
 * exactly S (`services/ledger/internal/ledger/chart.go`'s own `Payout`: Dr
 * merchant_payable / Cr reserve) -- and a disputed statement moves neither
 * until resolved. `staff-settlement.e2e.test.ts` proves the same shape
 * against `LEDGER_MODE=fake` for speed; this file is the live-engine half,
 * the same relationship `staff-voucher-batch-review.live.test.ts` has to
 * its own `.e2e.test.ts` sibling (9.2.c) -- read that file's header first,
 * this one follows its exact recipe (build+boot the real Go binary, flip
 * `LEDGER_MODE=live` for this process before `AppModule` reads it).
 *
 * Two things a live boot alone cannot give a test: waiting a real 7 days
 * for F12's dispute window, and moving Go's own `time.Now()`. Both are
 * solved the only way available to an external, black-box test: the
 * statement's `dispute_window_ends_at` is backdated with a direct SQL
 * UPDATE through the OWNER connection (never through the app role, which
 * has no UPDATE on `ledger.statement` at all -- this is a test fixture
 * move, not something any real caller can do). Everything else --
 * capturing, generating the statement, proposing, approving, reading
 * balances -- goes through the real HTTP surfaces (the ledger's own signed
 * routes, or this staff console's own `app.inject`).
 *
 * Gated behind `SETTLEMENT_LIVE=1`, run alone, from apps/api:
 *
 *   set -a && . ./.env && set +a
 *   SETTLEMENT_LIVE=1 pnpm exec node ../../packages/db/scripts/with-test-db.mjs -- \
 *     vitest run src/modules/staff/settlement/staff-settlement.live.test.ts
 */
const live = process.env["SETTLEMENT_LIVE"] === "1";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../..");

let app: NestFastifyApplication;
let ledger: ChildProcess | undefined;
let scratch: string;
let liveUrl: string;
let ledgerSecret: string;
let client: HttpLedgerClient;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  if (!live) return;
  if (!/yourtal_test_/.test(process.env["DATABASE_URL"] ?? "")) {
    throw new Error(
      "staff-settlement.live.test.ts: run me through packages/db/scripts/with-test-db.mjs",
    );
  }

  scratch = mkdtempSync(path.join(tmpdir(), "settlement-live-"));
  const exe = path.join(scratch, process.platform === "win32" ? "ledger.exe" : "ledger");
  const build = spawnSync("go", ["build", "-o", exe, "./cmd/ledger"], {
    cwd: path.join(repoRoot, "services/ledger"),
    stdio: "inherit",
  });
  if (build.status !== 0) throw new Error("go build ./cmd/ledger failed");

  const port = await freePort();
  liveUrl = `http://127.0.0.1:${String(port)}`;
  ledgerSecret = "local-only-ledger-service-secret-not-real";
  ledger = spawn(exe, [], {
    env: {
      ...process.env,
      LEDGER_ADDR: `127.0.0.1:${String(port)}`,
      LEDGER_SERVICE_SECRET: ledgerSecret,
      REWARD_ATTESTATION_SECRET: "local-only-reward-attestation-secret-not-real",
    },
    stdio: ["ignore", openSync(path.join(scratch, "ledger.log"), "w"), "inherit"],
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    const ready = await fetch(`${liveUrl}/readyz`).then(
      (r) => r.ok,
      () => false,
    );
    if (ready) break;
    if (attempt === 99) throw new Error(`ledger never became ready -- see ${scratch}/ledger.log`);
    await new Promise((r) => setTimeout(r, 100));
  }

  client = new HttpLedgerClient(liveUrl, ledgerSecret, db);

  // Flip THIS process to live mode before AppModule reads it via
  // loadAppConfig() -- see createLedgerClient.ts. The staff-settlement
  // controller's own routes then talk to the SAME real ledger `client`
  // constructs above.
  process.env["LEDGER_MODE"] = "live";
  process.env["LEDGER_BASE_URL"] = liveUrl;
  process.env["LEDGER_SERVICE_SECRET"] = ledgerSecret;

  const { AppModule } = await import("../../../app.module");
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);

afterAll(async () => {
  if (!live) return;
  await app.close();
  ledger?.kill("SIGKILL");
});

/** `/v1/economy/statements/generate`: worker-only, not on `LedgerInternalClient` (10.1.b's own contract note) -- signed the same way apps/worker's real caller does. */
async function generateStatement(request: GenerateStatementRequest): Promise<Statement> {
  const reqPath = "/v1/economy/statements/generate";
  const body = JSON.stringify(request);
  const response = await fetch(`${liveUrl}${reqPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [SERVICE_SIGNATURE_HEADER]: signServiceRequest({
        secret: ledgerSecret,
        caller: "worker",
        method: "POST",
        pathAndQuery: reqPath,
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

/**
 * `ledger.account.kind`-aware natural balance -- the exact projection
 * `GetAccountBalance` (services/ledger/db/query/ledger.sql) computes. Read
 * through the OWNER connection, not the app role's `db`: `yourtal_app` has
 * no grant on the `ledger` schema at all (only the Go service's own
 * `yourtal_ledger` role does) -- apps/api always reaches the ledger through
 * its HTTP API, never its tables, and this raw read is a test-only
 * exception to that, the same one `backdateDisputeWindow` below already is.
 */
async function balanceOf(accountId: string): Promise<number> {
  const owner = ownerPool();
  try {
    const result = await owner.query<{ balance_minor: string | null }>(
      `SELECT (CASE WHEN a.kind IN ('asset', 'expense') THEN -1 ELSE 1 END
               * COALESCE(SUM(e.amount_minor), 0))::bigint AS balance_minor
         FROM ledger.account a
         LEFT JOIN ledger.entry e ON e.account_id = a.id AND e.currency = a.currency
        WHERE a.id = $1
        GROUP BY a.kind`,
      [accountId],
    );
    const row = result.rows[0];
    return row?.balance_minor === null || row?.balance_minor === undefined
      ? 0
      : Number(row.balance_minor);
  } finally {
    await owner.end();
  }
}

/** Bypasses Go's own clock: only the OWNER connection can do this (`yourtal_app` has no UPDATE on `ledger.statement`), and only a test fixture should. */
async function backdateDisputeWindow(statementId: string): Promise<void> {
  const owner = ownerPool();
  try {
    await owner.query(
      `UPDATE ledger.statement SET dispute_window_ends_at = now() - interval '1 day' WHERE id = $1`,
      [statementId],
    );
  } finally {
    await owner.end();
  }
}

describe.skipIf(!live)("10.6.c against the real ledger: reserve and payable both drop by S", () => {
  it("an approved statement pays out exactly once, moving reserve and merchant payable by exactly S", async () => {
    const merchantId = randomUUID();
    const captureId = randomUUID();
    const amountMinor = 4_200;
    (
      await client.captureVoucher({
        captureId,
        region: "AU",
        merchantId,
        amountMinor: toMinorUnits(amountMinor),
        currency: "AUD",
      })
    )._unsafeUnwrap();

    const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const stmt = await generateStatement({ businessId: merchantId, region: "AU", from, to });
    expect(stmt).toMatchObject({ closingPayableMinor: amountMinor, status: "open" });

    await backdateDisputeWindow(stmt.id);

    const reserveId = "plat_AU_reserve";
    const payableId = `mer_${merchantId}_payable_AUD`;
    const reserveBefore = await balanceOf(reserveId);
    const payableBefore = await balanceOf(payableId);
    expect(payableBefore).toBe(amountMinor);

    const proposer = await sessionFor(app, { jurisdiction: "AU" });
    const approver = await sessionFor(app, { jurisdiction: "AU" });
    await grantStaffRole(ownerPool(), proposer.userId, "finance");
    await grantStaffRole(ownerPool(), approver.userId, "finance");

    const proposed = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/AU/statements/${stmt.id}/payout-proposals`,
      headers: { cookie: proposer.cookie, "idempotency-key": randomUUID() },
      payload: {},
    });
    expect(proposed.statusCode, proposed.body).toBe(201);
    const proposal = proposed.json<{ id: string }>();

    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/AU/payout-proposals/${proposal.id}/approve`,
      headers: { cookie: approver.cookie, "idempotency-key": randomUUID() },
      payload: {},
    });
    expect(approved.statusCode, approved.body).toBe(201);

    // THE invariant: both accounts move by exactly S, in the direction
    // `Payout` posts (Dr merchant_payable / Cr reserve -- both balances fall).
    expect(await balanceOf(reserveId)).toBe(reserveBefore - amountMinor);
    expect(await balanceOf(payableId)).toBe(payableBefore - amountMinor);

    // Exactly once: a second approval attempt on the same (now-decided)
    // proposal is refused outright, and the balances do not move again.
    const replay = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/AU/payout-proposals/${proposal.id}/approve`,
      headers: { cookie: approver.cookie, "idempotency-key": randomUUID() },
      payload: {},
    });
    expect(replay.statusCode).toBe(400);
    expect(await balanceOf(reserveId)).toBe(reserveBefore - amountMinor);
    expect(await balanceOf(payableId)).toBe(payableBefore - amountMinor);
  });

  it("a disputed statement moves neither balance until resolved", async () => {
    const merchantId = randomUUID();
    const captureId = randomUUID();
    const amountMinor = 1_500;
    (
      await client.captureVoucher({
        captureId,
        region: "AU",
        merchantId,
        amountMinor: toMinorUnits(amountMinor),
        currency: "AUD",
      })
    )._unsafeUnwrap();

    const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const stmt = await generateStatement({ businessId: merchantId, region: "AU", from, to });
    await backdateDisputeWindow(stmt.id);
    (
      await client.disputeStatement({ statementId: stmt.id, reason: "amount looks wrong" })
    )._unsafeUnwrap();

    const reserveId = "plat_AU_reserve";
    const payableId = `mer_${merchantId}_payable_AUD`;
    const reserveBefore = await balanceOf(reserveId);
    const payableBefore = await balanceOf(payableId);

    const approver = await sessionFor(app, { jurisdiction: "AU" });
    await grantStaffRole(ownerPool(), approver.userId, "finance");
    const proposed = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/AU/statements/${stmt.id}/payout-proposals`,
      headers: { cookie: approver.cookie, "idempotency-key": randomUUID() },
      payload: {},
    });
    expect(proposed.statusCode, proposed.body).toBe(201);
    const proposal = proposed.json<{ id: string }>();

    // A different approver -- the ledger itself refuses (disputed, not open),
    // regardless of the already-closed window, and nothing is paid.
    const secondApprover = await sessionFor(app, { jurisdiction: "AU" });
    await grantStaffRole(ownerPool(), secondApprover.userId, "finance");
    const approveWhileDisputed = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/AU/payout-proposals/${proposal.id}/approve`,
      headers: { cookie: secondApprover.cookie, "idempotency-key": randomUUID() },
      payload: {},
    });
    expect(approveWhileDisputed.statusCode).toBe(409);
    expect(await balanceOf(reserveId)).toBe(reserveBefore);
    expect(await balanceOf(payableId)).toBe(payableBefore);

    const resolved = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/statements/${stmt.id}/resolve-dispute`,
      headers: { cookie: approver.cookie, "idempotency-key": randomUUID() },
      payload: { note: "reviewed, releasing" },
    });
    expect(resolved.statusCode, resolved.body).toBe(201);

    const approveNow = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/AU/payout-proposals/${proposal.id}/approve`,
      headers: { cookie: secondApprover.cookie, "idempotency-key": randomUUID() },
      payload: {},
    });
    expect(approveNow.statusCode, approveNow.body).toBe(201);
    expect(await balanceOf(reserveId)).toBe(reserveBefore - amountMinor);
    expect(await balanceOf(payableId)).toBe(payableBefore - amountMinor);
  });
});
