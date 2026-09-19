import { z } from "zod";
import { CONTRACT_COMPONENTS } from "./schema-registry";
import type { ContractComponent } from "./schema-registry";
import { buildPaths } from "./route-registry";
import { COMPONENT_REF_PREFIX, isRecord, widenSchemaObject } from "./json-schema-helpers";

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
 *
 * `COMPONENT_REF_PREFIX`, `isRecord` and `widenSchemaObject` live in
 * `json-schema-helpers.ts` and are re-exported here for this file's existing
 * consumers (`openapi.test.ts`, `db-drift/schema-drift.test.ts`) — see that
 * file's header for why they moved out: this module and `route-registry.ts`
 * import each other, and a `const` shared across a circular import can hand
 * the other side `undefined`.
 */
export { COMPONENT_REF_PREFIX, isRecord, widenSchemaObject } from "./json-schema-helpers";

export interface OpenApiDocument {
  readonly openapi: "3.1.0";
  readonly info: { readonly title: string; readonly version: string; readonly description: string };
  readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
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
        "Generated from the Zod schemas in @yourtal/contracts (YT-0031) plus the route inventory " +
        "in src/openapi/route-registry.ts (YT-0552). Do not edit by hand.\n\n" +
        "`paths` covers every route the business module serves (apps/api/src/modules/business), " +
        "hand-declared in route-registry.ts against the live controllers rather than generated from " +
        "Nest decorators — apps/api has no decorator metadata rich enough to produce accurate " +
        "request/response shapes on its own. NOT every route apps/api serves: the campaign and watch " +
        "modules are separate, concurrently in-flight streams (YT-0101/YT-0120/YT-0548) this ticket " +
        "did not give a contract entry — see src/openapi/route-drift.test.ts's KNOWN_OUT_OF_SCOPE " +
        "ledger for exactly which routes those are and why. That same test fails CI if a business-" +
        "module controller route and a route-registry entry ever disagree, in either direction.\n\n" +
        "Cross-field rules are documented per component but NOT enforced by this document. Anything " +
        "that must enforce them has to run the Zod schema or re-implement and test the rule.",
    },
    paths: buildPaths(),
    components: { schemas: components },
  };
}

function stripJsonSchemaKeywords(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema)) {
    throw new Error("expected zod to produce an object schema");
  }
  const { $schema: _schema, $id: _id, ...rest } = schema;
  return rest;
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
