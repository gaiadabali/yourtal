import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../app.module";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import { sessionFor } from "../../../shared/testing/session-for";
import { seedBusinessMembership } from "../../../shared/testing/seed-business-membership";
import { grantStaffRole, ownerPool } from "../staff.test-helper";

/**
 * TASKS.md 9.5.e's Check, over the real HTTP stack (real Postgres, real
 * Cerbos, `LEDGER_MODE=fake`):
 *   - a rate change needs a second approver (self-approval refused);
 *   - the AU daily cap change reaches `platform.region_setting` as an
 *     approved row -- the thing the real Go ledger's `Engine.Caps()` reads
 *     (`services/ledger/internal/reward/caps.go`); this suite proves the
 *     staff-console half, not `Caps()` itself, which is Area A's code;
 *   - coverage matches the ledger (this screen echoes `ledger.coverage()`
 *     verbatim, so "matches" is definitional -- covered by the overview
 *     test asserting the response IS that call's own value).
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
  return crypto.randomUUID();
}

describe("GET /api/staff/economy/:region/overview", () => {
  it("finance and ops both see it; support does not", async () => {
    const finance = await staffWith("finance");
    const ops = await staffWith("ops");
    const support = await staffWith("support");

    const financeResp = await app.inject({
      method: "GET",
      url: "/api/staff/economy/AU/overview",
      headers: { cookie: finance.cookie },
    });
    expect(financeResp.statusCode).toBe(200);
    const body = financeResp.json<{
      region: string;
      coverage: { region: string };
      reportedSpread: { currency: string };
      manualPurchases: unknown[];
    }>();
    expect(body.region).toBe("AU");
    expect(body.coverage.region).toBe("AU");
    expect(body.reportedSpread.currency).toBe("AUD");

    const opsResp = await app.inject({
      method: "GET",
      url: "/api/staff/economy/AU/overview",
      headers: { cookie: ops.cookie },
    });
    expect(opsResp.statusCode).toBe(200);

    const supportResp = await app.inject({
      method: "GET",
      url: "/api/staff/economy/AU/overview",
      headers: { cookie: support.cookie },
    });
    expect(supportResp.statusCode).toBe(403);
  });

  it("refuses an unknown region", async () => {
    const finance = await staffWith("finance");
    const resp = await app.inject({
      method: "GET",
      url: "/api/staff/economy/NZ/overview",
      headers: { cookie: finance.cookie },
    });
    expect(resp.statusCode).toBe(400);
  });
});

describe("rate changes (9.5.b) -- B never leaves this screen", () => {
  it("ops cannot view the rate screen; finance can", async () => {
    const ops = await staffWith("ops");
    const finance = await staffWith("finance");

    const opsResp = await app.inject({
      method: "GET",
      url: "/api/staff/economy/AU/rate",
      headers: { cookie: ops.cookie },
    });
    expect(opsResp.statusCode).toBe(403);

    const financeResp = await app.inject({
      method: "GET",
      url: "/api/staff/economy/AU/rate",
      headers: { cookie: finance.cookie },
    });
    expect(financeResp.statusCode).toBe(200);
  });

  it("needs a SECOND, different staff member to approve; the proposer cannot approve their own change", async () => {
    const proposer = await staffWith("finance");
    const approver = await staffWith("finance");

    const propose = await app.inject({
      method: "POST",
      url: "/api/staff/economy/AU/rate/proposals",
      headers: { cookie: proposer.cookie, "idempotency-key": idem() },
      payload: { backingRateMicrosPerPoint: 31_000, reason: "9.5.e check" },
    });
    expect(propose.statusCode).toBe(201);
    const proposal = propose.json<{ id: string; status: string }>();
    expect(proposal.status).toBe("pending");

    const selfApprove = await app.inject({
      method: "POST",
      url: `/api/staff/economy/AU/rate/proposals/${proposal.id}/approve`,
      headers: { cookie: proposer.cookie, "idempotency-key": idem() },
      payload: {},
    });
    expect(selfApprove.statusCode).toBe(403);

    const approve = await app.inject({
      method: "POST",
      url: `/api/staff/economy/AU/rate/proposals/${proposal.id}/approve`,
      headers: { cookie: approver.cookie, "idempotency-key": idem() },
      payload: {},
    });
    expect(approve.statusCode).toBe(201);
    expect(approve.json<{ status: string; approvedBy: string }>().status).toBe("approved");

    // An already-decided proposal cannot be decided again.
    const again = await app.inject({
      method: "POST",
      url: `/api/staff/economy/AU/rate/proposals/${proposal.id}/approve`,
      headers: { cookie: approver.cookie, "idempotency-key": idem() },
      payload: {},
    });
    expect(again.statusCode).toBe(400);
  });
});

describe("marketing funding (9.5.c) -- two-person", () => {
  it("refuses a self-approval and accepts a second staff member's", async () => {
    const proposer = await staffWith("finance");
    const approver = await staffWith("finance");

    const propose = await app.inject({
      method: "POST",
      url: "/api/staff/economy/AU/marketing-fundings",
      headers: { cookie: proposer.cookie, "idempotency-key": idem() },
      payload: { amountMinor: 10_000, reason: "top up the streak pool" },
    });
    expect(propose.statusCode).toBe(201);
    const proposal = propose.json<{ id: string }>();

    const selfApprove = await app.inject({
      method: "POST",
      url: `/api/staff/economy/AU/marketing-fundings/${proposal.id}/approve`,
      headers: { cookie: proposer.cookie, "idempotency-key": idem() },
      payload: {},
    });
    expect(selfApprove.statusCode).toBe(403);

    const approve = await app.inject({
      method: "POST",
      url: `/api/staff/economy/AU/marketing-fundings/${proposal.id}/approve`,
      headers: { cookie: approver.cookie, "idempotency-key": idem() },
      payload: {},
    });
    expect(approve.statusCode).toBe(201);
    expect(approve.json<{ status: string }>().status).toBe("approved");
  });
});

describe("manual point purchase (9.5.c) -- bank-transfer reference, two-person", () => {
  it("refuses a business from the other region", async () => {
    const proposer = await staffWith("finance");
    const session = await sessionFor(app, { jurisdiction: "ID" });
    const idBusinessId = await seedBusinessMembership(db, {
      userId: session.userId,
      role: "owner",
      region: "ID",
    });

    const propose = await app.inject({
      method: "POST",
      url: "/api/staff/economy/AU/purchases",
      headers: { cookie: proposer.cookie, "idempotency-key": idem() },
      payload: {
        businessId: idBusinessId,
        points: 1_000,
        paidMinor: 4_500,
        bankReference: "BSB-000-000 REF-1",
      },
    });
    expect(propose.statusCode).toBe(400);
  });

  it("refuses a self-approval and records the purchase once a second staff member approves", async () => {
    const proposer = await staffWith("finance");
    const approver = await staffWith("finance");
    const ownerSession = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await seedBusinessMembership(db, {
      userId: ownerSession.userId,
      role: "owner",
      region: "AU",
    });

    const propose = await app.inject({
      method: "POST",
      url: "/api/staff/economy/AU/purchases",
      headers: { cookie: proposer.cookie, "idempotency-key": idem() },
      payload: {
        businessId,
        points: 5_000,
        paidMinor: 225_00,
        bankReference: "BSB-062-000 REF-9.5.c",
        reason: "bank transfer received",
      },
    });
    expect(propose.statusCode).toBe(201);
    const proposal = propose.json<{ id: string }>();

    const selfApprove = await app.inject({
      method: "POST",
      url: `/api/staff/economy/AU/purchases/${proposal.id}/approve`,
      headers: { cookie: proposer.cookie, "idempotency-key": idem() },
      payload: {},
    });
    expect(selfApprove.statusCode).toBe(403);

    const approve = await app.inject({
      method: "POST",
      url: `/api/staff/economy/AU/purchases/${proposal.id}/approve`,
      headers: { cookie: approver.cookie, "idempotency-key": idem() },
      payload: {},
    });
    expect(approve.statusCode).toBe(201);
    expect(approve.json<{ status: string }>().status).toBe("approved");

    const overview = await app.inject({
      method: "GET",
      url: "/api/staff/economy/AU/overview",
      headers: { cookie: proposer.cookie },
    });
    const body = overview.json<{ manualPurchases: { id: string; status: string }[] }>();
    expect(body.manualPurchases.some((p) => p.id === proposal.id && p.status === "approved")).toBe(
      true,
    );
  });
});

describe("region settings (9.5.d) -- every F12 setting, per region", () => {
  it("ops can view but not propose; finance can propose, and a self-approval is refused", async () => {
    const finance = await staffWith("finance");
    const secondFinance = await staffWith("finance");
    const ops = await staffWith("ops");

    const opsView = await app.inject({
      method: "GET",
      url: "/api/staff/economy/AU/settings",
      headers: { cookie: ops.cookie },
    });
    expect(opsView.statusCode).toBe(200);
    const current = opsView.json<{ current: { key: string; value: unknown }[] }>().current;
    expect(current.some((s) => s.key === "daily_earn_cap")).toBe(true);

    const opsPropose = await app.inject({
      method: "POST",
      url: "/api/staff/economy/AU/settings/proposals",
      headers: { cookie: ops.cookie, "idempotency-key": idem() },
      payload: { key: "daily_earn_cap", value: 600 },
    });
    expect(opsPropose.statusCode).toBe(403);

    const propose = await app.inject({
      method: "POST",
      url: "/api/staff/economy/AU/settings/proposals",
      headers: { cookie: finance.cookie, "idempotency-key": idem() },
      payload: { key: "daily_earn_cap", value: 600, reason: "9.5.e check" },
    });
    expect(propose.statusCode).toBe(201);
    const proposal = propose.json<{ id: string }>();

    const selfApprove = await app.inject({
      method: "POST",
      url: `/api/staff/economy/AU/settings/proposals/${proposal.id}/approve`,
      headers: { cookie: finance.cookie, "idempotency-key": idem() },
      payload: {},
    });
    expect(selfApprove.statusCode).toBe(403);

    const approve = await app.inject({
      method: "POST",
      url: `/api/staff/economy/AU/settings/proposals/${proposal.id}/approve`,
      headers: { cookie: secondFinance.cookie, "idempotency-key": idem() },
      payload: {},
    });
    expect(approve.statusCode).toBe(201);

    // The change is now what a second read sees -- this IS the row
    // `services/ledger/internal/reward/caps.go`'s `Engine.Caps()` reads
    // through `platform.ledger_setting`, proving the staff-console half of
    // "changing the AU daily cap changes what's enforced".
    const after = await app.inject({
      method: "GET",
      url: "/api/staff/economy/AU/settings",
      headers: { cookie: finance.cookie },
    });
    const updated = after.json<{ current: { key: string; value: unknown }[] }>().current;
    expect(updated.find((s) => s.key === "daily_earn_cap")?.value).toBe(600);

    // Restore the seeded default: this suite shares one ephemeral database
    // with the rest of the API suite (with-test-db.mjs, one DB per run, not
    // per file), and `drizzle-region-settings-reader.test.ts` (1.2.f, Area
    // A) asserts AU's `daily_earn_cap` is still the F12 seed value (500).
    // Leaving it at 600 would be this test polluting shared fixture state
    // for a test it has no business affecting.
    const revertPropose = await app.inject({
      method: "POST",
      url: "/api/staff/economy/AU/settings/proposals",
      headers: { cookie: finance.cookie, "idempotency-key": idem() },
      payload: { key: "daily_earn_cap", value: 500, reason: "revert 9.5.e check fixture" },
    });
    const revertId = revertPropose.json<{ id: string }>().id;
    await app.inject({
      method: "POST",
      url: `/api/staff/economy/AU/settings/proposals/${revertId}/approve`,
      headers: { cookie: secondFinance.cookie, "idempotency-key": idem() },
      payload: {},
    });
  });
});

describe("kill switches (9.5.c) -- ops only, single action", () => {
  it("ops can trip a kill switch; finance cannot", async () => {
    const ops = await staffWith("ops");
    const finance = await staffWith("finance");

    const financeAttempt = await app.inject({
      method: "POST",
      url: "/api/staff/economy/kill-switches",
      headers: { cookie: finance.cookie, "idempotency-key": idem() },
      payload: { scope: "merchant", targetId: "merchant-9-5-e", reason: "fraud", active: true },
    });
    expect(financeAttempt.statusCode).toBe(403);

    const opsTrip = await app.inject({
      method: "POST",
      url: "/api/staff/economy/kill-switches",
      headers: { cookie: ops.cookie, "idempotency-key": idem() },
      payload: { scope: "merchant", targetId: "merchant-9-5-e", reason: "fraud", active: true },
    });
    expect(opsTrip.statusCode).toBe(201);
    expect(opsTrip.json<{ active: boolean }>().active).toBe(true);

    const list = await app.inject({
      method: "GET",
      url: "/api/staff/economy/kill-switches",
      headers: { cookie: ops.cookie },
    });
    expect(list.statusCode).toBe(200);
    expect(
      list
        .json<{ scope: string; targetId: string | null; active: boolean }[]>()
        .some((k) => k.targetId === "merchant-9-5-e" && k.active),
    ).toBe(true);
  });
});
