import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * YT-0500 AC2: *"a route without an authz decorator fails CI."*
 *
 * `docs/14` §4 asks for object-level authorization tests as "a required CI
 * suite, not a review habit". This is the suite. It reads source rather than
 * booting the container for the same reason `mutating-routes.test.ts` does:
 * booting needs Cerbos and Postgres, while a scan needs nothing and names the
 * file and line when it fails.
 *
 * It checks a DECLARATION. That a declared route is actually enforced is
 * `pdp.guard.test.ts`, and that the declared action exists at all is the
 * drift test in `@yourtal/authz`, which compares the TypeScript registry
 * against the policy repo in both directions. Three checks, three different
 * failures, none of which substitutes for the others.
 */
const apiSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const ROUTE_VERB = /^\s*@(Get|Post|Put|Patch|Delete)\(/;
const AUTHORIZE = /^\s*@Authorize\(\{/;
const PUBLIC = /^\s*@PublicRoute\(/;

interface Route {
  readonly file: string;
  readonly line: number;
  readonly verb: string;
  readonly declared: boolean;
  /** The decorator block above the verb, for the mapping assertions below. */
  readonly context: string;
}

function controllerFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...controllerFiles(full));
    else if (entry.name.endsWith(".controller.ts")) found.push(full);
  }
  return found;
}

function routes(): Route[] {
  const found: Route[] = [];

  for (const file of controllerFiles(apiSrc)) {
    const lines = readFileSync(file, "utf8").split("\n");

    lines.forEach((line, index) => {
      const verb = ROUTE_VERB.exec(line)?.[1];
      if (verb === undefined) return;

      // Decorators stack above the verb, and an @Authorize with attrsFrom
      // runs to several lines, so the window is generous.
      const above = lines.slice(Math.max(0, index - 16), index);
      found.push({
        file: path.relative(apiSrc, file).replace(/\\/g, "/"),
        line: index + 1,
        verb,
        declared: above.some((l) => AUTHORIZE.test(l) || PUBLIC.test(l)),
        context: above.join("\n"),
      });
    });
  }
  return found;
}

const ALL = routes();

describe("every route declares how it is authorized", () => {
  it("finds routes at all", () => {
    // Guards the guard: a renamed decorator or a moved directory would
    // otherwise make this suite pass over an empty list.
    expect(ALL.length).toBeGreaterThanOrEqual(9);
  });

  it("leaves none undeclared", () => {
    const undeclared = ALL.filter((route) => !route.declared).map(
      (route) => `${route.file}:${String(route.line)} @${route.verb}`,
    );

    expect(
      undeclared,
      'These routes carry neither @Authorize({...}) nor @PublicRoute("reason"). ' +
        "A route that decides its own authorization is the ad-hoc check YT-0500 removed; " +
        "PdpGuard will refuse it at runtime, so an undeclared route is a broken route.",
    ).toEqual([]);
  });
});

describe("the YT-0507 mappings specifically", () => {
  // These were once a `team:view` proxy, which was both the wrong question
  // and owner/admin-only. The controller tests that pinned them asserted the
  // PDP was consulted; that moved to the guard, so what is pinned here is
  // the question each route asks.
  function routeIn(file: string, verb: string): Route | undefined {
    return ALL.find((route) => route.file.endsWith(file) && route.verb === verb);
  }

  it("the business profile asks business:view, not team:view", () => {
    const route = routeIn("business.controller.ts", "Get");
    expect(route?.context).toContain('kind: "business"');
    expect(route?.context).toContain('action: "view"');
  });

  it.each([
    ["Get", "view"],
    ["Post", "submit"],
  ])("KYB %s asks kyb_document:%s", (verb, action) => {
    const route = routeIn("kyb-document.controller.ts", verb);
    expect(route?.context).toContain('kind: "kyb_document"');
    expect(route?.context).toContain(`action: "${action}"`);
  });

  it("creating a business asks the PDP rather than checking identity inline", () => {
    // Before YT-0500 this route threw UnauthorizedException from its own
    // body — one endpoint answering its own question, where no policy suite
    // could see it. Now `business:create` denies anonymous in the policy.
    const route = routeIn("create-business.controller.ts", "Post");
    expect(route?.context).toContain('kind: "business"');
    expect(route?.context).toContain('action: "create"');
  });

  it("the owner-protecting routes pass the target the policy needs", () => {
    // team.yaml refuses a change_role or remove_member aimed at the owner,
    // and can only do that if the route tells it what is being targeted.
    const patch = routeIn("team-member.controller.ts", "Patch");
    const remove = routeIn("team-member.controller.ts", "Delete");

    expect(patch?.context).toContain("targetRole");
    expect(patch?.context).toContain("targetPrincipalId");
    expect(remove?.context).toContain("targetPrincipalId");
  });
});
