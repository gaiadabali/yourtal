import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import { grantStaffRole, ownerPool, suspendAccount } from "./staff.test-helper";

/**
 * TASKS.md 9.1.b's Check, API half, over the real stack: real sessions,
 * Postgres and Cerbos. A non-staff account gets 403 and no session gets 401.
 */
let app: NestFastifyApplication;
let owner: Pool;

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

async function getStaffMe(cookie?: string) {
  return app.inject({
    method: "GET",
    url: "/api/staff/me",
    headers: cookie === undefined ? {} : { cookie },
  });
}

describe("GET /api/staff/me", () => {
  it("gives no session 401", async () => {
    const response = await getStaffMe();
    expect(response.statusCode).toBe(401);
  });

  it("gives a signed-in viewer with no staff role 403", async () => {
    const viewer = await sessionFor(app, { jurisdiction: "AU" });
    const response = await getStaffMe(viewer.cookie);
    expect(response.statusCode).toBe(403);
  });

  it("gives a break-glass admin with no working role 403", async () => {
    const admin = await sessionFor(app);
    await grantStaffRole(owner, admin.userId, "admin");
    const response = await getStaffMe(admin.cookie);
    expect(response.statusCode).toBe(403);
  });

  it("gives a suspended staff account 403", async () => {
    const support = await sessionFor(app);
    await grantStaffRole(owner, support.userId, "support");
    await suspendAccount(owner, support.userId);
    const response = await getStaffMe(support.cookie);
    expect(response.statusCode).toBe(403);
  });

  it("returns a staff member's own roles, email and region", async () => {
    const staff = await sessionFor(app, { jurisdiction: "ID" });
    await grantStaffRole(owner, staff.userId, "finance");
    await grantStaffRole(owner, staff.userId, "ops");
    const response = await getStaffMe(staff.cookie);
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      userId: string;
      email: string;
      roles: string[];
      region: string;
    }>();
    expect(body.userId).toBe(staff.userId);
    expect(body.email).toBe(staff.email);
    expect([...body.roles].sort()).toEqual(["finance", "ops"]);
    expect(body.region).toBe("ID");
  });
});
