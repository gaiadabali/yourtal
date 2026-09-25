import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { errAsync, okAsync } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import { PdpGuard } from "./pdp.guard";
import { AsyncPrincipalResolver } from "./async-principal-resolver";
import { PrincipalService } from "./principal.service";
import { AUTHORIZE_METADATA, PUBLIC_ROUTE_METADATA } from "./authorize.decorator";
import type { AppConfig } from "../../config/app-config";
import type { PrincipalSecurityStateRepository } from "../../modules/identity/persistence/principal-security-state.repository";

// No security-state rows in this suite — nothing here exercises the freeze,
// only that a principal reaches the PDP at all.
// async-principal-resolver.test.ts covers the freeze itself.
const NO_SECURITY_STATE: PrincipalSecurityStateRepository = {
  findByUserId: () => Promise.resolve(null),
};

/**
 * That a declared route is actually enforced. `authorized-routes.test.ts`
 * proves the declaration exists; this proves it does something, and that an
 * UNDECLARED route is refused rather than waved through.
 */

const CONFIG: AppConfig = {
  nodeEnv: "test",
  port: 3001,
  pdp: { baseUrl: "http://127.0.0.1:26592", timeoutMs: 500 },
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

let requireAction: ReturnType<typeof vi.fn>;
let pdp: PdpClient;

beforeEach(() => {
  requireAction = vi.fn(() => okAsync(undefined));
  pdp = { requireAction, checkResource: vi.fn() } as unknown as PdpClient;
});

function guardWith(metadata: Record<string, unknown>): PdpGuard {
  const reflector = new Reflector();
  vi.spyOn(reflector, "get").mockImplementation((key: unknown) =>
    typeof key === "string" ? metadata[key] : undefined,
  );
  return new PdpGuard(
    reflector,
    pdp,
    new AsyncPrincipalResolver(new PrincipalService(CONFIG), NO_SECURITY_STATE),
  );
}

function contextWith(
  params: Record<string, string> = { tenantId: "biz-kopi" },
  body: unknown = {},
): ExecutionContext {
  const request = {
    method: "GET",
    url: "/api/biz-kopi/business",
    headers: { "x-yt-user-id": "11111111-1111-4111-8111-111111111111" },
    params,
    body,
  };
  return {
    getHandler: () => () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("a declared route", () => {
  it("asks the PDP the declared question and allows on ALLOW", async () => {
    const guard = guardWith({
      [AUTHORIZE_METADATA]: { kind: "business", action: "view" },
    });

    await expect(guard.canActivate(contextWith())).resolves.toBe(true);

    expect(requireAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "11111111-1111-4111-8111-111111111111" }),
      { kind: "business", id: "biz-kopi", attr: { businessId: "biz-kopi" } },
      "view",
    );
  });

  it("refuses on DENY", async () => {
    requireAction.mockReturnValue(
      errAsync({ type: "forbidden", kind: "business", resourceId: "biz-kopi", action: "view" }),
    );
    const guard = guardWith({
      [AUTHORIZE_METADATA]: { kind: "business", action: "view" },
    });

    await expect(guard.canActivate(contextWith())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("passes the attributes the owner-protecting rules need", async () => {
    const guard = guardWith({
      [AUTHORIZE_METADATA]: {
        kind: "team",
        action: "change_role",
        attrsFrom: () => ({ targetRole: "owner", targetPrincipalId: "u9" }),
      },
    });

    await guard.canActivate(contextWith());

    expect(requireAction).toHaveBeenCalledWith(
      expect.anything(),
      {
        kind: "team",
        id: "biz-kopi",
        attr: { businessId: "biz-kopi", targetRole: "owner", targetPrincipalId: "u9" },
      },
      "change_role",
    );
  });

  it("omits businessId when there is no tenant, as on a create", async () => {
    // No tenant exists yet, so no derived role can or should match. Inventing
    // a businessId here would be worse than omitting it: it would make the
    // tenant-scoped rules appear to have been consulted.
    const guard = guardWith({
      [AUTHORIZE_METADATA]: { kind: "business", action: "create" },
    });

    await guard.canActivate(contextWith({}));

    expect(requireAction).toHaveBeenCalledWith(
      expect.anything(),
      { kind: "business", id: "new", attr: {} },
      "create",
    );
  });
});

describe("failing closed", () => {
  it("REFUSES a route that declares nothing", async () => {
    // The build check should catch this first. If the two ever disagree, the
    // one that ships is this one — docs/14 §8 (A10), a value operation that
    // cannot determine its answer must not fall through to "grant".
    const guard = guardWith({});

    await expect(guard.canActivate(contextWith())).rejects.toBeInstanceOf(ForbiddenException);
    expect(requireAction).not.toHaveBeenCalled();
  });

  it("does not consult the PDP for an undeclared route", async () => {
    // Refusing without asking is deliberate: there is no question to ask,
    // and inventing one would put a made-up kind and action into the audit
    // log as though a real decision had been made.
    const guard = guardWith({});
    await guard.canActivate(contextWith()).catch(() => undefined);
    expect(requireAction).not.toHaveBeenCalled();
  });
});

describe("@PublicRoute", () => {
  it("skips the PDP, with its reason recorded at the route", async () => {
    const guard = guardWith({ [PUBLIC_ROUTE_METADATA]: "health check, no data" });

    await expect(guard.canActivate(contextWith())).resolves.toBe(true);
    expect(requireAction).not.toHaveBeenCalled();
  });
});
