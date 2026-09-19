import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * YT-0039 AC2: *"Mandatory on every value-moving endpoint, enforced by a
 * lint/test check."* This is that check.
 *
 * ## Why it reads source rather than inspecting the Nest container
 *
 * Booting the app to enumerate routes needs a Cerbos sidecar and a database,
 * neither of which exists in CI yet (YT-0022 is blocked on GCP). Reading the
 * decorators from source needs nothing, runs in milliseconds, and fails for
 * the right reason with the file and line in the message.
 *
 * The cost is honest: this checks that a route is DECLARED idempotent, not
 * that the interceptor ran. `idempotency.interceptor.test.ts` covers the
 * second half.
 *
 * ## The rule
 *
 * Every `@Post`, `@Put`, `@Patch` or `@Delete` handler must carry either
 * `@Idempotent({...})` or `@NotValueMoving("reason")`. Not one or the other
 * by default — **neither is a build failure**, so adding an endpoint forces
 * someone to decide. `docs/09` §214: retries are certain; double-spends must
 * be impossible.
 */
const apiSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MUTATING_VERB = /^\s*@(Post|Put|Patch|Delete)\(/;
const IDEMPOTENT = /^\s*@Idempotent\(/;
const NOT_VALUE_MOVING = /^\s*@NotValueMoving\(/;

interface Route {
  readonly file: string;
  readonly line: number;
  readonly verb: string;
  readonly declared: "idempotent" | "not_value_moving" | "undeclared";
}

function controllerFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...controllerFiles(full));
    } else if (entry.name.endsWith(".controller.ts")) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Finds each mutating verb decorator and looks at the decorators stacked
 * around it — decorator order is a style choice and this check must not
 * become a reason to argue about it.
 */
function mutatingRoutes(): Route[] {
  const routes: Route[] = [];

  for (const file of controllerFiles(apiSrc)) {
    const lines = readFileSync(file, "utf8").split("\n");

    lines.forEach((line, index) => {
      const verb = MUTATING_VERB.exec(line)?.[1];
      if (verb === undefined) return;

      // Generous window: @Authorize (YT-0500) can run to a dozen lines when
      // it carries attrsFrom, and it sits between @Idempotent and the verb.
      const neighbourhood = lines.slice(Math.max(0, index - 20), index + 5);
      const declared = neighbourhood.some((candidate) => IDEMPOTENT.test(candidate))
        ? "idempotent"
        : neighbourhood.some((candidate) => NOT_VALUE_MOVING.test(candidate))
          ? "not_value_moving"
          : "undeclared";

      routes.push({
        file: path.relative(apiSrc, file).replace(/\\/g, "/"),
        line: index + 1,
        verb,
        declared,
      });
    });
  }

  return routes;
}

describe("every mutating route declares its idempotency stance", () => {
  const routes = mutatingRoutes();

  it("finds routes at all", () => {
    // Guards the guard. If the scan silently stopped matching — a decorator
    // rename, a directory move — the assertion below would pass over an
    // empty list and this check would protect nothing while looking green.
    expect(routes.length).toBeGreaterThanOrEqual(5);
  });

  it("leaves none undeclared", () => {
    const undeclared = routes
      .filter((route) => route.declared === "undeclared")
      .map((route) => `${route.file}:${String(route.line)} @${route.verb}`);

    expect(
      undeclared,
      "These mutating routes declare neither @Idempotent({...}) nor " +
        '@NotValueMoving("reason"). Retries are certain (docs/09 section 214) — decide ' +
        "which this endpoint is and say so at the route.",
    ).toEqual([]);
  });

  it("records what each route decided, so a reviewer can see the shape", () => {
    // Not an assertion about the split — it will change as endpoints are
    // added. It exists so `vitest --reporter=verbose` shows the inventory.
    const summary = routes.reduce<Record<string, number>>((counts, route) => {
      counts[route.declared] = (counts[route.declared] ?? 0) + 1;
      return counts;
    }, {});

    expect(Object.keys(summary).length).toBeGreaterThan(0);
  });
});
