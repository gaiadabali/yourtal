import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Principal } from "@yourtal/authz/principal";
import { createSimulatedSpambank } from "@yourtal/drivers/spambank";
import { APP_CONFIG } from "../../../config/app-config.module";
import { loadAppConfig } from "../../../config/app-config";
import { AsyncPrincipalResolver } from "../../../shared/authz/async-principal-resolver";
import { RATE_LIMIT_METADATA } from "../../../shared/rate-limit/rate-limit.decorator";
import type { RateLimitOptions } from "../../../shared/rate-limit/rate-limit.decorator";
import { OidcClientRateLimitGuard } from "../../oidc/client-rate-limit.guard";
import { clientsFor } from "../../oidc/clients";
import { OIDC_RUNTIME } from "../../oidc/oidc-runtime";
import type { OidcStore } from "../../oidc/oidc-store";
import { SpambankClientGuard, VERIFIED_OIDC_CLIENT_KEY } from "../../oidc/teen-invite-client.guard";
import { SpambankClientPersonResolver } from "../client-person";
import { verifyMailToken } from "../mail-token";
import { SPAMBANK_MAILBOX_STORE, SPAMBANK_PG_POOL } from "../management.tokens";
import { SpambankManagementService } from "../spambank-management.service";
import { SPAMBANK_CONFIG, SPAMBANK_DRIVER } from "../spambank.tokens";
import { MemoryMailboxStore } from "../testing/memory-mailbox-store";
import { SpambankClientsController } from "./oidc-clients.controller";
import { SpambankMeController } from "./me.controller";

/**
 * Both doors of the management API as HTTP, without a database or Cerbos: the session routes with a
 * fake principal (Cerbos is covered by the policy suite and the e2e test), the machine routes with a
 * fake OIDC runtime and the real client registry. The guards are replaced by what they do: name the
 * verified client, and let the request through.
 */

const KEY = "k".repeat(43);
const ENV = {
  DATABASE_URL: "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
  CHECKPOINT_TOKEN_SECRET: "test-only-checkpoint-signing-key-not-a-real-secret",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "test-only-webhook-secret-encryption-key-not-a-real-secret",
  SNAP_APP_PARTNER_SECRET: "test-only-snap-app-partner-secret-not-a-real-secret",
  PUBLIC_WEB_ORIGIN: "https://yourtal.gaiada.com",
  SPAMBANK_TOKEN_KEY: KEY,
};

function principalOf(overrides: {
  id?: string;
  ageBand?: "adult" | "teen";
  suspended?: boolean;
  region?: "AU" | "ID";
}): Principal {
  return {
    id: overrides.id ?? "user-ana",
    roles: ["user"],
    attr: {
      jurisdiction: overrides.region ?? "AU",
      businessRoles: {},
      isSuspended: overrides.suspended ?? false,
      ageBand: overrides.ageBand ?? "adult",
    },
  };
}

async function appFor(
  controllers: unknown[],
  providers: unknown[],
  guards: unknown[] = [],
): Promise<NestFastifyApplication> {
  let builder = Test.createTestingModule({
    controllers: controllers as never[],
    providers: providers as never[],
  });
  for (const guard of guards) {
    builder = builder.overrideGuard(guard as never).useValue({
      canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<Record<string, unknown>>();
        const headers = request["headers"] as Record<string, string | undefined>;
        const clientId = headers["x-test-client"];
        if (clientId !== undefined) Reflect.set(request, VERIFIED_OIDC_CLIENT_KEY, clientId);
        return true;
      },
    } satisfies CanActivate);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

function managementProviders(env: Record<string, string> = {}) {
  const config = loadAppConfig({ ...ENV, ...env });
  const store = new MemoryMailboxStore();
  return {
    store,
    config,
    providers: [
      { provide: APP_CONFIG, useValue: config },
      { provide: SPAMBANK_CONFIG, useValue: config.spambank },
      {
        provide: SPAMBANK_DRIVER,
        useValue: createSimulatedSpambank({ domains: ["yourtal.gaiada.com"] }),
      },
      { provide: SPAMBANK_MAILBOX_STORE, useValue: store },
      SpambankManagementService,
    ],
  };
}

describe("the session routes (/api/spambank/me)", () => {
  let app: NestFastifyApplication;
  let current: Principal;
  let store: MemoryMailboxStore;

  async function start(env: Record<string, string> = {}): Promise<void> {
    const base = managementProviders(env);
    store = base.store;
    app = await appFor(
      [SpambankMeController],
      [
        ...base.providers,
        {
          provide: AsyncPrincipalResolver,
          useValue: { resolve: () => Promise.resolve(current) },
        },
      ],
    );
  }

  beforeEach(() => {
    current = principalOf({});
  });
  afterEach(async () => {
    await app.close();
  });

  it("reports off, switches on with a 201, answers 200 with the same address on a repeat, then reports on", async () => {
    await start();
    const off = await app.inject({ method: "GET", url: "/api/spambank/me" });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toEqual({ available: true, state: "off" });

    const first = await app.inject({ method: "POST", url: "/api/spambank/me/enable" });
    expect(first.statusCode).toBe(201);
    const { address, created } = first.json<{ address: string; created: boolean }>();
    expect(created).toBe(true);
    expect(address).toMatch(/^[a-z]{6,16}([1-9][0-9])?@yourtal\.gaiada\.com$/);

    const again = await app.inject({ method: "POST", url: "/api/spambank/me/enable" });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ state: "on", address, created: false });

    const on = await app.inject({ method: "GET", url: "/api/spambank/me" });
    expect(on.json()).toMatchObject({ available: true, state: "on", address });
    expect((await store.find("user-ana"))?.enabledVia).toBe("yourtal");
  });

  it("tells a teen it is not allowed, and an account on hold the same", async () => {
    await start();
    current = principalOf({ ageBand: "teen" });
    const teen = await app.inject({ method: "GET", url: "/api/spambank/me" });
    expect(teen.json()).toEqual({ available: true, state: "not_allowed" });
    current = principalOf({ suspended: true });
    const held = await app.inject({ method: "GET", url: "/api/spambank/me" });
    expect(held.json()).toEqual({ available: true, state: "not_allowed" });
  });

  it("mints a mail token for the yourtal app, with the proxy's addresses", async () => {
    await start();
    await app.inject({ method: "POST", url: "/api/spambank/me/enable" });
    const response = await app.inject({ method: "POST", url: "/api/spambank/me/session" });
    expect(response.statusCode).toBe(200);
    const session = response.json<{
      token: string;
      sessionUrl: string;
      helpersBase: string;
      address: string;
    }>();
    expect(session.sessionUrl).toBe("https://yourtal.gaiada.com/api/spambank/jmap/session");
    expect(session.helpersBase).toBe("https://yourtal.gaiada.com/api/spambank/mail");
    const verified = verifyMailToken(session.token, KEY);
    expect(verified.ok && verified.payload.a).toBe("yourtal");
    expect(verified.ok && verified.payload.u).toBe("user-ana");
  });

  it("answers 409 not_enabled for a session before there is a mailbox", async () => {
    await start();
    const response = await app.inject({ method: "POST", url: "/api/spambank/me/session" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "not_enabled" });
  });

  it("makes, lists and revokes app passwords, and refuses a bad name or id", async () => {
    await start();
    await app.inject({ method: "POST", url: "/api/spambank/me/enable" });
    const created = await app.inject({
      method: "POST",
      url: "/api/spambank/me/app-passwords",
      payload: { name: "Pixel mail" },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json<{ id: string; secret: string; username: string }>();
    expect(body.secret).toMatch(/^app_/);

    const listed = await app.inject({ method: "GET", url: "/api/spambank/me/app-passwords" });
    expect(listed.json<{ items: { name: string }[] }>().items.map((item) => item.name)).toEqual([
      "Pixel mail",
    ]);
    expect(listed.body).not.toContain(body.secret);

    const blank = await app.inject({
      method: "POST",
      url: "/api/spambank/me/app-passwords",
      payload: { name: "   " },
    });
    expect(blank.statusCode).toBe(400);
    const long = await app.inject({
      method: "POST",
      url: "/api/spambank/me/app-passwords",
      payload: { name: "x".repeat(41) },
    });
    expect(long.statusCode).toBe(400);

    const badId = await app.inject({
      method: "DELETE",
      url: "/api/spambank/me/app-passwords/not%20an%20id",
    });
    expect(badId.statusCode).toBe(404);
    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/spambank/me/app-passwords/${body.id}`,
    });
    expect(revoked.statusCode).toBe(204);
  });

  it("deletes the mailbox with a 202, retires the name, and a second delete finds none", async () => {
    await start();
    const { address } = (
      await app.inject({ method: "POST", url: "/api/spambank/me/enable" })
    ).json<{ address: string }>();
    const deleted = await app.inject({ method: "DELETE", url: "/api/spambank/me" });
    expect(deleted.statusCode).toBe(202);
    expect(store.retired.has(address.split("@")[0] ?? "")).toBe(true);
    const status = await app.inject({ method: "GET", url: "/api/spambank/me" });
    expect(status.json()).toEqual({ available: true, state: "off" });
    const again = await app.inject({ method: "DELETE", url: "/api/spambank/me" });
    expect(again.statusCode).toBe(409);
  });

  it("with SPAMBANK_ENABLED off: the status says unavailable and every other route is a 404", async () => {
    await start({ SPAMBANK_ENABLED: "0" });
    expect((await app.inject({ method: "GET", url: "/api/spambank/me" })).json()).toEqual({
      available: false,
    });
    for (const [method, url] of [
      ["POST", "/api/spambank/me/enable"],
      ["POST", "/api/spambank/me/session"],
      ["GET", "/api/spambank/me/app-passwords"],
      ["DELETE", "/api/spambank/me"],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});

describe("the machine routes (/api/oidc-clients/spambank)", () => {
  let app: NestFastifyApplication;
  let store: MemoryMailboxStore;

  /** The people the fake OIDC store knows. `sub`s are per sector, as in `oidc.subject`. */
  const SUBS = new Map<string, string>([
    ["snapapp-staging|sub-ana-snap", "user-ana"],
    ["ftr|sub-ana-ftr", "user-ana"],
    ["snapapp-staging|sub-budi-snap", "user-budi"],
    ["snapapp-staging|sub-teo-snap", "user-teo"],
    ["snapapp-staging|sub-held-snap", "user-held"],
    ["snapapp-staging|sub-left-snap", "user-left"],
    ["ftr|sub-teo-ftr", "user-teo"],
  ]);
  const ACCOUNTS: Record<
    string,
    { region: "AU" | "ID"; dateOfBirth: string; suspended?: boolean; consentEnded?: boolean }
  > = {
    "user-ana": { region: "AU", dateOfBirth: "1990-01-01" },
    "user-budi": { region: "ID", dateOfBirth: "1991-02-03" },
    "user-teo": { region: "AU", dateOfBirth: "2012-05-05" },
    "user-held": { region: "AU", dateOfBirth: "1985-05-05", suspended: true },
    "user-left": { region: "AU", dateOfBirth: "1985-05-05", consentEnded: true },
  };

  const oidcStore = {
    findAccount: (userId: string) => {
      const account = ACCOUNTS[userId];
      return Promise.resolve(
        account === undefined
          ? null
          : {
              userId,
              displayName: userId,
              region: account.region,
              dateOfBirth: account.dateOfBirth,
              email: `${userId}@example.test`,
              emailVerified: true,
              suspended: account.suspended ?? false,
            },
      );
    },
    findAppConsent: (userId: string) =>
      Promise.resolve({
        scopes: ["openid"],
        policyVersionId: "p",
        grantedVia: "consent_screen" as const,
        inviteId: null,
        endedAt: ACCOUNTS[userId]?.consentEnded === true ? new Date("2026-11-01T00:00:00Z") : null,
      }),
  } as unknown as OidcStore;

  const pool = {
    query: (_sql: string, params: string[]) => {
      const userId = SUBS.get(`${params[0] ?? ""}|${params[1] ?? ""}`);
      return Promise.resolve({ rows: userId === undefined ? [] : [{ user_id: userId }] });
    },
  };

  async function start(): Promise<void> {
    const base = managementProviders();
    store = base.store;
    const runtime = { provider: {}, clients: clientsFor("staging"), store: oidcStore };
    app = await appFor(
      [SpambankClientsController],
      [
        ...base.providers,
        { provide: OIDC_RUNTIME, useValue: runtime },
        { provide: SPAMBANK_PG_POOL, useValue: pool },
        SpambankClientPersonResolver,
      ],
      [SpambankClientGuard, OidcClientRateLimitGuard],
    );
  }

  const snapapp = { "x-test-client": "snapapp-staging-server" };
  const ftr = { "x-test-client": "ftr-server" };

  function call(path: string, headers: Record<string, string>, payload: object) {
    return app.inject({
      method: "POST",
      url: `/api/oidc-clients/spambank/${path}`,
      headers,
      payload,
    });
  }

  beforeEach(async () => {
    await start();
  });
  afterEach(async () => {
    await app.close();
  });

  it("names the person by the app's own sub, and answers 404 unknown_subject for another", async () => {
    const unknown = await call("status", snapapp, { sub: "no-such-sub" });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ code: "unknown_subject" });
    // A sub of another sector's app is not this app's person.
    const foreign = await call("status", snapapp, { sub: "sub-ana-ftr" });
    expect(foreign.statusCode).toBe(404);
    const ok = await call("status", snapapp, { sub: "sub-ana-snap" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({
      available: true,
      state: "off",
      settings: { statementsToSnapApp: false, newMailAlerts: true },
    });
  });

  it("gives SnapApp and FTR the same address for the same person: one mailbox per YourTal account", async () => {
    const viaSnap = await call("enable", snapapp, { sub: "sub-ana-snap" });
    expect(viaSnap.statusCode).toBe(201);
    const viaFtr = await call("enable", ftr, { sub: "sub-ana-ftr" });
    expect(viaFtr.statusCode).toBe(200);
    expect(viaFtr.json()).toEqual({ ...viaSnap.json<object>(), created: false });
    expect((await store.find("user-ana"))?.enabledVia).toBe("snapapp");

    const status = await call("status", ftr, { sub: "sub-ana-ftr" });
    expect(status.json()).toMatchObject({
      state: "on",
      address: viaSnap.json<{ address: string }>().address,
    });
  });

  it("refuses a teen, an account on hold and a person whose consent ended, with 403 not_allowed", async () => {
    for (const sub of ["sub-teo-snap", "sub-held-snap", "sub-left-snap"]) {
      for (const path of ["status", "enable", "session", "app-passwords/list"]) {
        const response = await call(path, snapapp, { sub });
        expect(response.statusCode, `${sub} ${path}`).toBe(403);
        expect(response.json()).toMatchObject({ code: "not_allowed" });
      }
    }
    // FTR refuses a teen too, whatever its own regions.
    expect((await call("status", ftr, { sub: "sub-teo-ftr" })).statusCode).toBe(403);
    expect(store.rows.size).toBe(0);
  });

  it("mints the token for the asking app", async () => {
    await call("enable", snapapp, { sub: "sub-ana-snap" });
    const viaSnap = (await call("session", snapapp, { sub: "sub-ana-snap" })).json<{
      token: string;
    }>();
    const viaFtr = (await call("session", ftr, { sub: "sub-ana-ftr" })).json<{ token: string }>();
    const snap = verifyMailToken(viaSnap.token, KEY);
    const ftrToken = verifyMailToken(viaFtr.token, KEY);
    expect(snap.ok && snap.payload.a).toBe("snapapp");
    expect(ftrToken.ok && ftrToken.payload.a).toBe("ftr");
    expect(snap.ok && ftrToken.ok && snap.payload.m).toBe(ftrToken.ok ? ftrToken.payload.m : "");
  });

  it("answers 409 not_enabled for a session before there is a mailbox", async () => {
    const response = await call("session", snapapp, { sub: "sub-budi-snap" });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "not_enabled" });
  });

  it("lets only SnapApp change the settings, and needs at least one", async () => {
    await call("enable", snapapp, { sub: "sub-ana-snap" });
    const refused = await call("settings", ftr, { sub: "sub-ana-ftr", newMailAlerts: false });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: "not_allowed" });

    const empty = await call("settings", snapapp, { sub: "sub-ana-snap" });
    expect(empty.statusCode).toBe(400);
    expect(empty.json()).toMatchObject({ code: "no_setting" });

    const changed = await call("settings", snapapp, {
      sub: "sub-ana-snap",
      statementsToSnapApp: true,
      newMailAlerts: false,
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({
      state: "on",
      settings: { statementsToSnapApp: true, newMailAlerts: false },
    });
    // An unknown field is refused rather than ignored.
    expect((await call("settings", snapapp, { sub: "sub-ana-snap", other: true })).statusCode).toBe(
      400,
    );
  });

  it("makes, lists and revokes app passwords for the person, never touching another's", async () => {
    await call("enable", snapapp, { sub: "sub-ana-snap" });
    await call("enable", snapapp, { sub: "sub-budi-snap" });
    const created = await call("app-passwords", snapapp, { sub: "sub-ana-snap", name: "Pixel" });
    expect(created.statusCode).toBe(201);
    const { id, secret } = created.json<{ id: string; secret: string }>();
    expect(secret).toMatch(/^app_/);

    const listed = await call("app-passwords/list", ftr, { sub: "sub-ana-ftr" });
    expect(listed.json<{ items: { name: string }[] }>().items.map((item) => item.name)).toEqual([
      "Pixel",
    ]);
    // Budi revoking Ana's id does nothing to hers.
    const other = await call("app-passwords/revoke", snapapp, { sub: "sub-budi-snap", id });
    expect(other.statusCode).toBe(204);
    expect(
      (await call("app-passwords/list", snapapp, { sub: "sub-ana-snap" })).json<{
        items: unknown[];
      }>().items,
    ).toHaveLength(1);
    const revoked = await call("app-passwords/revoke", snapapp, { sub: "sub-ana-snap", id });
    expect(revoked.statusCode).toBe(204);
    expect(
      (await call("app-passwords/list", snapapp, { sub: "sub-ana-snap" })).json<{
        items: unknown[];
      }>().items,
    ).toEqual([]);
  });

  it("refuses a body that is not exactly what the route takes", async () => {
    expect((await call("status", snapapp, {})).statusCode).toBe(400);
    expect((await call("status", snapapp, { sub: "" })).statusCode).toBe(400);
    expect((await call("enable", snapapp, { sub: "sub-ana-snap", extra: 1 })).statusCode).toBe(400);
    expect((await call("app-passwords", snapapp, { sub: "sub-ana-snap" })).statusCode).toBe(400);
    expect(
      (await call("app-passwords/revoke", snapapp, { sub: "sub-ana-snap", id: "../x" })).statusCode,
    ).toBe(400);
  });

  it("is guarded by the spambank scope and rate-limited per verified client, with an ip floor 10x it", () => {
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, SpambankClientsController);
    expect(guards).toEqual([SpambankClientGuard, OidcClientRateLimitGuard]);
    for (const name of [
      "status",
      "enable",
      "session",
      "settings",
      "listAppPasswords",
      "createAppPassword",
      "revokeAppPassword",
    ]) {
      const handler: unknown = Reflect.get(SpambankClientsController.prototype, name);
      const options: RateLimitOptions = Reflect.getMetadata(RATE_LIMIT_METADATA, handler as object);
      expect(options.identity, name).toBeDefined();
      expect(options.ip?.max, name).toBe((options.identity?.max ?? 0) * 10);
    }
  });
});
