import { HttpException, InternalServerErrorException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { RateLimitService } from "../../shared/rate-limit/rate-limit.service";
import { OidcClientRateLimitGuard } from "./client-rate-limit.guard";
import { VERIFIED_OIDC_CLIENT_KEY } from "./teen-invite-client.guard";
import { TransfersController } from "./transfers.controller";

/** Just enough Valkey for a fixed-window counter. */
function fakeRedis(): Redis {
  const counts = new Map<string, number>();
  return {
    incr: (key: string) => {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return Promise.resolve(n);
    },
    expire: () => Promise.resolve(1),
    ttl: () => Promise.resolve(30),
  } as unknown as Redis;
}

const handler: unknown = Reflect.get(TransfersController.prototype, "create");
const contextFor = (request: object): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
  }) as unknown as ExecutionContext;

const guard = () =>
  new OidcClientRateLimitGuard(new Reflector(), new RateLimitService(fakeRedis()));
const call = (g: OidcClientRateLimitGuard, clientId: string) =>
  g.canActivate(contextFor({ ip: "203.0.113.9", [VERIFIED_OIDC_CLIENT_KEY]: clientId }));

describe("OidcClientRateLimitGuard", () => {
  it("gives each client its own bucket even from one IP", async () => {
    const g = guard();
    for (let i = 0; i < 60; i++) await expect(call(g, "snap-app")).resolves.toBe(true);
    const refused = await call(g, "snap-app").catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getStatus()).toBe(429);
    // Same address, other client: untouched by snap-app's spend.
    await expect(call(g, "other-app")).resolves.toBe(true);
  });

  it("fails loudly when no client was verified first", async () => {
    await expect(guard().canActivate(contextFor({ ip: "203.0.113.9" }))).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
