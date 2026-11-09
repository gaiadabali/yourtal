import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import { PublicRoute } from "../authz/authorize.decorator";
import type { AppConfig } from "../../config/app-config";
import {
  NoRateLimit,
  PUBLIC_ROUTE_RATE_LIMIT,
  REGISTER_RATE_LIMIT,
  RateLimit,
} from "./rate-limit.decorator";
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

// Staging test kit K1.2: on staging only, an @example.test sign-up with a valid x-qa-key skips the per-IP limit.
const KEY = "qa-key-for-this-test-only-0123456789abcdef";
describe("register's test-address exemption", () => {
  class Register {
    @RateLimit(REGISTER_RATE_LIMIT)
    @PublicRoute("test")
    register(): void {}
  }

  async function dimensionsFor(
    appEnv: AppConfig["appEnv"] | undefined,
    email: unknown,
    qaKey: string | null = KEY,
  ) {
    const seen: string[][] = [];
    const service = {
      consume: (_subject: unknown, policy: Record<string, unknown>) => {
        seen.push(Object.keys(policy).filter((k) => ["ip", "route", "identity"].includes(k)));
        return Promise.resolve({ blocked: false });
      },
    } as unknown as RateLimitService;
    const guard = new RateLimitGuard(
      new Reflector(),
      service,
      ...(appEnv === undefined ? [] : [{ appEnv, stagingQaKey: KEY }]),
    );
    await guard.canActivate({
      getHandler: () =>
        Object.getOwnPropertyDescriptor(Register.prototype, "register")?.value as unknown,
      getClass: () => Register,
      switchToHttp: () => ({
        getRequest: () => ({
          ip: "203.0.113.9",
          body: { email },
          headers: qaKey === null ? {} : { "x-qa-key": qaKey },
        }),
      }),
    } as unknown as ExecutionContext);
    return seen[0]?.sort();
  }

  it("drops only the per-IP limit for @example.test on staging", async () => {
    expect(await dimensionsFor("staging", "qa+1@example.test")).toEqual(["route"]);
    expect(await dimensionsFor("staging", " QA@Example.TEST ")).toEqual(["route"]);
  });

  it("keeps the per-IP limit for @example.test without the QA key, or with a wrong one (M2)", async () => {
    expect(await dimensionsFor("staging", "qa@example.test", null)).toEqual(["ip", "route"]);
    expect(await dimensionsFor("staging", "qa@example.test", `${KEY}x`)).toEqual(["ip", "route"]);
  });

  it("keeps the per-IP limit for any other address on staging", async () => {
    for (const email of [
      "qa@example.com",
      "qa@example.test.evil.com",
      "qa@sub.example.tester",
      42,
    ]) {
      expect(await dimensionsFor("staging", email)).toEqual(["ip", "route"]);
    }
  });

  it("keeps the per-IP limit off staging, and when no config is wired", async () => {
    for (const appEnv of ["dev", "production", undefined] as const) {
      expect(await dimensionsFor(appEnv, "qa@example.test")).toEqual(["ip", "route"]);
    }
  });
});
