import { describe, expect, it } from "vitest";
import { buildDocument } from "../openapi/build-document";

/**
 * 4.9.d, narrowed by F54 (2026-09-29, founder-approved): B (the backing
 * rate) never reaches a browser -- EXCEPT the staff console's own,
 * Cerbos-gated, finance-only rate screen (TASKS.md 9.5.b), where a human has
 * to see and choose the number to change it. See
 * `packages/contracts/src/openapi/route-registry.c-staff-economy.ts`'s own
 * comment for the full reasoning this carve-out replaces (it no longer
 * applies -- those two rate routes are back in `ALL_ROUTE_DEFINITIONS`).
 *
 * Every OTHER apps/api route and response schema is in the published
 * document (route-drift keeps the two equal), so no property anywhere
 * OUTSIDE `/api/staff/**` may name B, its micros or the rate it was priced
 * at. `components.schemas` (the shared, cross-route component set) is NEVER
 * exempt, staff or not: a named component could be referenced from a
 * non-staff path just as easily, so the carve-out only widens the two
 * specific, inline, staff-only path entries that need it -- not the whole
 * document.
 */
const FORBIDDEN_KEY = /micros|backing|^b$/i;
const STAFF_PATH_PREFIX = "/api/staff/";

function forbiddenKeys(node: unknown, at = "#"): string[] {
  if (Array.isArray(node))
    return node.flatMap((item, i) => forbiddenKeys(item, `${at}/${String(i)}`));
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => {
    const here = `${at}/${key}`;
    // Only property names count: a description may explain B in words.
    const own = at.endsWith("/properties") && FORBIDDEN_KEY.test(key) ? [here] : [];
    const required =
      key === "required" && Array.isArray(value)
        ? value.filter(
            (name): name is string => typeof name === "string" && FORBIDDEN_KEY.test(name),
          )
        : [];
    return [...own, ...required.map((name) => `${here}:${name}`), ...forbiddenKeys(value, here)];
  });
}

/** Splits `document.paths` into the staff console's own routes and everything else. */
function partitionPaths(paths: Record<string, unknown>): {
  staff: Record<string, unknown>;
  everyoneElse: Record<string, unknown>;
} {
  const staff: Record<string, unknown> = {};
  const everyoneElse: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(paths)) {
    (path.startsWith(STAFF_PATH_PREFIX) ? staff : everyoneElse)[path] = value;
  }
  return { staff, everyoneElse };
}

describe("B never reaches an API response", () => {
  it("finds a backing-rate property when one is there", () => {
    const leaky = {
      components: { schemas: { Q: { properties: { issuePriceMicros: {}, points: {} } } } },
    };
    expect(forbiddenKeys(leaky)).toEqual(["#/components/schemas/Q/properties/issuePriceMicros"]);
  });

  it("no published path or schema outside the staff console carries a backing-rate property", () => {
    const document = buildDocument("0.0.0");
    // Not vacuous: the document really holds routes and schemas.
    expect(Object.keys(document.paths).length).toBeGreaterThan(0);
    expect(Object.keys(document.components.schemas).length).toBeGreaterThan(0);

    // Components are never exempt, staff or not -- see this file's own header.
    expect(forbiddenKeys(document.components, "#/components")).toEqual([]);

    const { everyoneElse } = partitionPaths(document.paths);
    expect(Object.keys(everyoneElse).length).toBeGreaterThan(0);
    expect(forbiddenKeys(everyoneElse, "#/paths")).toEqual([]);
  });

  it("F54: the staff console's rate screen is the ONLY place B appears, and it genuinely does", () => {
    const document = buildDocument("0.0.0");
    const { staff } = partitionPaths(document.paths);
    expect(Object.keys(staff).length).toBeGreaterThan(0);

    // Proves the carve-out is exercised, not merely permitted: if 9.5.b ever
    // stopped sending B, this assertion (not just the one above) would be
    // the one to catch that the exemption had quietly become dead code.
    const staffHits = forbiddenKeys(staff, "#/paths");
    expect(staffHits.length).toBeGreaterThan(0);
    for (const hit of staffHits) {
      expect(hit.startsWith("#/paths/" + STAFF_PATH_PREFIX)).toBe(true);
    }
  });
});
