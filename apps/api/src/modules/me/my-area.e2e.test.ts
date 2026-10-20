import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";

/**
 * F116 (group 1.6.f/g), end to end: the area list, the viewer's optional "my
 * area", its refusal for a teen, the region wall, and the DSAR export and
 * delete. Own app with TEEN_ACCOUNTS on, as `teen-interests.e2e.test.ts`
 * does, so a teen can register.
 */
let app: NestFastifyApplication;
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
const originalTeenAccounts = process.env["TEEN_ACCOUNTS"];

beforeAll(async () => {
  process.env["TEEN_ACCOUNTS"] = "true";
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  if (originalTeenAccounts === undefined) delete process.env["TEEN_ACCOUNTS"];
  else process.env["TEEN_ACCOUNTS"] = originalTeenAccounts;
});

interface Summary {
  postcode: string;
  names: string[];
  moreCount: number;
  states: string[];
}

function randomTestIp(): string {
  const [a, b, c] = randomBytes(3);
  return `10.${String(a)}.${String(b)}.${String(c)}`;
}

async function registerTeen(): Promise<{ userId: string; cookie: string }> {
  const register = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    remoteAddress: randomTestIp(),
    headers: { "idempotency-key": randomUUID() },
    payload: {
      email: `teen-area+${randomUUID()}@example.test`,
      password: "not-a-real-secret-f116-area",
      region: "AU" as const,
      locale: "en-AU" as const,
      displayName: "Teen Area Test",
      dateOfBirth: "2012-01-01",
      timezone: "Australia/Sydney",
      guardianEmail: `guardian+${randomUUID()}@example.test`,
    },
  });
  expect(register.statusCode).toBeLessThan(300);
  const { userId, token } = register.json<{ userId: string; token: string }>();
  return { userId, cookie: `yt_session=${token}` };
}

describe("GET /api/areas (the fixed list)", () => {
  it("lists the states of a region, then a state's suburbs with their postcodes, to anyone", async () => {
    const states = await app.inject({ method: "GET", url: "/api/areas?region=AU" });
    expect(states.statusCode).toBe(200);
    const body = states.json<{ states: { code: string; placeCount: number }[] }>();
    expect(body.states.map((state) => state.code)).toContain("NSW");

    const nsw = await app.inject({ method: "GET", url: "/api/areas/states/NSW?region=AU" });
    expect(nsw.statusCode).toBe(200);
    expect(nsw.json<{ places: { name: string; postcode: string }[] }>().places).toContainEqual({
      name: "Bondi",
      postcode: "2026",
    });

    const summaries = await app.inject({
      method: "GET",
      url: "/api/areas/summaries?region=AU&postcodes=2026,0800",
    });
    expect(summaries.statusCode).toBe(200);
    const areas = summaries.json<{ areas: Summary[] }>().areas;
    expect(areas.map((area) => area.postcode)).toEqual(["2026", "0800"]);
    expect(areas[0]?.names).toContain("Bondi");
  });

  it("needs a region from a signed-out caller, and walls a signed-in one to their own", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/api/areas" });
    expect(anonymous.statusCode).toBe(400);

    const id = await sessionFor(app, { jurisdiction: "ID" });
    const own = await app.inject({
      method: "GET",
      url: "/api/areas",
      headers: { cookie: id.cookie },
    });
    expect(own.json<{ region: string }>().region).toBe("ID");
    const other = await app.inject({
      method: "GET",
      url: "/api/areas?region=AU",
      headers: { cookie: id.cookie },
    });
    expect(other.statusCode).toBe(403);
  });

  it("refuses an unknown state, region or malformed postcodes", async () => {
    const unknownState = await app.inject({ method: "GET", url: "/api/areas/states/XX?region=AU" });
    expect(unknownState.statusCode).toBe(404);
    const unknownRegion = await app.inject({ method: "GET", url: "/api/areas?region=NZ" });
    expect(unknownRegion.statusCode).toBe(400);
    const malformed = await app.inject({
      method: "GET",
      url: "/api/areas/summaries?region=AU&postcodes=abc",
    });
    expect(malformed.statusCode).toBe(400);
  });
});

describe("/api/me/settings/area (my area)", () => {
  it("is optional, stores the postcode, and the viewer can change and clear it", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const headers = { cookie: session.cookie };

    const none = await app.inject({ method: "GET", url: "/api/me/settings/area", headers });
    expect(none.statusCode).toBe(200);
    expect(none.json<{ area: Summary | null }>().area).toBeNull();

    const set = await app.inject({
      method: "PUT",
      url: "/api/me/settings/area",
      headers,
      payload: { postcode: "2026" },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json<{ area: Summary }>().area).toMatchObject({ postcode: "2026", states: ["NSW"] });

    const rows = await owner.execute<{ region: string; postcode: string }>(
      sql`SELECT region, postcode FROM me.viewer_area WHERE user_id = ${session.userId}`,
    );
    expect(rows.rows).toEqual([{ region: "AU", postcode: "2026" }]);

    const moved = await app.inject({
      method: "PUT",
      url: "/api/me/settings/area",
      headers,
      payload: { postcode: "3000" },
    });
    expect(moved.statusCode).toBe(200);
    const read = await app.inject({ method: "GET", url: "/api/me/settings/area", headers });
    expect(read.json<{ area: Summary }>().area.postcode).toBe("3000");

    const cleared = await app.inject({ method: "DELETE", url: "/api/me/settings/area", headers });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json<{ area: Summary | null }>().area).toBeNull();
    const after = await owner.execute(
      sql`SELECT 1 FROM me.viewer_area WHERE user_id = ${session.userId}`,
    );
    expect(after.rows).toHaveLength(0);
  });

  it.each([["9999"], ["12110"], ["202"], ["Bondi"], [""]])(
    "refuses %j, which is not on the viewer's own region's list",
    async (postcode) => {
      const session = await sessionFor(app, { jurisdiction: "AU" });
      const refused = await app.inject({
        method: "PUT",
        url: "/api/me/settings/area",
        headers: { cookie: session.cookie },
        payload: { postcode },
      });
      expect(refused.statusCode).toBe(400);
      expect(refused.json<{ code: string }>().code).toBe("unknown_area");
    },
  );

  it("walls the region: an Indonesian viewer can pick only an Indonesian area", async () => {
    const session = await sessionFor(app, { jurisdiction: "ID" });
    const headers = { cookie: session.cookie };
    const au = await app.inject({
      method: "PUT",
      url: "/api/me/settings/area",
      headers,
      payload: { postcode: "2026" },
    });
    expect(au.statusCode).toBe(400);
    const id = await app.inject({
      method: "PUT",
      url: "/api/me/settings/area",
      headers,
      payload: { postcode: "12110" },
    });
    expect(id.statusCode).toBe(200);
    const rows = await owner.execute<{ region: string }>(
      sql`SELECT region FROM me.viewer_area WHERE user_id = ${session.userId}`,
    );
    expect(rows.rows).toEqual([{ region: "ID" }]);
  });

  it("clears the area on a DELETE that declares JSON but sends no body (1.6.n)", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const headers = { cookie: session.cookie, "content-type": "application/json" };
    const cleared = await app.inject({ method: "DELETE", url: "/api/me/settings/area", headers });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json<{ area: unknown }>().area).toBeNull();
  });

  it("is refused for a teen on every route, and nothing is stored", async () => {
    const teen = await registerTeen();
    const headers = { cookie: teen.cookie };
    for (const [method, payload] of [
      ["GET", undefined],
      ["PUT", { postcode: "2026" }],
      ["DELETE", undefined],
    ] as const) {
      const response = await app.inject({
        method,
        url: "/api/me/settings/area",
        headers,
        ...(payload === undefined ? {} : { payload }),
      });
      expect(response.statusCode, method).toBe(403);
      expect(response.json<{ code: string }>().code).toBe("area_not_available");
    }
    const rows = await owner.execute(
      sql`SELECT 1 FROM me.viewer_area WHERE user_id = ${teen.userId}`,
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("is refused without a session", async () => {
    const response = await app.inject({ method: "GET", url: "/api/me/settings/area" });
    expect(response.statusCode).toBe(401);
  });
});

describe("DSAR: my area is exported and deleted", () => {
  it("is in the data export, and DELETE /api/me erases it", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const headers = { cookie: session.cookie };
    await app.inject({
      method: "PUT",
      url: "/api/me/settings/area",
      headers,
      payload: { postcode: "2010" },
    });

    const exported = await app.inject({ method: "GET", url: "/api/me/data-export", headers });
    expect(exported.statusCode).toBe(200);
    expect(exported.json<{ declaredArea: { postcode: string } | null }>().declaredArea).toEqual({
      postcode: "2010",
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { ...headers, "idempotency-key": randomUUID() },
    });
    expect(deleted.statusCode).toBe(200);
    const rows = await owner.execute(
      sql`SELECT 1 FROM me.viewer_area WHERE user_id = ${session.userId}`,
    );
    expect(rows.rows).toHaveLength(0);
  });

  it("exports null for a viewer who never set one", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const exported = await app.inject({
      method: "GET",
      url: "/api/me/data-export",
      headers: { cookie: session.cookie },
    });
    expect(exported.json<{ declaredArea: unknown }>().declaredArea).toBeNull();
  });
});
