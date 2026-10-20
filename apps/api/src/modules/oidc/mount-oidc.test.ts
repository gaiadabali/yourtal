import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import {
  OIDC_DISABLED_ROUTES,
  OIDC_PREFIX,
  OIDC_PROTOCOL_ROUTES,
} from "@yourtal/contracts/oidc/protocol-routes";
import { mountOidc } from "./mount-oidc";
import { OidcRuntime, disabledOidcRuntime } from "./oidc-runtime";
import { buildTestProvider } from "./testing/oidc-test-kit";
import type { TestProvider } from "./testing/oidc-test-kit";

/**
 * docs/26 §1.1: the routes under /oidc are the provider's protocol routes and
 * nothing else. Three checks: the Fastify mount is one catch-all, the
 * provider answers exactly the declared routes, and no Nest controller sits
 * under /oidc.
 */
const apiSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(full);
    return entry.name.endsWith(".controller.ts") ? [full] : [];
  });
}

let kit: TestProvider;
const mounted: { method: string; url: string }[] = [];

beforeAll(async () => {
  kit = await buildTestProvider();
});

afterAll(async () => {
  await kit.fastify.close();
});

function concrete(routePath: string): string {
  return `${OIDC_PREFIX}${routePath.replace(":uid", "unknown-uid")}`;
}

describe("what is mounted under /oidc", () => {
  it("is one catch-all route handing requests to the provider", async () => {
    const fastify = Fastify();
    fastify.addHook("onRoute", (route) => {
      for (const method of [route.method].flat()) mounted.push({ method, url: route.url });
    });
    await mountOidc(fastify, new OidcRuntime(kit.provider, [], null, null));
    await fastify.ready();
    expect(mounted.filter((route) => route.url.startsWith(OIDC_PREFIX))).toEqual(
      expect.arrayContaining([
        { method: "GET", url: "/oidc/*" },
        { method: "POST", url: "/oidc/*" },
        { method: "OPTIONS", url: "/oidc/*" },
      ]),
    );
    expect(new Set(mounted.map((route) => route.url))).toEqual(new Set(["/oidc/*"]));
    await fastify.close();
  });

  it("is nothing at all while the provider is off", async () => {
    const fastify = Fastify();
    expect(await mountOidc(fastify, disabledOidcRuntime())).toBe(false);
    await fastify.ready();
    expect((await fastify.inject({ method: "GET", url: "/oidc/jwks" })).statusCode).toBe(404);
    await fastify.close();
  });

  it.each(OIDC_PROTOCOL_ROUTES.map((route) => [route.method, route.path] as const))(
    "the provider serves %s %s",
    async (method, routePath) => {
      const response = await kit.fastify.inject({
        method,
        url: concrete(routePath),
        headers:
          method === "OPTIONS"
            ? { origin: "https://x.example", "access-control-request-method": "GET" }
            : {},
      });
      expect(response.statusCode).not.toBe(404);
    },
  );

  it.each(OIDC_DISABLED_ROUTES.map((route) => [route.method, route.path, route.what] as const))(
    "the provider does not serve %s %s (%s)",
    async (method, routePath) => {
      const response = await kit.fastify.inject({ method, url: concrete(routePath) });
      expect(response.statusCode).toBe(404);
    },
  );

  it("no Nest controller is mounted under /oidc", () => {
    const offenders = controllerFiles(apiSrc).filter((file) =>
      /@Controller\(\s*["'`]\/?oidc(\/|["'`])/.test(readFileSync(file, "utf8")),
    );
    expect(offenders.map((file) => path.relative(apiSrc, file))).toEqual([]);
  });
});
