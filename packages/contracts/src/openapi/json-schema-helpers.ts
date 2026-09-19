/**
 * Low-level JSON Schema helpers shared by `build-document.ts` (which builds
 * `components.schemas` from the Zod registry) and `route-registry.ts` (which
 * builds `paths`, and needs `$ref`s into those same components).
 *
 * Split out on purpose: `build-document.ts` importing `route-registry.ts`
 * (to embed `paths`) and `route-registry.ts` importing back from
 * `build-document.ts` (for these helpers) is a circular import. ESM handles
 * that for hoisted function declarations, but NOT for `const` — a module
 * still mid-initialization hands the other side `undefined` for any `const`
 * it has not reached yet, which is exactly how `COMPONENT_REF_PREFIX`
 * silently became `undefined` inside a `$ref` the first time this was tried.
 * Both sides depending on this leaf file instead means neither imports the
 * other.
 */

/** OpenAPI keeps component schemas under this path; `$ref`s point at it. */
export const COMPONENT_REF_PREFIX = "#/components/schemas/";

/**
 * Narrows to a plain object without a type assertion.
 *
 * `as` is banned outright in this package (docs/13b section 2) because it is
 * value-path code, so everything that walks the untyped JSON Schema output
 * goes through this instead.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Largest value a Go `int32` or a Java `int` can hold. */
const INT32_MAX = 2_147_483_647;

/**
 * Marks integers that do not fit in 32 bits as `format: "int64"`.
 *
 * This is not cosmetic. A JSON Schema `{"type": "integer"}` carries no width,
 * and every generator that has to pick one picks **int32** by default —
 * openapi-generator does, and so do most others. Our money types allow values
 * up to 10,000,000,000 (`docs/15`: every amount is an integer in its minor
 * unit, and for IDR the minor unit is 1 Rupiah). That is roughly five times
 * what an int32 holds.
 *
 * So without this, a generated Go struct declares `FaceValueIdr int32` for a
 * field whose own schema permits IDR 10 billion, and a legitimate value
 * silently overflows on the way in or out. A money field that truncates is
 * exactly the failure docs/13 section 4 puts in the must-have-tests list, and
 * it would have been introduced here, by a generator default, in a file nobody
 * reads because it says "DO NOT EDIT" at the top.
 *
 * Unbounded integers are widened too: no declared maximum means we cannot show
 * the value fits, and for a cross-language numeric type the safe assumption is
 * the wider one.
 */
export function widenSchemaObject(schema: Record<string, unknown>): Record<string, unknown> {
  const widened = widenLargeIntegers(schema);
  // widenLargeIntegers preserves shape, so a record in is a record out. The
  // guard is here because `as` is banned in this package (docs/13b section 2)
  // and a fallback that cannot happen is cheaper than an assertion that lies.
  return isRecord(widened) ? widened : schema;
}

function widenLargeIntegers(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(widenLargeIntegers);
  if (!isRecord(node)) return node;

  const widened: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    widened[key] = widenLargeIntegers(value);
  }

  if (node.type === "integer" && node.format === undefined) {
    const max = node.maximum;
    if (typeof max !== "number" || max > INT32_MAX) {
      widened.format = "int64";
    }
  }
  return widened;
}
