import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { PrincipalService } from "./principal.service";
import type { AppConfig } from "../../config/app-config";

function configFor(nodeEnv: AppConfig["nodeEnv"]): AppConfig {
  return {
    nodeEnv,
    port: 3001,
    pdp: { baseUrl: "http://127.0.0.1:3592", timeoutMs: 500 },
    // Required since YT-0552. These suites do not touch it, but a config
    // object that can omit it would mean the type still permits the
    // fallback this ticket removed.
    databaseUrl: "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
    redisUrl: "redis://127.0.0.1:26379",
    ledger: {
      mode: "fake" as const,
      baseUrl: "http://127.0.0.1:26312",
      voucherBaseUrl: "http://127.0.0.1:26313",
      serviceSecret: "test-only-ledger-service-secret-not-real",
    },
    teenAccounts: false,
  };
}

function requestWith(headers: Record<string, string>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

describe("PrincipalService", () => {
  const service = new PrincipalService(configFor("test"));

  it("resolves an anonymous principal when no user id header is present", () => {
    const principal = service.resolve(requestWith({}));
    expect(principal).toMatchObject({ id: "anonymous", roles: ["anonymous"] });
  });

  it("defaults jurisdiction to ID", () => {
    const principal = service.resolve(requestWith({}));
    expect(principal.attr.jurisdiction).toBe("ID");
  });

  it("resolves a signed-in user with no business roles as plain 'user'", () => {
    const principal = service.resolve(requestWith({ "x-yt-user-id": "user-1" }));
    expect(principal).toMatchObject({ id: "user-1", roles: ["user"] });
  });

  it("adds business_user and the businessRoles map when the header carries one", () => {
    const businessId = "11111111-1111-4111-8111-111111111111";
    const principal = service.resolve(
      requestWith({
        "x-yt-user-id": "owner-1",
        "x-yt-business-roles": JSON.stringify({ [businessId]: "owner" }),
      }),
    );
    expect(principal.roles).toStrictEqual(["user", "business_user"]);
    expect(principal.attr.businessRoles).toStrictEqual({ [businessId]: "owner" });
  });

  it("rejects an unparseable business-roles header rather than silently dropping it", () => {
    expect(() =>
      service.resolve(
        requestWith({ "x-yt-user-id": "owner-1", "x-yt-business-roles": "{not json" }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("rejects a business-roles header with an unknown role value", () => {
    const businessId = "11111111-1111-4111-8111-111111111111";
    expect(() =>
      service.resolve(
        requestWith({
          "x-yt-user-id": "owner-1",
          "x-yt-business-roles": JSON.stringify({ [businessId]: "ceo" }),
        }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it("rejects an unrecognised jurisdiction", () => {
    expect(() => service.resolve(requestWith({ "x-yt-jurisdiction": "US" }))).toThrow(
      UnauthorizedException,
    );
  });
});

describe("the production boot guard", () => {
  // This seam trusts x-yt-user-id verbatim, so anyone could name themselves
  // the owner of any business. The doc comment saying "dev only" is not a
  // control; this is. docs/14 section 8 (A10): fail closed.
  it("refuses to construct in production", () => {
    expect(() => new PrincipalService(configFor("production"))).toThrow(/cannot run in production/);
  });

  it.each(["development", "test"] as const)("constructs in %s", (nodeEnv) => {
    expect(() => new PrincipalService(configFor(nodeEnv))).not.toThrow();
  });
});
