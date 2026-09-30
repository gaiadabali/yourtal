import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import { grantStaffRole, ownerPool } from "../staff/staff.test-helper";

/**
 * 13.21 over HTTP: apply through the simulated KYB check, ops approve or
 * reject with a reason and an audit event, only approved charities list,
 * each region sees only its own, and only members read the console.
 */
let app: NestFastifyApplication;
const pool = ownerPool();
const originalTeen = process.env["TEEN_ACCOUNTS"];

beforeAll(async () => {
  process.env["TEEN_ACCOUNTS"] = "true";
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  await pool.end();
  if (originalTeen === undefined) delete process.env["TEEN_ACCOUNTS"];
  else process.env["TEEN_ACCOUNTS"] = originalTeen;
});

const AU_REGISTRATION = { kind: "au_acnc", abn: "51824753556", acncRegistered: true };
const ID_REGISTRATION = {
  kind: "id_yayasan",
  deedNumber: "AHU-0012",
  fundraisingPermitNumber: "PUB-77",
};

function application(region: "AU" | "ID", overrides: Record<string, unknown> = {}) {
  return {
    name: `Harbour Kids ${randomUUID().slice(0, 6)}`,
    region,
    cause: "children_youth",
    summary: "Breakfast programmes in local schools.",
    registration: region === "AU" ? AU_REGISTRATION : ID_REGISTRATION,
    payoutAccount: {
      accountName: "Harbour Kids Ltd",
      bankCode: "062000",
      accountNumber: "12345678",
    },
    ...overrides,
  };
}

async function apply(cookie: string, body: unknown) {
  return app.inject({
    method: "POST",
    url: "/api/charities/applications",
    headers: { cookie, "idempotency-key": `test-${randomUUID()}` },
    payload: body as Record<string, unknown>,
  });
}

async function listed(region: "AU" | "ID", cookie?: string) {
  const response = await app.inject({
    method: "GET",
    url: cookie === undefined ? `/api/charities?region=${region}` : "/api/charities",
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });
  return response.json<{ charities: { id: string }[] }>().charities.map((c) => c.id);
}

async function opsSession() {
  const ops = await sessionFor(app, { jurisdiction: "AU" });
  await grantStaffRole(pool, ops.userId, "ops");
  return ops;
}

describe("13.21: the charity registry", () => {
  it("an adult applies; ops approve with a reason; it lists in its region only; its member reads the console", async () => {
    const applicant = await sessionFor(app, { jurisdiction: "AU" });
    const created = await apply(applicant.cookie, application("AU"));
    expect(created.statusCode).toBe(201);
    const charity = created.json<{ id: string; state: string; payoutAccountLast4: string }>();
    expect(charity.state).toBe("pending");
    expect(charity.payoutAccountLast4).toBe("5678");
    expect(JSON.stringify(created.json())).not.toContain("12345678");
    expect(await listed("AU")).not.toContain(charity.id);

    const ops = await opsSession();
    const noReason = await app.inject({
      method: "POST",
      url: `/api/staff/charities/${charity.id}/decision`,
      headers: { cookie: ops.cookie },
      payload: { decision: "approve", reason: "" },
    });
    expect(noReason.statusCode).toBe(403);
    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/charities/${charity.id}/decision`,
      headers: { cookie: ops.cookie },
      payload: { decision: "approve", reason: "ACNC register checked" },
    });
    expect(approved.statusCode).toBe(201);
    expect(approved.json<{ state: string }>().state).toBe("approved");

    const again = await app.inject({
      method: "POST",
      url: `/api/staff/charities/${charity.id}/decision`,
      headers: { cookie: ops.cookie },
      payload: { decision: "reject", reason: "second try" },
    });
    expect(again.statusCode).toBe(409);

    const audit = await pool.query(
      `SELECT action, reason, target_id FROM staff.audit_event
        WHERE target_kind = 'charity' AND target_id = $1 AND outcome = 'succeeded'`,
      [charity.id],
    );
    expect(audit.rows).toEqual([
      { action: "charity.decide", reason: "ACNC register checked", target_id: charity.id },
    ]);
    const decisions = await pool.query(
      `SELECT decision FROM charity.decision WHERE charity_id = $1`,
      [charity.id],
    );
    expect(decisions.rows).toEqual([{ decision: "approve" }]);

    expect(await listed("AU")).toContain(charity.id);
    expect(await listed("ID")).not.toContain(charity.id);
    const idViewer = await sessionFor(app, { jurisdiction: "ID" });
    expect(await listed("AU", idViewer.cookie)).not.toContain(charity.id);

    const console = await app.inject({
      method: "GET",
      url: `/api/charities/${charity.id}/console`,
      headers: { cookie: applicant.cookie },
    });
    expect(console.statusCode).toBe(200);
    expect(console.json()).toMatchObject({ proceeds: [], statements: [] });
    expect(JSON.stringify(console.json())).not.toMatch(/balance/i);
    const stranger = await sessionFor(app, { jurisdiction: "AU" });
    const refused = await app.inject({
      method: "GET",
      url: `/api/charities/${charity.id}/console`,
      headers: { cookie: stranger.cookie },
    });
    expect(refused.statusCode).toBe(403);
  });

  it("a rejection records its reason and never lists", async () => {
    const applicant = await sessionFor(app, { jurisdiction: "ID" });
    const created = await apply(applicant.cookie, application("ID"));
    expect(created.statusCode).toBe(201);
    const { id } = created.json<{ id: string }>();
    const ops = await opsSession();
    const rejected = await app.inject({
      method: "POST",
      url: `/api/staff/charities/${id}/decision`,
      headers: { cookie: ops.cookie },
      payload: { decision: "reject", reason: "Fundraising permit has lapsed" },
    });
    expect(rejected.json()).toMatchObject({
      state: "rejected",
      rejectionReason: "Fundraising permit has lapsed",
    });
    expect(await listed("ID")).not.toContain(id);
    const mine = await app.inject({
      method: "GET",
      url: "/api/me/charities",
      headers: { cookie: applicant.cookie },
    });
    expect(mine.json<{ charities: { id: string }[] }>().charities.map((c) => c.id)).toEqual([id]);
  });

  it("refuses a failed KYB check, a region mismatch, another region's application and a teen", async () => {
    const adult = await sessionFor(app, { jurisdiction: "AU" });
    const badAbn = await apply(
      adult.cookie,
      application("AU", { registration: { ...AU_REGISTRATION, abn: "12345678901" } }),
    );
    expect(badAbn.statusCode).toBe(422);
    const badAccount = await apply(
      adult.cookie,
      application("AU", {
        payoutAccount: { accountName: "X Ltd", bankCode: "062000", accountNumber: "11110000" },
      }),
    );
    expect(badAccount.json<{ code: string }>().code).toBe("kyb_account_refused");
    const mismatch = await apply(adult.cookie, {
      ...application("AU"),
      registration: ID_REGISTRATION,
    });
    expect(mismatch.statusCode).toBe(400);
    expect((await apply(adult.cookie, application("ID"))).statusCode).toBe(403);

    const teen = await sessionFor(app, {
      jurisdiction: "AU",
      dateOfBirth: "2011-05-01",
      guardianEmail: "guardian@example.test",
    });
    expect((await apply(teen.cookie, application("AU"))).statusCode).toBe(403);

    const viewer = await sessionFor(app, { jurisdiction: "AU" });
    const staffList = await app.inject({
      method: "GET",
      url: "/api/staff/charities",
      headers: { cookie: viewer.cookie },
    });
    expect(staffList.statusCode).toBe(403);
  });
});
