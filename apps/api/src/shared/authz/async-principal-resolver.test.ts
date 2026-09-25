import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { AsyncPrincipalResolver } from "./async-principal-resolver";
import { PrincipalService } from "./principal.service";
import type { AppConfig } from "../../config/app-config";
import type {
  PrincipalSecurityState,
  PrincipalSecurityStateRepository,
} from "../../modules/identity/persistence/principal-security-state.repository";

function configFor(nodeEnv: AppConfig["nodeEnv"]): AppConfig {
  return {
    nodeEnv,
    port: 3001,
    pdp: { baseUrl: "http://127.0.0.1:3592", timeoutMs: 500 },
    databaseUrl: "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
    redisUrl: "redis://127.0.0.1:26379",
    ledger: {
      mode: "fake" as const,
      baseUrl: "http://127.0.0.1:26312",
      voucherBaseUrl: "http://127.0.0.1:26313",
    },
    teenAccounts: false,
  };
}

function requestWith(headers: Record<string, string>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

/** A fake `identity.principal_security_state` — no rows unless seeded. */
function fakeSecurityStateRepo(
  rows: Record<string, PrincipalSecurityState> = {},
): PrincipalSecurityStateRepository {
  return {
    findByUserId: (userId) => Promise.resolve(rows[userId] ?? null),
  };
}

function resolverWith(rows: Record<string, PrincipalSecurityState> = {}): AsyncPrincipalResolver {
  return new AsyncPrincipalResolver(
    new PrincipalService(configFor("test")),
    fakeSecurityStateRepo(rows),
  );
}

describe("AsyncPrincipalResolver — YT-0582", () => {
  // The bug this whole ticket is about: a real principal, shaped exactly as
  // PrincipalService.resolve() produces it, must come back frozen when
  // stored state says so, and unfrozen when it does not — proved at this
  // seam directly, not only through a hand-built policy-test fixture.
  it("carries no valueFrozenUntil when the user has no security-state row", async () => {
    const resolver = resolverWith();
    const principal = await resolver.resolve(requestWith({ "x-yt-user-id": "wina" }));
    expect(principal.attr.valueFrozenUntil).toBeUndefined();
  });

  it("carries no valueFrozenUntil when the row exists but is null", async () => {
    const resolver = resolverWith({ wina: { valueFrozenUntil: null } });
    const principal = await resolver.resolve(requestWith({ "x-yt-user-id": "wina" }));
    expect(principal.attr.valueFrozenUntil).toBeUndefined();
  });

  it("carries valueFrozenUntil as an RFC3339 string when stored state has one", async () => {
    const frozenUntil = new Date("2026-09-24T10:00:00.000Z");
    const resolver = resolverWith({ wina: { valueFrozenUntil: frozenUntil } });
    const principal = await resolver.resolve(requestWith({ "x-yt-user-id": "wina" }));
    expect(principal.attr.valueFrozenUntil).toBe("2026-09-24T10:00:00.000Z");
  });

  it("never looks up security state for an anonymous principal", async () => {
    let called = false;
    const repo: PrincipalSecurityStateRepository = {
      findByUserId: () => {
        called = true;
        return Promise.resolve(null);
      },
    };
    const resolver = new AsyncPrincipalResolver(new PrincipalService(configFor("test")), repo);
    const principal = await resolver.resolve(requestWith({}));
    expect(principal.id).toBe("anonymous");
    expect(called).toBe(false);
  });

  it("still rejects a malformed header before ever reaching the database", async () => {
    const resolver = resolverWith();
    await expect(
      resolver.resolve(
        requestWith({ "x-yt-user-id": "owner-1", "x-yt-business-roles": "{not json" }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });
});
