import { describe, expect, it } from "vitest";
import { buildDocument } from "../openapi/build-document";

/**
 * 4.9.d: B (the backing rate) never reaches a browser. Every apps/api route
 * and response schema is in the published document (route-drift keeps the
 * two equal), so no property anywhere in it may name B, its micros or the
 * rate it was priced at.
 */
const FORBIDDEN_KEY = /micros|backing|^b$/i;

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

describe("B never reaches an API response", () => {
  it("finds a backing-rate property when one is there", () => {
    const leaky = {
      components: { schemas: { Q: { properties: { issuePriceMicros: {}, points: {} } } } },
    };
    expect(forbiddenKeys(leaky)).toEqual(["#/components/schemas/Q/properties/issuePriceMicros"]);
  });

  it("no published path or schema carries a backing-rate property", () => {
    const document = buildDocument("0.0.0");
    // Not vacuous: the document really holds routes and schemas.
    expect(Object.keys(document.paths).length).toBeGreaterThan(0);
    expect(Object.keys(document.components.schemas).length).toBeGreaterThan(0);
    expect(forbiddenKeys(document)).toEqual([]);
  });
});
