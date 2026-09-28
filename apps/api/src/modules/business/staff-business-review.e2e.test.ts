import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import { grantStaffRole, ownerPool } from "../staff/staff.test-helper";
import { createBusinessDb } from "./persistence/drizzle-client";
import type { BusinessDb } from "./persistence/drizzle-client";

/**
 * TASKS.md 9.3.a's Check (the half that does not need 7.3): a real HTTP
 * round trip against real Postgres and real Cerbos -- a business created
 * through the real `POST /api/businesses`, an `ops` staff member reviewing
 * its KYB and suspending/reinstating it, each producing the real database
 * row and a `staff.audit_event` row.
 */
let app: NestFastifyApplication;
let db: BusinessDb;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  db = createBusinessDb(process.env["DATABASE_URL"] ?? "");
});

afterAll(async () => {
  await app.close();
});

async function createBusiness(ownerCookie: string, region: "AU" | "ID" = "AU") {
  const handle = `test-9-3-a-${randomUUID().slice(0, 8)}`;
  const created = await app.inject({
    method: "POST",
    url: "/api/businesses",
    headers: { cookie: ownerCookie, "idempotency-key": randomUUID() },
    payload: {
      legalName: `9.3.a Test Co ${handle}`,
      displayName: "9.3.a Test Business",
      taxIdKind: "ABN",
      taxIdValue: "12345678901",
      addressState: "NSW",
      addressPostcode: "2000",
      roles: ["advertiser"],
      region,
      handle,
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  return { businessId: created.json<{ business: { id: string } }>().business.id, handle };
}

/**
 * Seeds one `submitted` KYB document directly -- the presigned-upload round
 * trip is 7.1.b's own test, not this one's; this test is about what staff
 * does with a document that already exists.
 */
async function seedSubmittedDocument(businessId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO business.kyb_documents (business_id, document_type, storage_ref, status)
    VALUES (${businessId}, 'business_registration_certificate', 'kms://kyb/test', 'submitted')
  `);
}

async function opsStaff() {
  const staff = await sessionFor(app, { jurisdiction: "AU" });
  await grantStaffRole(ownerPool(), staff.userId, "ops");
  return staff;
}

async function auditRowsFor(action: string, targetId: string) {
  const owner = ownerPool();
  const { rows } = await owner.query(
    `SELECT action, outcome, reason, target_id FROM staff.audit_event WHERE action = $1 AND target_id = $2`,
    [action, targetId],
  );
  await owner.end();
  return rows as Array<{ action: string; outcome: string; reason: string | null; target_id: string }>;
}

describe("9.3.a: staff KYB review", () => {
  it("an ops staffer approves a business's KYB: is_verified flips and its documents are verified", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const staff = await opsStaff();
    const { businessId } = await createBusiness(owner.cookie);
    await seedSubmittedDocument(businessId);

    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/businesses/${businessId}/kyb/approve`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "documents check out" },
    });
    expect(approved.statusCode, approved.body).toBe(201);
    const body = approved.json<{
      isVerified: boolean;
      kybDocuments: Array<{ status: string; verifiedByUserId: string | null }>;
    }>();
    expect(body.isVerified).toBe(true);
    expect(body.kybDocuments).toHaveLength(1);
    expect(body.kybDocuments[0]).toMatchObject({ status: "verified", verifiedByUserId: staff.userId });

    const audit = await auditRowsFor("business.kyb.approve", businessId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ outcome: "succeeded", reason: "documents check out" });
  });

  it("an ops staffer rejects a business's KYB: is_verified stays false and the document is rejected", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const staff = await opsStaff();
    const { businessId } = await createBusiness(owner.cookie);
    await seedSubmittedDocument(businessId);

    const rejected = await app.inject({
      method: "POST",
      url: `/api/staff/businesses/${businessId}/kyb/reject`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "expired registration certificate" },
    });
    expect(rejected.statusCode, rejected.body).toBe(201);
    const body = rejected.json<{
      isVerified: boolean;
      kybDocuments: Array<{ status: string }>;
    }>();
    expect(body.isVerified).toBe(false);
    expect(body.kybDocuments[0]?.status).toBe("rejected");
  });

  // "reason" required is enforced by `staffReasonSchema` (packages/contracts/
  // src/staff/businesses.test.ts) through the global `ZodValidationPipe` —
  // wired in `main.ts`'s `bootstrap()`, which this file's `Test.createTestingModule`
  // harness does not run, the same way every other e2e suite in this module
  // does not re-prove pipe wiring per route.

  it("a non-ops staffer cannot review KYB or suspend a business", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const support = await sessionFor(app, { jurisdiction: "AU" });
    await grantStaffRole(ownerPool(), support.userId, "support");
    const { businessId } = await createBusiness(owner.cookie);
    await seedSubmittedDocument(businessId);

    const approved = await app.inject({
      method: "POST",
      url: `/api/staff/businesses/${businessId}/kyb/approve`,
      headers: { cookie: support.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "trying anyway" },
    });
    expect(approved.statusCode).toBe(403);

    const suspended = await app.inject({
      method: "POST",
      url: `/api/staff/businesses/${businessId}/suspend`,
      headers: { cookie: support.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "trying anyway" },
    });
    expect(suspended.statusCode).toBe(403);
  });
});

describe("9.3.a: staff business suspension", () => {
  it("an ops staffer suspends then reinstates a business", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const staff = await opsStaff();
    const { businessId } = await createBusiness(owner.cookie);

    const suspended = await app.inject({
      method: "POST",
      url: `/api/staff/businesses/${businessId}/suspend`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "fraudulent listings reported" },
    });
    expect(suspended.statusCode, suspended.body).toBe(201);
    const suspendedBody = suspended.json<{ suspendedAt: string | null; suspendedReason: string | null }>();
    expect(suspendedBody.suspendedAt).not.toBeNull();
    expect(suspendedBody.suspendedReason).toBe("fraudulent listings reported");

    const detail = await app.inject({
      method: "GET",
      url: `/api/staff/businesses/${businessId}`,
      headers: { cookie: staff.cookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ suspendedAt: string | null }>().suspendedAt).not.toBeNull();

    const reinstated = await app.inject({
      method: "POST",
      url: `/api/staff/businesses/${businessId}/reinstate`,
      headers: { cookie: staff.cookie, "idempotency-key": randomUUID() },
      payload: { reason: "appeal upheld" },
    });
    expect(reinstated.statusCode, reinstated.body).toBe(201);
    expect(reinstated.json<{ suspendedAt: string | null }>().suspendedAt).toBeNull();

    const audit = await auditRowsFor("business.suspend", businessId);
    expect(audit[0]).toMatchObject({ outcome: "succeeded", reason: "fraudulent listings reported" });
  });

  it("lists and searches businesses for staff", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const staff = await opsStaff();
    const { businessId, handle } = await createBusiness(owner.cookie);

    const list = await app.inject({
      method: "GET",
      url: `/api/staff/businesses?search=${handle}`,
      headers: { cookie: staff.cookie },
    });
    expect(list.statusCode, list.body).toBe(200);
    const body = list.json<{ businesses: Array<{ id: string }>; total: number }>();
    expect(body.businesses.map((b) => b.id)).toContain(businessId);
  });
});
