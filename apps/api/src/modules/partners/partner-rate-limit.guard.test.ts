import { HttpException, InternalServerErrorException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type {
  RateLimitService,
  RateLimitSubject,
} from "../../shared/rate-limit/rate-limit.service";
import { VERIFIED_PARTNER_REQUEST_KEY } from "./partner-auth";
import { PARTNER_RATE_LIMIT, PartnerRateLimitGuard } from "./partner-rate-limit.guard";

function contextFor(request: object): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function guardWith(blocked: boolean) {
  const seen: { subject: RateLimitSubject; policy: unknown }[] = [];
  const service = {
    consume: (subject: RateLimitSubject, policy: unknown) => {
      seen.push({ subject, policy });
      return Promise.resolve(blocked ? { blocked, retryAfterSeconds: 7 } : { blocked });
    },
  } as unknown as RateLimitService;
  return { guard: new PartnerRateLimitGuard(service), seen };
}

describe("PartnerRateLimitGuard", () => {
  it("keys on the verified partner id, shared across routes, and counts per partner only", async () => {
    const { guard, seen } = guardWith(false);
    const request = {
      ip: "203.0.113.9",
      [VERIFIED_PARTNER_REQUEST_KEY]: "snap-app",
      // Whatever the caller sends must not matter.
      body: { partnerId: "someone-else" },
      headers: { "x-partner-id": "someone-else" },
    };
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(seen).toEqual([
      {
        subject: { routeId: "partners.all", ip: "203.0.113.9", identityId: "snap-app" },
        policy: PARTNER_RATE_LIMIT,
      },
    ]);
    expect(PARTNER_RATE_LIMIT).toEqual({ identity: { max: 1200, windowSeconds: 60 } });
  });

  it("refuses with the same 429 body as the per-IP limit", async () => {
    const { guard } = guardWith(true);
    const refused = await guard
      .canActivate(contextFor({ ip: "203.0.113.9", [VERIFIED_PARTNER_REQUEST_KEY]: "snap-app" }))
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(HttpException);
    expect((refused as HttpException).getStatus()).toBe(429);
    expect((refused as HttpException).getResponse()).toEqual({
      statusCode: 429,
      error: "Too Many Requests",
      message: "Too many requests. Try again later.",
      retryAfterSeconds: 7,
    });
  });

  it("fails loudly when no partner was verified first", async () => {
    const { guard, seen } = guardWith(false);
    await expect(guard.canActivate(contextFor({ ip: "203.0.113.9" }))).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(seen).toEqual([]);
  });
});
