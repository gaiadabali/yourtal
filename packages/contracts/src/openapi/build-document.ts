import { z } from "zod";
import { CONTRACT_COMPONENTS } from "./schema-registry";
import type { ContractComponent } from "./schema-registry";

/**
 * Builds the OpenAPI 3.1 document from the Zod schemas. YT-0031.
 *
 * The Zod schemas are the single source of truth; this document is derived,
 * checked in, and regenerating it must produce no diff — see `openapi.test.ts`.
 *
 * OpenAPI **3.1** specifically, because 3.1 aligns its schema object with JSON
 * Schema 2020-12, which is what `z.toJSONSchema` emits. Under 3.0 the output
 * would need lossy rewriting (nullable, exclusiveMinimum, const), and a lossy
 * step in a generator is how the document and the schemas drift while the
 * drift check still passes.
 */

/** OpenAPI keeps component schemas under this path; `$ref`s point at it. */
const COMPONENT_REF_PREFIX = "#/components/schemas/";

export interface OpenApiDocument {
  readonly openapi: "3.1.0";
  readonly info: { readonly title: string; readonly version: string; readonly description: string };
  readonly paths: Readonly<Record<string, never>>;
  readonly components: { readonly schemas: Readonly<Record<string, unknown>> };
}

/**
 * Counts the cross-field refinements on a schema — the rules JSON Schema
 * cannot express, which `schema-registry.ts` requires to be documented.
 *
 * Only OBJECT-level checks count. A `z.string().min(1)` is also a "check" in
 * Zod, but it survives into JSON Schema as `minLength`, so it is not lost and
 * does not need declaring. Checks attached to an object, by contrast, can only
 * have come from `.refine()`/`.superRefine()` and are always lost.
 *
 * This reads Zod's internal `_zod.def`, which is not a public API. That is a
 * deliberate, contained risk: zod is pinned to an exact version, this is the
 * only place in the repo that reaches inside it, and if a future upgrade
 * changes the shape the assertion in `openapi.test.ts` fails loudly rather
 * than quietly reporting zero.
 */
export function countCrossFieldRefinements(schema: unknown): number {
  const def = zodDef(schema);
  if (def === undefined) return 0;

  if (def.type === "object") {
    return Array.isArray(def.checks) ? def.checks.length : 0;
  }

  // Unions (including discriminated unions) carry their refinements on the
  // member schemas, not on the union itself.
  if (Array.isArray(def.options)) {
    return def.options.reduce<number>(
      (total, option) => total + countCrossFieldRefinements(option),
      0,
    );
  }

  return 0;
}

/**
 * The description a component carries into the document — and from there into
 * generated Go and TypeScript as a doc comment, which is the only place a
 * consumer of those types will ever see these rules.
 */
export function describeComponent(component: ContractComponent): string {
  if (component.crossFieldRules.length === 0) return component.description;

  return [
    component.description,
    "",
    "Rules NOT enforced by this schema (they cannot be expressed in JSON Schema, and are",
    "enforced only by the Zod schema in @yourtal/contracts):",
    ...component.crossFieldRules.map((rule) => `  - ${rule}`),
  ].join("\n");
}

export function buildDocument(version: string): OpenApiDocument {
  const registry = z.registry<{ id: string }>();
  for (const component of CONTRACT_COMPONENTS) {
    registry.add(component.schema, { id: component.id });
  }

  const { schemas } = z.toJSONSchema(registry, {
    target: "draft-2020-12",
    uri: (id) => `${COMPONENT_REF_PREFIX}${id}`,
  });

  const components: Record<string, unknown> = {};
  // Sorted, so the checked-in artifact has a stable diff and a reordered
  // registry does not read as a contract change in review.
  for (const component of [...CONTRACT_COMPONENTS].sort((a, b) => a.id.localeCompare(b.id))) {
    const schema = schemas[component.id];
    if (schema === undefined) {
      throw new Error(`zod produced no JSON Schema for component "${component.id}"`);
    }
    components[component.id] = {
      description: describeComponent(component),
      // `$schema` and `$id` are meaningful to a standalone JSON Schema file
      // and noise inside an OpenAPI components block, where the location in
      // the document already identifies the schema.
      ...widenSchemaObject(stripJsonSchemaKeywords(schema)),
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "YourTal contracts",
      version,
      description:
        "Generated from the Zod schemas in @yourtal/contracts (YT-0031). Do not edit by hand.\n\n" +
        "This document carries SCHEMAS ONLY. `paths` is empty because no API surface exists yet — " +
        "endpoints arrive with apps/api (YT-0100 onward), and each will be added here as it is built.\n\n" +
        "Cross-field rules are documented per component but NOT enforced by this document. Anything " +
        "that must enforce them has to run the Zod schema or re-implement and test the rule.",
    },
    paths: {},
    components: { schemas: components },
  };
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

function stripJsonSchemaKeywords(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema)) {
    throw new Error("expected zod to produce an object schema");
  }
  const { $schema: _schema, $id: _id, ...rest } = schema;
  return rest;
}

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

/** Zod's internal definition node, or undefined if this is not a Zod schema. */
function zodDef(schema: unknown): Record<string, unknown> | undefined {
  if (!isRecord(schema)) return undefined;
  const internal = schema._zod;
  if (!isRecord(internal)) return undefined;
  const def = internal.def;
  return isRecord(def) ? def : undefined;
}

/**
 * The declared keys of an object schema's shape, or undefined for any other
 * kind of schema. Used by the faithfulness test to compare the document back
 * against the Zod schemas.
 */
export function objectShapeKeys(schema: unknown): string[] | undefined {
  const def = zodDef(schema);
  if (def?.type !== "object") return undefined;
  return isRecord(def.shape) ? Object.keys(def.shape).sort() : undefined;
}
