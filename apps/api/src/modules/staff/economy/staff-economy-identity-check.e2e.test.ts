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
 * F126: `points_identity_check` is a two-person economy setting like the
 * others, seeded off in both regions, and only `{"enabled": boolean}` may be
 * proposed or approved.
 */
let app: NestFastifyApplication;
let owner: Pool;
type Session = Awaited<ReturnType<typeof sessionFor>>;
let first: Session;
let second: Session;

async function finance() {
  const session = await sessionFor(app, { jurisdiction: "ID" });
  await grantStaffRole(owner, session.userId, "finance");
  return session;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  owner = ownerPool();
  [first, second] = [await finance(), await finance()];
});

afterAll(async () => {
  // The shared database: put ID back to the seeded "off".
  await owner.query(
    `DELETE FROM platform.region_setting
      WHERE region = 'ID' AND key = 'points_identity_check' AND set_by = ANY($1)`,
    [[first.userId, second.userId]],
  );
  await owner.end();
  await app.close();
});

const propose = (cookie: string, value: unknown) =>
  app.inject({
    method: "POST",
    url: "/api/staff/economy/ID/settings/proposals",
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: { key: "points_identity_check", value, reason: "F126 check" },
  });

const approve = (cookie: string, id: string) =>
  app.inject({
    method: "POST",
    url: `/api/staff/economy/ID/settings/proposals/${id}/approve`,
    headers: { cookie, "idempotency-key": randomUUID() },
    payload: {},
  });

async function current(cookie: string): Promise<unknown> {
  const screen = await app.inject({
    method: "GET",
    url: "/api/staff/economy/ID/settings",
    headers: { cookie },
  });
  expect(screen.statusCode).toBe(200);
  const body = screen.json<{ current: { key: string; value: unknown }[] }>();
  return body.current.find((row) => row.key === "points_identity_check")?.value;
}

describe("points_identity_check (F126)", () => {
  it("is seeded off, so the console shows it", async () => {
    expect(await current(first.cookie)).toEqual({ enabled: false });
  });

  it("refuses anything but {enabled: boolean} when proposed, and stores nothing", async () => {
    for (const value of [true, "on", {}, { enabled: "yes" }, { enabled: true, regions: ["ID"] }]) {
      const refused = await propose(first.cookie, value);
      expect(refused.statusCode).toBe(400);
      const body = refused.json<{ code: string; message: string }>();
      expect(body.code).toBe("invalid_setting");
      expect(body.message).toContain("points_identity_check");
    }
    const { rows } = await owner.query(
      `SELECT 1 FROM platform.region_setting
        WHERE key = 'points_identity_check' AND approved_by IS NULL AND set_by = $1`,
      [first.userId],
    );
    expect(rows).toHaveLength(0);
  });

  it("checks again at approval, and a second person switches it on", async () => {
    const slipped = await propose(first.cookie, { enabled: true });
    expect(slipped.statusCode).toBe(201);
    const id = slipped.json<{ id: string }>().id;
    await owner.query(
      `UPDATE platform.region_setting SET value = '"on"'::jsonb
        WHERE id = (SELECT payload->>'ledgerRef' FROM staff.economy_proposal WHERE id = $1)::uuid`,
      [id],
    );
    const refused = await approve(second.cookie, id);
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ code: string }>().code).toBe("invalid_setting");

    const on = await propose(first.cookie, { enabled: true });
    expect(on.statusCode).toBe(201);
    const onId = on.json<{ id: string }>().id;
    expect((await approve(first.cookie, onId)).statusCode).toBe(403);
    expect((await approve(second.cookie, onId)).statusCode).toBe(201);
    expect(await current(first.cookie)).toEqual({ enabled: true });
  });
});
