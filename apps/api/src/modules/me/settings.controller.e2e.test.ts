import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";

/**
 * 6.7.a, end to end: the real app, real Postgres, this worktree's own
 * Cerbos (`me` policy's new `view_settings`/`update_settings` actions —
 * 5.4.d's own note applies here too).
 */
let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET/PUT /api/me/settings/autoplay", () => {
  it("defaults to the region's own default before any write (AU -> always)", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const response = await app.inject({
      method: "GET",
      url: "/api/me/settings/autoplay",
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ autoplay: string }>().autoplay).toBe("always");
  });

  it("defaults to wifi_only in ID before any write", async () => {
    const session = await sessionFor(app, { jurisdiction: "ID" });
    const response = await app.inject({
      method: "GET",
      url: "/api/me/settings/autoplay",
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ autoplay: string }>().autoplay).toBe("wifi_only");
  });

  it("persists a write and reads it back, overriding the region default", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });

    const write = await app.inject({
      method: "PUT",
      url: "/api/me/settings/autoplay",
      headers: { cookie: session.cookie },
      payload: { autoplay: "never" },
    });
    expect(write.statusCode).toBe(200);
    expect(write.json<{ autoplay: string }>().autoplay).toBe("never");

    const read = await app.inject({
      method: "GET",
      url: "/api/me/settings/autoplay",
      headers: { cookie: session.cookie },
    });
    expect(read.json<{ autoplay: string }>().autoplay).toBe("never");
  });

  it("rejects an out-of-enum value", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const response = await app.inject({
      method: "PUT",
      url: "/api/me/settings/autoplay",
      headers: { cookie: session.cookie },
      payload: { autoplay: "sometimes" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("refuses an anonymous caller with 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/me/settings/autoplay" });
    expect(response.statusCode).toBe(401);
  });
});
