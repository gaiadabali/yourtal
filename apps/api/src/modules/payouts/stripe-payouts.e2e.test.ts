import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StaffDisbursements, StudioPayouts } from "@yourtal/contracts/billing/payouts";
import { toMinorUnits } from "@yourtal/contracts/money";
import { createPaymentProviders } from "@yourtal/drivers/payment-providers";
import { createBrowser } from "@yourtal/paysim/browser";
import type { PaySimBrowser } from "@yourtal/paysim/browser";
import { startPaySimServer } from "@yourtal/paysim/server";
import type { PaySimServer } from "@yourtal/paysim/server";
import { AppModule } from "../../app.module";
import { PAYMENT_PROVIDERS } from "../../shared/drivers/payment-providers.module";
import { FakeLedgerClient } from "../../shared/ledger-client/fake-ledger-client";
import { generateStatementFake } from "../../shared/ledger-client/fake/fake-ledger-economy";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { seedBusinessMembership } from "../../shared/testing/seed-business-membership";
import { sessionFor } from "../../shared/testing/session-for";
import { grantStaffRole, ownerPool } from "../staff/staff.test-helper";

/**
 * 5.2 end to end with the real pieces: the payment simulation in-process,
 * the Stripe drivers pointed at it, the API's webhook route over real HTTP,
 * the staff console's two-person approval, and the worker's settlement-disburse
 * run as its own process (the API may not import the worker). A brand onboards
 * on the simulation's page, an approved statement is transferred and paid out
 * once, a failed payout is paid again after a bank update, and a charity's
 * ready account becomes its payout reference.
 */
const execFileAsync = promisify(execFile);
const workerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../worker");

let app: NestFastifyApplication;
let paysim: PaySimServer;
let browser: PaySimBrowser;
let owner: Pool;
let offsetMs = 0;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
const deliveries: string[] = [];
let stripeEnv: Record<string, string>;

beforeAll(async () => {
  const recording: typeof fetch = (input, init) => {
    if (typeof init?.body === "string") deliveries.push(init.body);
    return fetch(input, init);
  };
  // Payouts settle ~30 s after they are made: the clock is moved instead of waited for.
  paysim = await startPaySimServer({
    fetch: recording,
    now: () => new Date(Date.now() + offsetMs),
  });
  browser = createBrowser(paysim.baseUrl);
  stripeEnv = {
    PAYMENTS_DRIVER: "live",
    DISBURSEMENT_DRIVER: "live",
    STRIPE_SECRET_KEY: paysim.secretKey,
    STRIPE_WEBHOOK_SECRET: paysim.webhookSecret,
    STRIPE_API_BASE: paysim.baseUrl,
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PAYMENT_PROVIDERS)
    .useValue(createPaymentProviders(stripeEnv))
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

/** Delivers everything due after `ms` more on the simulation's clock. */
async function settle(ms = 0) {
  offsetMs += ms;
  await paysim.tick();
}

/** One settlement-disburse run, configured from the environment as the scheduled job is. */
async function runWorker(): Promise<Record<string, number>> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "@swc-node/register/esm-register", "src/settlement-disburse-once.ts"],
    { cwd: workerDir, env: { ...process.env, ...stripeEnv }, timeout: 60_000 },
  );
  return JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as Record<string, number>;
}

async function brand(region: "AU" | "ID" = "AU") {
  const session = await sessionFor(app, { jurisdiction: region });
  const businessId = await seedBusinessMembership(db, {
    userId: session.userId,
    role: "owner",
    region,
  });
  return { cookie: session.cookie, businessId };
}

async function payouts(who: { cookie: string; businessId: string }) {
  const response = await app.inject({
    method: "GET",
    url: `/api/${who.businessId}/studio/billing/payouts`,
    headers: { cookie: who.cookie },
  });
  expect(response.statusCode).toBe(200);
  return response.json<StudioPayouts>();
}

/** Opens the link route and fills in the simulation's onboarding page with this bank account. */
async function onboard(url: string, cookie: string, account: string) {
  const response = await app.inject({ method: "POST", url, headers: { cookie } });
  expect(response.statusCode).toBe(201);
  const link = response.json<{ url: string }>().url;
  expect(link.startsWith(`${paysim.baseUrl}/connect/onboarding/`)).toBe(true);
  const page = await browser.completeOnboarding(link.split("/").pop() ?? "", {
    bsb: "110000",
    account,
  });
  expect(page.status).toBe(303);
  expect(page.location).toContain("payouts=returned");
  await settle(); // account.updated
}

async function staffWith(role: "finance") {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  await grantStaffRole(owner, session.userId, role);
  return session;
}

/** A statement past its dispute window with a real capture, proposed and approved by two people. */
async function approveStatement(businessId: string, amountMinor: number): Promise<string> {
  const to = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const from = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
  const captureId = randomUUID();
  const captured = await new FakeLedgerClient(db).captureVoucher({
    captureId,
    region: "AU",
    merchantId: businessId,
    amountMinor: toMinorUnits(amountMinor),
    currency: "AUD",
  });
  expect(captured.isOk()).toBe(true);
  const midpoint = new Date((from.getTime() + to.getTime()) / 2).toISOString();
  await db.execute(
    sql`UPDATE platform.ledger_fake_capture SET posted_at = ${midpoint}::timestamptz WHERE capture_id = ${captureId}`,
  );
  const statement = await generateStatementFake(db, {
    businessId,
    region: "AU",
    from: from.toISOString(),
    to: to.toISOString(),
  });

  const [proposer, approver] = [await staffWith("finance"), await staffWith("finance")];
  const proposed = await app.inject({
    method: "POST",
    url: `/api/staff/settlement/AU/statements/${statement.id}/payout-proposals`,
    headers: { cookie: proposer.cookie, "idempotency-key": randomUUID() },
    payload: { reason: "past its window" },
  });
  expect(proposed.statusCode).toBe(201);
  const approved = await app.inject({
    method: "POST",
    url: `/api/staff/settlement/AU/payout-proposals/${proposed.json<{ id: string }>().id}/approve`,
    headers: { cookie: approver.cookie, "idempotency-key": randomUUID() },
    payload: {},
  });
  expect(approved.statusCode).toBe(201);
  return statement.id;
}

const eventsFor = (type: string, accountRef: string) =>
  deliveries.filter((body) => body.includes(`"type":"${type}"`) && body.includes(accountRef))
    .length;

async function accountRefOf(businessId: string): Promise<string> {
  const { rows } = await db.execute(
    sql`SELECT account_ref FROM payment.connected_account WHERE owner_id = ${businessId}`,
  );
  return String(rows[0]?.["account_ref"]);
}

describe("Stripe Connect payouts through the simulation (5.2)", () => {
  it("a brand onboards, an approved statement is transferred and paid out once", async () => {
    const who = await brand();
    expect((await payouts(who)).account).toEqual({
      available: true,
      state: "not_started",
      bankLast4: null,
      hostedOnboarding: true,
    });
    await onboard(`/api/${who.businessId}/studio/billing/payouts/link`, who.cookie, "000123456");
    expect((await payouts(who)).account).toMatchObject({ state: "ready", bankLast4: "3456" });

    const statementId = await approveStatement(who.businessId, 25_000);
    await runWorker();
    const sent = (await payouts(who)).payouts.find((p) => p.statementId === statementId);
    expect(sent).toMatchObject({ status: "transferred", currency: "AUD" });
    expect(sent?.amountMinor).toBeGreaterThan(0);

    await settle(31_000); // payout.paid
    const paid = (await payouts(who)).payouts.find((p) => p.statementId === statementId);
    expect(paid).toMatchObject({ status: "paid", bankLast4: "3456" });
    expect(paid?.paidAt).not.toBeNull();

    // Another run, and a replayed delivery, move nothing more.
    await runWorker();
    await settle(31_000);
    const accountRef = await accountRefOf(who.businessId);
    expect(eventsFor("transfer.created", accountRef)).toBe(1);
    expect(eventsFor("payout.paid", accountRef)).toBe(1);

    const finance = await staffWith("finance");
    const staff = await app.inject({
      method: "GET",
      url: "/api/staff/settlement/AU/disbursements",
      headers: { cookie: finance.cookie },
    });
    expect(staff.statusCode).toBe(200);
    const row = staff
      .json<StaffDisbursements>()
      .disbursements.find((d) => d.statementId === statementId);
    expect(row).toMatchObject({ status: "paid", attempt: 1, businessId: who.businessId });
  });

  it("a payout to a bad bank fails, and is paid on the next attempt after a bank update", async () => {
    const who = await brand();
    const link = `/api/${who.businessId}/studio/billing/payouts/link`;
    await onboard(link, who.cookie, "111111116");
    const statementId = await approveStatement(who.businessId, 9_900);
    await runWorker();
    await settle(31_000); // payout.failed

    let view = await payouts(who);
    expect(view.payoutFailed).toBe(true);
    expect(view.payouts.find((p) => p.statementId === statementId)).toMatchObject({
      status: "failed",
      failureCode: "no_account",
    });

    // Nothing changed at the bank: nothing is sent again.
    await runWorker();
    const accountRef = await accountRefOf(who.businessId);
    expect(eventsFor("payout.failed", accountRef)).toBe(1);

    await onboard(link, who.cookie, "000123456"); // account_update
    await runWorker();
    await settle(31_000);
    view = await payouts(who);
    expect(view.payoutFailed).toBe(false);
    expect(view.payouts.find((p) => p.statementId === statementId)).toMatchObject({
      status: "paid",
      bankLast4: "3456",
    });
    expect(eventsFor("transfer.created", accountRef)).toBe(1);
    const { rows } = await db.execute(
      sql`SELECT attempt FROM payment.disbursement WHERE statement_id = ${statementId}`,
    );
    expect(rows[0]?.["attempt"]).toBe(2);
  });

  it("waits for an account that is not set up, and pays once it is", async () => {
    const who = await brand();
    const statementId = await approveStatement(who.businessId, 5_000);
    await runWorker();
    const view = await payouts(who);
    expect(view.waitingForAccount).toBe(true);
    expect(view.payouts.find((p) => p.statementId === statementId)?.status).toBe(
      "awaiting_account",
    );

    await onboard(`/api/${who.businessId}/studio/billing/payouts/link`, who.cookie, "000123456");
    await runWorker();
    await settle(31_000);
    expect((await payouts(who)).payouts.find((p) => p.statementId === statementId)?.status).toBe(
      "paid",
    );
  });

  it("offers nothing in Indonesia", async () => {
    const who = await brand("ID");
    expect((await payouts(who)).account.available).toBe(false);
    const link = await app.inject({
      method: "POST",
      url: `/api/${who.businessId}/studio/billing/payouts/link`,
      headers: { cookie: who.cookie },
    });
    expect(link.statusCode).toBe(404);
  });

  it("a charity onboards and its payout reference becomes its Stripe account", async () => {
    const member = await sessionFor(app, { jurisdiction: "AU" });
    const applied = await app.inject({
      method: "POST",
      url: "/api/charities/applications",
      headers: { cookie: member.cookie, "idempotency-key": randomUUID() },
      payload: {
        name: `Harbour Kids ${randomUUID().slice(0, 6)}`,
        region: "AU",
        cause: "children_youth",
        summary: "Breakfast programmes in local schools.",
        registration: { kind: "au_acnc", abn: "51824753556", acncRegistered: true },
        payoutAccount: {
          accountName: "Harbour Kids Ltd",
          bankCode: "062000",
          accountNumber: "12345678",
        },
      },
    });
    expect(applied.statusCode).toBe(201);
    const charityId = applied.json<{ id: string }>().id;
    const ops = await sessionFor(app, { jurisdiction: "AU" });
    await grantStaffRole(owner, ops.userId, "ops");
    const decided = await app.inject({
      method: "POST",
      url: `/api/staff/charities/${charityId}/decision`,
      headers: { cookie: ops.cookie },
      payload: { decision: "approve", reason: "ACNC register checked" },
    });
    expect(decided.statusCode).toBe(201);

    const reference = async () => {
      const { rows } = await db.execute(
        sql`SELECT payout_reference FROM charity.charity WHERE id = ${charityId}`,
      );
      return String(rows[0]?.["payout_reference"]);
    };
    expect(await reference()).toMatch(/^sim_payout_/);

    const stranger = await sessionFor(app, { jurisdiction: "AU" });
    const refused = await app.inject({
      method: "POST",
      url: `/api/charities/${charityId}/payouts/link`,
      headers: { cookie: stranger.cookie },
    });
    expect(refused.statusCode).toBe(403);

    await onboard(`/api/charities/${charityId}/payouts/link`, member.cookie, "000123456");
    expect(await reference()).toMatch(/^acct_/);
    const status = await app.inject({
      method: "GET",
      url: `/api/charities/${charityId}/payouts`,
      headers: { cookie: member.cookie },
    });
    expect(status.json<{ account: { state: string; bankLast4: string } }>().account).toMatchObject({
      state: "ready",
      bankLast4: "3456",
    });
  });
});
