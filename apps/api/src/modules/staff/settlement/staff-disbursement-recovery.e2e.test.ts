import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StaffDisbursements } from "@yourtal/contracts/billing/payouts";
import type { CheckDisbursementResult } from "@yourtal/contracts/staff/settlement";
import { createPaymentProviders } from "@yourtal/drivers/payment-providers";
import { createBrowser } from "@yourtal/paysim/browser";
import type { PaySimBrowser } from "@yourtal/paysim/browser";
import { startPaySimServer } from "@yourtal/paysim/server";
import type { PaySimServer } from "@yourtal/paysim/server";
import { AppModule } from "../../../app.module";
import { PAYMENT_PROVIDERS } from "../../../shared/drivers/payment-providers.module";
import { sessionFor } from "../../../shared/testing/session-for";
import { grantStaffRole, ownerPool } from "../staff.test-helper";

/**
 * 5.2.c end to end with the real pieces: the payment simulation in-process, the
 * Stripe drivers pointed at it, the API's staff routes with real Postgres and
 * Cerbos, and the worker's settlement-disburse run as its own process. A payout
 * is never in flight unseen: the job reads one back whose webhook never came,
 * and staff check again, or retry once the processor shows nothing moved, a row
 * the job will not move by itself, with two people, and never a second transfer.
 */
const execFileAsync = promisify(execFile);
const workerDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../worker",
);
const DEAD_WEBHOOK = "http://127.0.0.1:9/api/webhooks/stripe";

let app: NestFastifyApplication;
let paysim: PaySimServer;
let browser: PaySimBrowser;
let owner: Pool;
let providers: ReturnType<typeof createPaymentProviders>;
let offsetMs = 0;
let stripeEnv: Record<string, string>;

beforeAll(async () => {
  paysim = await startPaySimServer({ now: () => new Date(Date.now() + offsetMs) });
  browser = createBrowser(paysim.baseUrl);
  stripeEnv = {
    PAYMENTS_DRIVER: "live",
    DISBURSEMENT_DRIVER: "live",
    STRIPE_SECRET_KEY: paysim.secretKey,
    STRIPE_WEBHOOK_SECRET: paysim.webhookSecret,
    STRIPE_API_BASE: paysim.baseUrl,
  };
  providers = createPaymentProviders(stripeEnv);
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PAYMENT_PROVIDERS)
    .useValue(providers)
    .compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  app.useGlobalPipes(new ZodValidationPipe());
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  paysim.config.webhookUrl = `http://127.0.0.1:${String(address.port)}/api/webhooks/stripe`;
  owner = ownerPool();
});

afterAll(async () => {
  await app.close();
  await paysim.close();
  await owner.end();
});

async function settle(ms = 0) {
  offsetMs += ms;
  await paysim.tick();
}

async function runWorker(): Promise<Record<string, number>> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "@swc-node/register/esm-register", "src/settlement-disburse-once.ts"],
    { cwd: workerDir, env: { ...process.env, ...stripeEnv }, timeout: 60_000 },
  );
  return JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as Record<string, number>;
}

async function staff(role: "finance" | "ops" = "finance") {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  await grantStaffRole(owner, session.userId, role);
  return session;
}

/** A connected account onboarded on the simulation's page (bank ending 3456). */
async function account(bank = "000123456"): Promise<string> {
  const driver = providers.AU.payoutAccounts;
  const key = randomUUID();
  const created = (
    await driver.createAccount({
      idempotencyKey: `account:${key}`,
      reference: `business:${key}`,
      kind: "business",
      payoutSchedule: "manual",
    })
  )._unsafeUnwrap();
  const link = (
    await driver.onboardingLink({
      accountRef: created.accountRef,
      returnUrl: "https://app.test/done",
      refreshUrl: "https://app.test/again",
      purpose: "onboarding",
    })
  )._unsafeUnwrap();
  await browser.completeOnboarding(link.url.split("/").pop() ?? "", {
    bsb: "110000",
    account: bank,
  });
  return created.accountRef;
}

type Code = "transfer_unconfirmed" | "payout_unconfirmed" | "transfer_declined" | "payout_declined";

/**
 * A disbursement the job left for staff, with the money at the processor as the
 * test asks: a transfer and a payout really made on the simulation (whose answers
 * the job lost), or neither.
 */
async function stuck(options: {
  code: Code;
  transfer?: boolean;
  payout?: boolean;
  amountMinor?: number;
  /** A test bank account: 111111116 makes the payout fail with no_account. */
  bank?: string;
}) {
  const id = randomUUID();
  const statementId = randomUUID();
  const amountMinor = options.amountMinor ?? 12_300;
  const accountRef = await account(options.bank);
  const driver = providers.AU.payoutAccounts;
  let transferRef: string | null = null;
  if (options.transfer === true) {
    transferRef = (
      await driver.transfer({
        idempotencyKey: `payout-transfer:${statementId}`,
        amountMinor,
        currency: "AUD",
        accountRef,
        reference: `disbursement:${id}`,
      })
    )._unsafeUnwrap().transferRef;
  }
  if (options.payout === true) {
    (
      await driver.payout({
        idempotencyKey: `payout:${statementId}:1`,
        amountMinor,
        currency: "AUD",
        accountRef,
        reference: `disbursement:${id}:1`,
      })
    )._unsafeUnwrap();
  }
  const proposal = await owner.query<{ id: string }>(
    `INSERT INTO staff.economy_proposal (kind, region, summary, payload, result, proposed_by,
                                         approved_by, status, decided_at)
     VALUES ('approve_payout', 'AU', 'Payout', $1, $2, 'staff-a', 'staff-b', 'approved', now())
     RETURNING id`,
    [
      JSON.stringify({ statementId }),
      JSON.stringify({
        id: statementId,
        region: "AU",
        currency: "AUD",
        closingPayableMinor: amountMinor,
      }),
    ],
  );
  await owner.query(
    `INSERT INTO payment.disbursement
       (id, statement_id, proposal_id, business_id, region, currency, amount_minor, account_ref,
        transfer_ref, status, failure_code, failed_at, transfer_requested_at, payout_requested_at,
        transferred_at)
     VALUES ($1, $2, $3, $4, 'AU', 'AUD', $5, $6, $7, 'failed', $8, now(),
             now() - interval '24 hours', $9, $10)`,
    [
      id,
      statementId,
      proposal.rows[0]?.id,
      randomUUID(),
      amountMinor,
      accountRef,
      transferRef,
      options.code,
      transferRef === null ? null : new Date(Date.now() - 24 * 3_600_000),
      transferRef === null ? null : new Date(Date.now() - 24 * 3_600_000),
    ],
  );
  return { id, statementId, accountRef, amountMinor };
}

async function row(id: string): Promise<Record<string, unknown>> {
  const { rows } = await owner.query(`SELECT * FROM payment.disbursement WHERE id = $1`, [id]);
  return rows[0] as Record<string, unknown>;
}

const headers = (cookie: string) => ({ cookie, "idempotency-key": randomUUID() });
const url = (id: string, tail: string) => `/api/staff/settlement/AU/disbursements/${id}/${tail}`;

const check = (cookie: string, id: string) =>
  app.inject({ method: "POST", url: url(id, "check"), headers: headers(cookie), payload: {} });
const proposeRetry = (cookie: string, id: string) =>
  app.inject({
    method: "POST",
    url: url(id, "retry-proposals"),
    headers: headers(cookie),
    payload: { reason: "the processor never confirmed it" },
  });
const decide = (cookie: string, proposalId: string, verb: "approve" | "reject") =>
  app.inject({
    method: "POST",
    url: `/api/staff/settlement/AU/retry-proposals/${proposalId}/${verb}`,
    headers: headers(cookie),
    payload: {},
  });

describe("the job reads back a payout whose webhook never came (5.2.c)", () => {
  it("settles it as paid from the processor, once", async () => {
    paysim.config.webhookUrl = DEAD_WEBHOOK;
    try {
      const sent = await stuck({ code: "payout_unconfirmed", transfer: true, payout: true });
      // The payout is made, the webhook is lost: the row is `transferred` with its payout id.
      const found = (
        await providers.AU.payoutAccounts.findPayout({
          accountRef: sent.accountRef,
          reference: `disbursement:${sent.id}:1`,
          since: new Date(Date.now() - 3_600_000),
        })
      )._unsafeUnwrap();
      await owner.query(
        `UPDATE payment.disbursement
            SET status = 'transferred', failure_code = NULL, failed_at = NULL, payout_ref = $2,
                payout_requested_at = now() - interval '4 hours'
          WHERE id = $1`,
        [sent.id, found?.payoutRef],
      );
      await settle(31_000); // the processor pays; its webhook goes nowhere

      expect(await row(sent.id)).toMatchObject({ status: "transferred" });
      const first = await runWorker();
      expect(first["readPaid"]).toBeGreaterThanOrEqual(1);
      expect(await row(sent.id)).toMatchObject({ status: "paid", failure_code: null });
      expect((await row(sent.id))["paid_at"]).not.toBeNull();
      const again = await runWorker();
      expect(again["readPaid"]).toBe(0);
    } finally {
      paysim.config.webhookUrl = `http://127.0.0.1:${String((app.getHttpServer().address() as AddressInfo).port)}/api/webhooks/stripe`;
    }
  });
});

describe("check again (5.2.c)", () => {
  it("records a transfer the processor shows, and the job pays it out next", async () => {
    const sent = await stuck({ code: "transfer_unconfirmed", transfer: true });
    // The answer was lost, so the row has no transfer id.
    await owner.query(
      `UPDATE payment.disbursement SET transfer_ref = NULL, transferred_at = NULL WHERE id = $1`,
      [sent.id],
    );
    const finance = await staff();
    const response = await check(finance.cookie, sent.id);
    expect(response.statusCode).toBe(201);
    const body = response.json<CheckDisbursementResult>();
    expect(body.outcome).toBe("transferred");
    expect(body.disbursement).toMatchObject({ status: "transferred", needsStaff: false });
    expect(await row(sent.id)).toMatchObject({
      status: "transferred",
      failure_code: null,
      payout_ref: null,
    });
    expect(String((await row(sent.id))["transfer_ref"])).toMatch(/^tr_/);

    // The job then pays it out under the statement's own approval: one transfer, one payout.
    await runWorker();
    expect(await row(sent.id)).toMatchObject({ status: "transferred", attempt: 1 });
    expect((await row(sent.id))["payout_ref"]).not.toBeNull();
    const transfers = (await paysim.store.listObjects("transfer")).filter(
      (t) => t.data["destination"] === sent.accountRef,
    );
    expect(transfers).toHaveLength(1);
  });

  it("settles a payout the processor shows paid, though the webhook found the row failed and ignored it", async () => {
    const sent = await stuck({ code: "payout_unconfirmed", transfer: true, payout: true });
    const finance = await staff();
    await settle(31_000); // payout.paid reaches the API, which leaves a failed row alone
    expect(await row(sent.id)).toMatchObject({ status: "failed" });
    const result = await check(finance.cookie, sent.id);
    expect(result.statusCode).toBe(201);
    expect(result.json<CheckDisbursementResult>().outcome).toBe("paid");
    expect(await row(sent.id)).toMatchObject({ status: "paid", failure_code: null });
    expect((await row(sent.id))["payout_ref"]).not.toBeNull();
    // A second click finds the row settled and changes nothing.
    expect((await check(finance.cookie, sent.id)).statusCode).toBe(409);
  });

  it("records a payout still on its way as in flight, for the webhook or the job's read-back to settle", async () => {
    const sent = await stuck({ code: "payout_unconfirmed", transfer: true, payout: true });
    const finance = await staff();
    const result = (await check(finance.cookie, sent.id)).json<CheckDisbursementResult>();
    expect(result.outcome).toBe("pending");
    expect(await row(sent.id)).toMatchObject({ status: "transferred", failure_code: null });
    expect((await row(sent.id))["payout_ref"]).not.toBeNull();
    await settle(31_000); // payout.paid: now the webhook applies it
    expect(await row(sent.id)).toMatchObject({ status: "paid" });
  });

  it("records a payout the processor shows failed, with its failure code", async () => {
    const sent = await stuck({
      code: "payout_unconfirmed",
      transfer: true,
      payout: true,
      bank: "111111116",
    });
    const finance = await staff();
    await settle(31_000);
    const result = (await check(finance.cookie, sent.id)).json<CheckDisbursementResult>();
    expect(result.outcome).toBe("failed");
    expect(await row(sent.id)).toMatchObject({ status: "failed", failure_code: "no_account" });
    expect(result.disbursement.needsStaff).toBe(false);
  });

  it("says nothing was found when the processor shows nothing, and stamps when it was asked", async () => {
    const sent = await stuck({ code: "payout_unconfirmed", transfer: true });
    const finance = await staff();
    const result = (await check(finance.cookie, sent.id)).json<CheckDisbursementResult>();
    expect(result.outcome).toBe("nothing_found");
    expect(result.disbursement).toMatchObject({ status: "failed", needsStaff: true });
    expect(result.disbursement.checkedAt).not.toBeNull();
  });

  it("is refused for a row that is not stuck, in another region, or for the wrong role", async () => {
    const sent = await stuck({ code: "payout_unconfirmed", transfer: true });
    const finance = await staff();
    await owner.query(`UPDATE payment.disbursement SET failure_code = 'no_account' WHERE id = $1`, [
      sent.id,
    ]);
    const refused = await check(finance.cookie, sent.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe("not_stuck");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/staff/settlement/ID/disbursements/${sent.id}/check`,
          headers: headers(finance.cookie),
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
    const ops = await staff("ops");
    expect((await check(ops.cookie, sent.id)).statusCode).toBe(403);
  });

  it("refuses to adopt money whose amount differs from the row", async () => {
    const sent = await stuck({ code: "payout_unconfirmed", transfer: true, payout: true });
    await owner.query(
      `UPDATE payment.disbursement SET amount_minor = amount_minor + 1 WHERE id = $1`,
      [sent.id],
    );
    const finance = await staff();
    const refused = await check(finance.cookie, sent.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe("amount_mismatch");
    expect(await row(sent.id)).toMatchObject({ status: "failed", payout_ref: null });
  });
});

describe("retry (5.2.c): a new payout attempt, never a second transfer, two-person", () => {
  it("retries a payout the processor shows nothing of, once a second person approves", async () => {
    const sent = await stuck({ code: "payout_unconfirmed", transfer: true });
    const [a, b] = [await staff(), await staff()];

    const proposed = await proposeRetry(a.cookie, sent.id);
    expect(proposed.statusCode).toBe(201);
    const proposal = proposed.json<{ id: string; kind: string; status: string }>();
    expect(proposal).toMatchObject({ kind: "retry_disbursement", status: "pending" });
    expect(await row(sent.id)).toMatchObject({ status: "failed", attempt: 1 });
    expect((await proposeRetry(b.cookie, sent.id)).statusCode).toBe(409);

    const listed = (
      await app.inject({
        method: "GET",
        url: "/api/staff/settlement/AU/disbursements",
        headers: { cookie: a.cookie },
      })
    ).json<StaffDisbursements>();
    expect(listed.disbursements.find((d) => d.id === sent.id)).toMatchObject({
      needsStaff: true,
      retryProposal: { id: proposal.id },
    });

    expect((await decide(a.cookie, proposal.id, "approve")).statusCode).toBe(403);
    expect(await row(sent.id)).toMatchObject({ status: "failed", attempt: 1 });
    const approved = await decide(b.cookie, proposal.id, "approve");
    expect(approved.statusCode).toBe(201);
    expect(approved.json<{ status: string }>().status).toBe("approved");
    // Queued for the job as the next payout attempt, on the same transfer.
    expect(await row(sent.id)).toMatchObject({
      status: "transferred",
      attempt: 2,
      payout_ref: null,
      failure_code: null,
    });
    expect((await decide(b.cookie, proposal.id, "approve")).statusCode).toBe(400);

    // The job sends it: one payout under the next attempt's key, and no second transfer.
    await runWorker();
    await settle(31_000);
    expect(await row(sent.id)).toMatchObject({ attempt: 2 });
    expect((await row(sent.id))["payout_ref"]).not.toBeNull();
    const payouts = (await paysim.store.listObjects("payout")).filter(
      (p) => p.account === sent.accountRef,
    );
    expect(payouts).toHaveLength(1);
    expect(payouts[0]?.data["metadata"]).toMatchObject({ reference: `disbursement:${sent.id}:2` });
    const transfers = (await paysim.store.listObjects("transfer")).filter(
      (t) => t.data["destination"] === sent.accountRef,
    );
    // The one transfer it always had: a retry sends a payout, never another transfer.
    expect(transfers).toHaveLength(1);
  });

  it("queues a refused transfer again under the same transfer key, never a second transfer", async () => {
    const sent = await stuck({ code: "transfer_declined" });
    const [a, b] = [await staff(), await staff()];
    const proposal = (await proposeRetry(a.cookie, sent.id)).json<{ id: string }>();
    expect((await decide(b.cookie, proposal.id, "approve")).statusCode).toBe(201);
    expect(await row(sent.id)).toMatchObject({
      status: "queued",
      attempt: 1,
      transfer_ref: null,
      failure_code: null,
      transfer_requested_at: null,
    });
  });

  it("refuses to propose or approve once the processor shows the money moved", async () => {
    const sent = await stuck({ code: "payout_unconfirmed", transfer: true, payout: true });
    const [a, b] = [await staff(), await staff()];
    const refused = await proposeRetry(a.cookie, sent.id);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ code: string }>().code).toBe("processor_shows_money");

    // Nothing at the processor when proposed; the late payout appears before the approval.
    const late = await stuck({ code: "payout_unconfirmed", transfer: true });
    const proposal = (await proposeRetry(a.cookie, late.id)).json<{ id: string }>();
    (
      await providers.AU.payoutAccounts.payout({
        idempotencyKey: `payout:${late.statementId}:1`,
        amountMinor: late.amountMinor,
        currency: "AUD",
        accountRef: late.accountRef,
        reference: `disbursement:${late.id}:1`,
      })
    )._unsafeUnwrap();
    const second = await decide(b.cookie, proposal.id, "approve");
    expect(second.statusCode).toBe(409);
    expect(second.json<{ code: string }>().code).toBe("processor_shows_money");
    expect(await row(late.id)).toMatchObject({ status: "failed", attempt: 1 });
    // The proposal stays open, and checking again records the payout it found.
    expect((await check(b.cookie, late.id)).json<CheckDisbursementResult>().outcome).toBe(
      "pending",
    );
  });

  it("refuses an approval for a row that changed since it was proposed, and a decline frees it", async () => {
    const sent = await stuck({ code: "payout_unconfirmed", transfer: true });
    const [a, b] = [await staff(), await staff()];
    const proposal = (await proposeRetry(a.cookie, sent.id)).json<{ id: string }>();
    await owner.query(`UPDATE payment.disbursement SET attempt = 2 WHERE id = $1`, [sent.id]);
    const changed = await decide(b.cookie, proposal.id, "approve");
    expect(changed.statusCode).toBe(409);
    expect(changed.json<{ code: string }>().code).toBe("row_changed");

    const rejected = await decide(a.cookie, proposal.id, "reject");
    expect(rejected.statusCode).toBe(201);
    expect(rejected.json<{ status: string }>().status).toBe("rejected");
    expect((await proposeRetry(b.cookie, sent.id)).statusCode).toBe(201);
  });

  it("needs a reason and finance, and nothing else may retry", async () => {
    const sent = await stuck({ code: "payout_unconfirmed", transfer: true });
    const [a, ops] = [await staff(), await staff("ops")];
    const noReason = await app.inject({
      method: "POST",
      url: url(sent.id, "retry-proposals"),
      headers: headers(a.cookie),
      payload: {},
    });
    expect(noReason.statusCode).toBe(400);
    expect((await proposeRetry(ops.cookie, sent.id)).statusCode).toBe(403);
    expect((await proposeRetry(a.cookie, randomUUID())).statusCode).toBe(404);
  });
});
