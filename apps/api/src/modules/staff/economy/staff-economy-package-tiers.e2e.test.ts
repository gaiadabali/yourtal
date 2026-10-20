import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../../app.module";
import { LEDGER_INTERNAL_CLIENT } from "../../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import { sessionFor } from "../../../shared/testing/session-for";
import { grantStaffRole, ownerPool } from "../staff.test-helper";

/**
 * 14.13 (F122, F12): the point_package_tiers setting is two-person like every
 * economy setting, and checked when proposed and again when approved: its
 * shape here, its B floor by the ledger (fake mode), which never shares B.
 */
let app: NestFastifyApplication;
let owner: Pool;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
const F122 = [
  { key: "starter", points: 1_000, discountBps: 0 },
  { key: "grow", points: 10_000, discountBps: 500 },
  { key: "scale", points: 50_000, discountBps: 1_000 },
];

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

async function finance() {
  const session = await sessionFor(app, { jurisdiction: "ID" });
  await grantStaffRole(owner, session.userId, "finance");
  return session;
}

function propose(cookie: string, value: unknown) {
  return app.inject({
    method: "POST",
    url: "/api/staff/economy/ID/settings/proposals",
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: { key: "point_package_tiers", value, reason: "14.13 check" },
  });
}

function approve(cookie: string, id: string) {
  return app.inject({
    method: "POST",
    url: `/api/staff/economy/ID/settings/proposals/${id}/approve`,
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: {},
  });
}

async function proposeAndApprove(value: unknown) {
  const [a, b] = [await finance(), await finance()];
  const proposed = await propose(a.cookie, value);
  expect(proposed.statusCode).toBe(201);
  return approve(b.cookie, proposed.json<{ id: string }>().id);
}

describe("point_package_tiers (14.13)", () => {
  it("refuses a malformed catalogue, and one priced under B, when proposed", async () => {
    const staff = await finance();
    for (const value of [
      [{ key: "grow", points: 10_500, discountBps: 500 }],
      [
        { key: "grow", points: 10_000, discountBps: 500 },
        { key: "grow", points: 20_000, discountBps: 600 },
      ],
      [{ key: "grow", points: 10_000, discountBps: 6_000 }],
      // 40% off IDR 9 a point is IDR 5.40, under B = IDR 6 (K6).
      [{ key: "deep", points: 10_000, discountBps: 4_000 }],
    ]) {
      const refused = await propose(staff.cookie, value);
      expect(refused.statusCode).toBe(400);
      expect(refused.json<{ code: string }>().code).toBe("invalid_setting");
    }
    const { rows } = await db.execute(sql`
      SELECT 1 FROM platform.region_setting
       WHERE key = 'point_package_tiers' AND approved_by IS NULL AND set_by = ${staff.userId}`);
    expect(rows).toHaveLength(0);
  });

  it("checks again at approval, and an approved catalogue is what Studio is sold", async () => {
    // A proposal that slipped past the propose check is still refused at approval.
    const [a, b] = [await finance(), await finance()];
    const slipped = await propose(a.cookie, F122);
    expect(slipped.statusCode).toBe(201);
    const id = slipped.json<{ id: string }>().id;
    // The pending row's value is changed underneath it, as if it had been stored before this check.
    await owner.query(
      `UPDATE platform.region_setting SET value = $2::jsonb
        WHERE id = (SELECT payload->>'ledgerRef' FROM staff.economy_proposal WHERE id = $1)::uuid`,
      [id, JSON.stringify([{ key: "deep", points: 10_000, discountBps: 4_000 }])],
    );
    const refused = await approve(b.cookie, id);
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ code: string }>().code).toBe("invalid_setting");

    // A fourth tier, approved: the ledger now sells it, 15% off IDR 9 is IDR 7.65 a point.
    const withBulk = [...F122, { key: "bulk", points: 100_000, discountBps: 1_500 }];
    expect((await proposeAndApprove(withBulk)).statusCode).toBe(201);
    const ledger: LedgerInternalClient = app.get(LEDGER_INTERNAL_CLIENT, { strict: false });
    const onSale = (await ledger.packageTiers("ID"))._unsafeUnwrap();
    expect(onSale.find((tier) => tier.tierKey === "bulk")?.totalMinor).toBe(765_000);
    // Shared database: put F122 back for every other suite.
    expect((await proposeAndApprove(F122)).statusCode).toBe(201);
  });
});
