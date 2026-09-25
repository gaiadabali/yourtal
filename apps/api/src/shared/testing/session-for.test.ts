import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "./session-for";

/**
 * 1.3.d — proves `sessionFor` is a real register+login round trip (not a
 * fixture), that its `headers` authorize a live PDP-guarded route exactly
 * like the raw headers `app.boot.test.ts` builds by hand, and that calling
 * it more than `REGISTER_RATE_LIMIT`'s 5-per-hour cap in the same test run
 * does not throttle — the whole reason it randomises `remoteAddress`.
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

describe("sessionFor", () => {
  it("registers and logs in a real, distinct user each call", async () => {
    const a = await sessionFor(app);
    const b = await sessionFor(app);

    expect(a.userId).not.toBe(b.userId);
    expect(a.email).not.toBe(b.email);
    expect(a.token).not.toBe(b.token);
    expect(a.cookie).toBe(`yt_session=${a.token}`);
    expect(a.headers["x-yt-user-id"]).toBe(a.userId);
    expect(a.headers["x-yt-jurisdiction"]).toBe("AU");
  });

  it("its headers authorize a live PDP-guarded route, same as app.boot.test.ts's hand-built ones", async () => {
    const session = await sessionFor(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/businesses",
      headers: { ...session.headers, "idempotency-key": randomUUID() },
      payload: {},
    });
    // Same assertion app.boot.test.ts makes for a signed-in caller: the PDP
    // let the request through. What the use-case does with an empty body
    // (400 on validation) is not this test's concern.
    expect(response.statusCode).not.toBe(403);
  });

  it("a jurisdiction override reaches the compatibility header", async () => {
    const session = await sessionFor(app, { jurisdiction: "ID" });
    expect(session.headers["x-yt-jurisdiction"]).toBe("ID");
  });

  it("survives more calls than REGISTER_RATE_LIMIT's 5-per-IP-per-hour cap", async () => {
    // Sequential on purpose: each call fully completes (register, then
    // login) before the next starts. Running them concurrently would not
    // prove anything different and would just race the same rate-limit
    // counters against each other.
    for (let i = 0; i < 8; i += 1) {
      const session = await sessionFor(app);
      expect(session.userId).toEqual(expect.any(String));
    }
  }, 30_000);
});
