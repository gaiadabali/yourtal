import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";

/**
 * 10.3.b: a real HTTP round trip, with no session at all — F11's "anyone,
 * signed in or not". `LEDGER_MODE=fake` (this suite's default) never
 * computes a real Merkle root, so the meaningful assertion here is the
 * shape and the missing auth requirement, not a specific root.
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

describe("GET /api/proof/roots", () => {
  it("answers with no session and no cookie at all", async () => {
    const response = await app.inject({ method: "GET", url: "/api/proof/roots" });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ roots: unknown[] }>().roots).toEqual([]);
  });
});
