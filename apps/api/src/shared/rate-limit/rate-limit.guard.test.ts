import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { PublicRoute } from "../authz/authorize.decorator";
import { NoRateLimit, PUBLIC_ROUTE_RATE_LIMIT, RateLimit } from "./rate-limit.decorator";
import { RateLimitGuard } from "./rate-limit.guard";
import type { RateLimitService } from "./rate-limit.service";

// 13.5.a: an anonymous route is never unlimited by omission.
class Routes {
  @PublicRoute("test")
  open(): void {}

  @RateLimit({ routeId: "own", ip: { max: 1, windowSeconds: 60 } })
  @PublicRoute("test")
  declared(): void {}

  @NoRateLimit("test")
  @PublicRoute("test")
  exempt(): void {}

  signedIn(): void {}
}

function contextFor(handler: keyof Routes): ExecutionContext {
  return {
    getHandler: () => Object.getOwnPropertyDescriptor(Routes.prototype, handler)?.value as unknown,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ ip: "203.0.113.9" }) }),
  } as unknown as ExecutionContext;
}

function guardRecording(): { guard: RateLimitGuard; seen: { routeId: string; max?: number }[] } {
  const seen: { routeId: string; max?: number }[] = [];
  const service = {
    consume: (subject: { routeId: string }, policy: { ip?: { max: number } }) => {
      seen.push({ routeId: subject.routeId, ...(policy.ip ? { max: policy.ip.max } : {}) });
      return Promise.resolve({ blocked: false });
    },
  } as unknown as RateLimitService;
  return { guard: new RateLimitGuard(new Reflector(), service), seen };
}

describe("RateLimitGuard defaults", () => {
  it("limits an unannotated public route per IP and per handler", async () => {
    const { guard, seen } = guardRecording();
    await guard.canActivate(contextFor("open"));
    expect(seen).toEqual([{ routeId: "public:Routes.open", max: PUBLIC_ROUTE_RATE_LIMIT.ip?.max }]);
  });

  it("uses a route's own limit when it declares one", async () => {
    const { guard, seen } = guardRecording();
    await guard.canActivate(contextFor("declared"));
    expect(seen).toEqual([{ routeId: "own", max: 1 }]);
  });

  it("leaves @NoRateLimit and signed-in routes to their own controls", async () => {
    const { guard, seen } = guardRecording();
    await guard.canActivate(contextFor("exempt"));
    await guard.canActivate(contextFor("signedIn"));
    expect(seen).toEqual([]);
  });
});
