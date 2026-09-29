import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toMinorUnits } from "@yourtal/contracts/money";
import { AppModule } from "../../../app.module";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import { sessionFor } from "../../../shared/testing/session-for";
import { seedBusinessMembership } from "../../../shared/testing/seed-business-membership";
import { generateStatementFake } from "../../../shared/ledger-client/fake/fake-ledger-economy";
import { FakeLedgerClient } from "../../../shared/ledger-client/fake-ledger-client";
import { grantStaffRole, ownerPool } from "../staff.test-helper";

/**
 * TASKS.md 10.6.c's Check, over the real HTTP stack (real Postgres, real
 * Cerbos, `LEDGER_MODE=fake` -- this suite's default): an approved statement
 * produces exactly one simulated payout after the dispute window, and a
 * disputed one pays nothing until resolved.
 */
let app: NestFastifyApplication;
let owner: Pool;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  owner = ownerPool();
});

afterAll(async () => {
  await owner.end();
  await app.close();
});

async function staffWith(role: "finance" | "ops" | "support" | "moderator" | "risk_analyst") {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  await grantStaffRole(owner, session.userId, role);
  return session;
}

function idem(): string {
  return randomUUID();
}

/**
 * `EconomyProposal` (the HTTP response's own wire shape) never carries the
 * ledger's raw `result` -- `toEconomyProposal` strips it, the same way it
 * strips B from a rate-change proposal (route-registry.c-staff-economy.ts's
 * own comment on that). The DB row is the real proof "paid, exactly once,
 * with a real transfer" per this Check's own wording ("the DB rows").
 */
async function statementRow(
  statementId: string,
): Promise<{ status: string; payoutTransferId: string | null }> {
  const rows = await db.execute<{ status: string; payout_transfer_id: string | null }>(
    sql`SELECT status, payout_transfer_id FROM platform.ledger_fake_statement WHERE id = ${statementId}`,
  );
  const row = rows.rows[0];
  if (row === undefined) throw new Error(`no such statement ${statementId}`);
  return { status: row.status, payoutTransferId: row.payout_transfer_id };
}

/** A business with a real AU business row, for `generateStatementFake`'s own `businessId`. */
async function seedBusiness(): Promise<string> {
  const session = await sessionFor(app, { jurisdiction: "AU" });
  return seedBusinessMembership(db, { userId: session.userId, role: "owner" });
}

/**
 * A statement whose F12 dispute window has already closed (`to` 8 days ago;
 * the window is 7 days), covering one real, backdated capture -- so its
 * closing payable is a genuine positive S, not an empty zero-value row.
 * `captureVoucher`'s fake always stamps `posted_at = now()`; this backdates
 * that one row into the statement's own [from, to) window afterwards, the
 * only way to get both "captured" and "the window already closed" from a
 * synchronous fixture with no test clock.
 */
async function closedWindowStatement(businessId: string) {
  const to = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const from = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
  const midpoint = new Date((from.getTime() + to.getTime()) / 2).toISOString();

  const fake = new FakeLedgerClient(db);
  const captureId = randomUUID();
  (
    await fake.captureVoucher({
      captureId,
      region: "AU",
      merchantId: businessId,
      amountMinor: toMinorUnits(4_200),
      currency: "AUD",
    })
  )._unsafeUnwrap();
  await db.execute(
    sql`UPDATE platform.ledger_fake_capture SET posted_at = ${midpoint}::timestamptz WHERE capture_id = ${captureId}`,
  );

  return generateStatementFake(db, {
    businessId,
    region: "AU",
    from: from.toISOString(),
    to: to.toISOString(),
  });
}

/** A statement whose window is still open (`to` an hour from now), for the "pays nothing yet" half. */
async function openWindowStatement(businessId: string) {
  const to = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  return generateStatementFake(db, { businessId, region: "AU", from, to });
}

describe("GET /api/staff/settlement/:region/queue", () => {
  it("finance and ops both see it; support does not", async () => {
    const businessId = await seedBusiness();
    const statement = await closedWindowStatement(businessId);
    const finance = await staffWith("finance");
    const ops = await staffWith("ops");
    const support = await staffWith("support");

    const financeResp = await app.inject({
      method: "GET",
      url: "/api/staff/settlement/AU/queue",
      headers: { cookie: finance.cookie },
    });
    expect(financeResp.statusCode).toBe(200);
    const body = financeResp.json<{ region: string; statements: { id: string }[] }>();
    expect(body.region).toBe("AU");
    expect(body.statements.some((row) => row.id === statement.id)).toBe(true);

    const opsResp = await app.inject({
      method: "GET",
      url: "/api/staff/settlement/AU/queue",
      headers: { cookie: ops.cookie },
    });
    expect(opsResp.statusCode).toBe(200);

    const supportResp = await app.inject({
      method: "GET",
      url: "/api/staff/settlement/AU/queue",
      headers: { cookie: support.cookie },
    });
    expect(supportResp.statusCode).toBe(403);
  });
});

describe("payout approval (10.1.c/10.6.a) -- two-person, after the dispute window", () => {
  it("proposes then approves with a SECOND, different finance staffer, moving the statement to paid exactly once", async () => {
    const businessId = await seedBusiness();
    const statement = await closedWindowStatement(businessId);
    const proposer = await staffWith("finance");
    const approver = await staffWith("finance");

    const proposeResp = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/AU/statements/${statement.id}/payout-proposals`,
      headers: { cookie: proposer.cookie, "idempotency-key": idem() },
      payload: { reason: "past its window, nothing disputed" },
    });
    expect(proposeResp.statusCode).toBe(201);
    const proposal = proposeResp.json<{ id: string; status: string; proposedBy: string }>();
    expect(proposal.status).toBe("pending");

    // The proposer cannot approve their own proposal.
    const selfApprove = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/AU/payout-proposals/${proposal.id}/approve`,
      headers: { cookie: proposer.cookie, "idempotency-key": idem() },
      payload: {},
    });
    expect(selfApprove.statusCode).toBe(403);

    const approveResp = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/AU/payout-proposals/${proposal.id}/approve`,
      headers: { cookie: approver.cookie, "idempotency-key": idem() },
      payload: { note: "checked, paying out" },
    });
    expect(approveResp.statusCode).toBe(201);
    const decided = approveResp.json<{ status: string }>();
    expect(decided.status).toBe("approved");
    // The DB row: paid, exactly once, with a real transfer (a real closing
    // payable from the backdated capture in `closedWindowStatement`).
    const row = await statementRow(statement.id);
    expect(row.status).toBe("paid");
    expect(row.payoutTransferId).not.toBeNull();

    // A second approval attempt on the SAME already-decided proposal is refused outright.
    const replayProposal = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/AU/payout-proposals/${proposal.id}/approve`,
      headers: { cookie: approver.cookie, "idempotency-key": idem() },
      payload: {},
    });
    expect(replayProposal.statusCode).toBe(400);

    // The statement itself is no longer in the open/disputed queue.
    const queueResp = await app.inject({
      method: "GET",
      url: "/api/staff/settlement/AU/queue",
      headers: { cookie: approver.cookie },
    });
    expect(
      queueResp
        .json<{ statements: { id: string }[] }>()
        .statements.some((row) => row.id === statement.id),
    ).toBe(false);
  });

  it("refuses a payout before the dispute window closes", async () => {
    const businessId = await seedBusiness();
    const statement = await openWindowStatement(businessId);
    const proposer = await staffWith("finance");
    const approver = await staffWith("finance");

    const proposeResp = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/AU/statements/${statement.id}/payout-proposals`,
      headers: { cookie: proposer.cookie, "idempotency-key": idem() },
      payload: {},
    });
    expect(proposeResp.statusCode).toBe(201);
    const proposal = proposeResp.json<{ id: string }>();

    const approveResp = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/AU/payout-proposals/${proposal.id}/approve`,
      headers: { cookie: approver.cookie, "idempotency-key": idem() },
      payload: {},
    });
    expect(approveResp.statusCode).toBe(409);
    expect(approveResp.json<{ code: string }>().code).toBe("dispute_window_open");
  });
});

describe("a disputed statement pays nothing until resolved (10.6.a; 10.6.b raised the dispute)", () => {
  it("refuses a payout while disputed, then pays out once resolved", async () => {
    const businessId = await seedBusiness();
    const statement = await closedWindowStatement(businessId);
    const fake = new FakeLedgerClient(db);

    // The dispute itself is 10.6.b's own already-tested route
    // (billing.controller.e2e.test.ts proves the HTTP path and its tenancy
    // check); raised here directly against the same fake store so this
    // suite stays focused on the SETTLEMENT half.
    (
      await fake.disputeStatement({ statementId: statement.id, reason: "amount looks wrong" })
    )._unsafeUnwrap();

    const proposer = await staffWith("finance");
    const approver = await staffWith("finance");
    const proposeResp = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/AU/statements/${statement.id}/payout-proposals`,
      headers: { cookie: proposer.cookie, "idempotency-key": idem() },
      payload: {},
    });
    expect(proposeResp.statusCode).toBe(201);
    const proposal = proposeResp.json<{ id: string }>();

    const approveResp = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/AU/payout-proposals/${proposal.id}/approve`,
      headers: { cookie: approver.cookie, "idempotency-key": idem() },
      payload: {},
    });
    // Disputed, not open: the ledger itself refuses, regardless of the
    // (already closed) dispute window -- nothing is paid.
    expect(approveResp.statusCode).toBe(409);
    expect(approveResp.json<{ code: string }>().code).toBe("statement_not_open");

    // Support cannot resolve the dispute -- only finance/ops (billing.yaml).
    const support = await staffWith("support");
    const supportResolve = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/statements/${statement.id}/resolve-dispute`,
      headers: { cookie: support.cookie, "idempotency-key": idem() },
      payload: { note: "should not reach here" },
    });
    expect(supportResolve.statusCode).toBe(403);

    const resolveResp = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/statements/${statement.id}/resolve-dispute`,
      headers: { cookie: approver.cookie, "idempotency-key": idem() },
      payload: { note: "recovery posted, dispute unfounded" },
    });
    expect(resolveResp.statusCode).toBe(201);
    expect(resolveResp.json<{ status: string }>().status).toBe("open");

    // Now that it is open again (and the window is already closed), the
    // SAME pending proposal from before finally pays out.
    const retryApprove = await app.inject({
      method: "POST",
      url: `/api/staff/settlement/AU/payout-proposals/${proposal.id}/approve`,
      headers: { cookie: approver.cookie, "idempotency-key": idem() },
      payload: {},
    });
    expect(retryApprove.statusCode).toBe(201);
    expect((await statementRow(statement.id)).status).toBe("paid");
  });
});
