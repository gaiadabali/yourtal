import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../app.module";
import { sessionFor } from "../../../shared/testing/session-for";
import { grantStaffRole, ownerPool } from "../staff.test-helper";

/**
 * 5.3.c (F118): the invoice_issuer setting is two-person like every economy
 * setting, and a whole company is checked when it is proposed and again when
 * approved: invoices are issued from it, and a half-filled one stops them.
 */
let app: NestFastifyApplication;
let owner: Pool;
const GOOD = {
  legalName: "YourTal Pty Ltd",
  abn: "51824753556",
  address: "1 Example St, Sydney NSW 2000",
  email: "billing@yourtal.example",
};

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  owner = ownerPool();
});

afterAll(async () => {
  // The shared database: leave no approved issuer behind for ID.
  await owner.query(
    `DELETE FROM platform.region_setting WHERE region = 'ID' AND key = 'invoice_issuer'`,
  );
  await owner.end();
  await app.close();
});

async function finance() {
  const session = await sessionFor(app, { jurisdiction: "ID" });
  await grantStaffRole(owner, session.userId, "finance");
  return session;
}

const propose = (cookie: string, value: unknown) =>
  app.inject({
    method: "POST",
    url: "/api/staff/economy/ID/settings/proposals",
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: { key: "invoice_issuer", value, reason: "5.3.c check" },
  });

const approve = (cookie: string, id: string) =>
  app.inject({
    method: "POST",
    url: `/api/staff/economy/ID/settings/proposals/${id}/approve`,
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: {},
  });

describe("invoice_issuer (5.3.c)", () => {
  it("refuses a malformed company when proposed, naming the field, and stores nothing", async () => {
    const staff = await finance();
    const cases: [unknown, string][] = [
      [{ ...GOOD, legalName: "" }, "legalName"],
      [{ ...GOOD, address: "   " }, "address"],
      [{ ...GOOD, email: "billing-at-yourtal" }, "email"],
      [{ ...GOOD, abn: "51824753557" }, "abn"],
      [{ ...GOOD, abn: "5182475355" }, "abn"],
      [{ legalName: GOOD.legalName, address: GOOD.address, email: GOOD.email }, "abn"],
      ["YourTal Pty Ltd", "invoice_issuer"],
    ];
    for (const [value, field] of cases) {
      const refused = await propose(staff.cookie, value);
      expect(refused.statusCode).toBe(400);
      const body = refused.json<{ code: string; message: string }>();
      expect(body.code).toBe("invalid_setting");
      expect(body.message).toContain(field);
    }
    const { rows } = await owner.query(
      `SELECT 1 FROM platform.region_setting
        WHERE key = 'invoice_issuer' AND approved_by IS NULL AND set_by = $1`,
      [staff.userId],
    );
    expect(rows).toHaveLength(0);
  });

  it("checks again at approval, and a whole company with an ABN or none is approved by a second person", async () => {
    const [a, b] = [await finance(), await finance()];
    const slipped = await propose(a.cookie, GOOD);
    expect(slipped.statusCode).toBe(201);
    const id = slipped.json<{ id: string }>().id;
    // The pending row is changed underneath the proposal, as if it had been stored before this check.
    await owner.query(
      `UPDATE platform.region_setting SET value = $2::jsonb
        WHERE id = (SELECT payload->>'ledgerRef' FROM staff.economy_proposal WHERE id = $1)::uuid`,
      [id, JSON.stringify({ ...GOOD, abn: "12345678901" })],
    );
    const refused = await approve(b.cookie, id);
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ code: string }>().code).toBe("invalid_setting");

    const withAbn = await propose(a.cookie, { ...GOOD, abn: "51 824 753 556" });
    expect(withAbn.statusCode).toBe(201);
    expect((await approve(a.cookie, withAbn.json<{ id: string }>().id)).statusCode).toBe(403);
    expect((await approve(b.cookie, withAbn.json<{ id: string }>().id)).statusCode).toBe(201);

    const noAbn = await propose(a.cookie, { ...GOOD, abn: null });
    expect(noAbn.statusCode).toBe(201);
    expect((await approve(b.cookie, noAbn.json<{ id: string }>().id)).statusCode).toBe(201);
  });
});
