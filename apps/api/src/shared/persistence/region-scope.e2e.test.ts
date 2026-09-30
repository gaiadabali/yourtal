import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../testing/session-for";
import { createAppDb } from "./drizzle-client";
import { regionScope } from "./region-scope";

// 13.5.e: Postgres itself hides the other region's rows once a request is
// walled, whatever the query asks for.
let app: NestFastifyApplication;
const db = createAppDb(process.env["DATABASE_URL"] ?? process.env["TEST_DATABASE_URL"] ?? "");

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

async function profileRows(userId: string): Promise<number> {
  const result = await db.execute<{ n: string }>(
    sql`SELECT count(*) AS n FROM identity.user_profile WHERE user_id = ${userId}`,
  );
  return Number(result.rows[0]?.n);
}

describe("region row-level security", () => {
  it("a query in the wrong region returns nothing, and its own region still reads", async () => {
    const au = await sessionFor(app, { jurisdiction: "AU" });

    expect(await regionScope.run({ region: "ID" }, () => profileRows(au.userId))).toBe(0);
    expect(await regionScope.run({ region: "AU" }, () => profileRows(au.userId))).toBe(1);
    // A pooled connection does not keep the last scope's region.
    expect(await profileRows(au.userId)).toBe(1);
  });

  it("a walled write to the other region changes nothing", async () => {
    const au = await sessionFor(app, { jurisdiction: "AU" });
    // Awaited inside the scope: a drizzle query only runs when awaited.
    const updated = await regionScope.run(
      { region: "ID" },
      async () =>
        await db.execute(
          sql`UPDATE identity.user_profile SET display_name = 'moved' WHERE user_id = ${au.userId}`,
        ),
    );
    expect(updated.rowCount).toBe(0);
  });

  it("a signed-in request runs walled to its own region", async () => {
    const au = await sessionFor(app, { jurisdiction: "AU" });
    const me = await app.inject({
      method: "GET",
      url: "/api/me/consents",
      headers: { cookie: au.cookie },
    });
    expect(me.statusCode).toBe(200);
  });
});
