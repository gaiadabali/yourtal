import { z } from "zod";
import { COMPONENT_REF_PREFIX, isRecord, widenSchemaObject } from "./json-schema-helpers";

/**
 * Types and helpers shared by every area's route registry. 1.3.a (TASKS.md).
 *
 * `route-registry.ts` used to be one file with every route in it, which meant
 * every area touched the same file for its own routes and collided on every
 * merge. It is now split one file per area — `route-registry.a.ts` (Area A:
 * platform/shared, e.g. health), `route-registry.b.ts` (Area B: campaign,
 * watch, me), `route-registry.c.ts` (Area C: business, studio, store,
 * billing, devices, partners, staff, reports, feed) — concatenated back into
 * one `ALL_ROUTE_DEFINITIONS` by `route-registry.ts`. This file holds the
 * pieces every one of those needs (the `RouteDefinition` shape, the OpenAPI
 * assembly, and error shapes generic enough to be reused across areas), so no
 * area's file needs to import another area's file.
 *
 * See the original file's header (still true, just relocated) for why routes
 * are hand-declared here instead of read off Nest decorators, and why
 * request/response shapes for apps/api-local DTOs are inlined rather than
 * promoted to named components.
 */

/** One `{name}` path parameter, and what it is. */
export interface RoutePathParam {
  readonly name: string;
  readonly description: string;
  readonly schema: Record<string, unknown>;
}

/** One `?name=` query parameter, and what it is. Unlike a path param, optional by default. */
export interface RouteQueryParam {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
  readonly schema: Record<string, unknown>;
}

/** Every `/api/:tenantId/*` route (docs/13a) takes this — shared across every area's file. */
export const TENANT_ID_PARAM: RoutePathParam = {
  name: "tenantId",
  description: "The business this route is scoped to (docs/13a's /api/:tenantId/* convention).",
  schema: { type: "string", format: "uuid" },
};

export interface RouteErrorResponse {
  readonly status: number;
  readonly description: string;
  /**
   * `false` only for the nestjs-zod validation-pipe 400: it is thrown by
   * `ZodValidationPipe` (`apps/api/src/main.ts`) before a controller or
   * either error mapper runs, and this package has not verified its exact
   * field names against the installed `nestjs-zod` version. Documented by
   * description only, with no `content` schema, rather than assert a shape
   * nobody checked.
   */
  readonly documented: boolean;
  /**
   * When `documented` is true, the schema to put in `content` — defaults to
   * `ref("ErrorResponse")` if omitted. An override exists for two real
   * cases:
   *
   *   1. A status this API produces from more than one mechanism with more
   *      than one body shape (e.g. a PDP-denied 403 vs. a plain
   *      `ForbiddenException("...")` thrown straight from a controller) —
   *      given as `{ anyOf: [...] }` of every shape that status can carry.
   *   2. A status whose body is a real, known, non-error schema (health's
   *      503 carries the exact same `HealthResponse` shape 200 does).
   */
  readonly schema?: Record<string, unknown>;
}

/**
 * The exact JSON body `@nestjs/common`'s `HttpException` subclasses build
 * when thrown with a plain string message and no options object — e.g.
 * `throw new NotFoundException("No such campaign.")` in
 * `campaign.controller.ts` and `watch.controller.ts`. Confirmed by reading
 * the installed `@nestjs/common` source
 * (`exceptions/http.exception.js`'s `createBody`, `exceptions/not-found
 * .exception.js` etc.): a string first argument always yields exactly these
 * three keys, `error` taking the exception class's default reason phrase
 * ("Not Found", "Bad Request", "Forbidden") since none of these call sites
 * pass a second argument to override it.
 *
 * This is NOT this API's `{code,message}` `ErrorResponse` envelope.
 * `business/to-http-exception.ts` and `authz-error.mapper.ts` both always
 * construct their exceptions from an object (`new NotFoundException({code,
 * message})`), which Nest serialises unchanged — that is what makes
 * `ErrorResponse` "the one error envelope this API actually returns" for
 * the business module. A module with no mapper of its own throws a bare
 * string for every domain-level refusal, so every one of those responses
 * carries THIS shape instead.
 */
export const NEST_DEFAULT_ERROR_SCHEMA: Record<string, unknown> = {
  type: "object",
  description:
    "Nest's own default HttpException body for a plain string message — not this API's " +
    "{code,message} ErrorResponse envelope. See NEST_DEFAULT_ERROR_SCHEMA in " +
    "route-registry-shared.ts.",
  properties: {
    statusCode: { type: "integer" },
    message: { type: "string" },
    error: { type: "string" },
  },
  required: ["statusCode", "message", "error"],
  additionalProperties: false,
};

/**
 * A `RouteErrorResponse` for a plain, undocumented-shape Nest exception —
 * `documented: true` because the shape IS known (`NEST_DEFAULT_ERROR_SCHEMA`
 * above, verified against the installed framework), just not the
 * `ErrorResponse` envelope `documented` originally meant "this is or isn't".
 */
export function nestDefaultError(status: number, description: string): RouteErrorResponse {
  return { status, description, documented: true, schema: NEST_DEFAULT_ERROR_SCHEMA };
}

/** Every route here is `@Authorize`d (YT-0500) and can be refused or fail to evaluate. */
export const FORBIDDEN: RouteErrorResponse = {
  status: 403,
  description:
    "The PDP denied this action (authz-error.mapper.ts's `forbidden` case). Also the " +
    "fail-closed response for a route with no @Authorize/@PublicRoute at all — should never " +
    "reach a real deployment; authorized-routes.test.ts catches that at build time.",
  documented: true,
};

/** Cerbos unreachable, or the domain use-case's own persistence step failed. Same envelope either way. */
export const SERVICE_UNAVAILABLE: RouteErrorResponse = {
  status: 503,
  description:
    "Either the PDP could not be reached or returned something this app could not parse " +
    "(authz-error.mapper.ts's pdp_unavailable/pdp_protocol_error, logged server-side and never " +
    "detailed here per docs/14 section 8 A10), or the use-case's own persistence step failed " +
    "(to-http-exception.ts's persistence_failed).",
  documented: true,
};

/**
 * The PDP half of `SERVICE_UNAVAILABLE` above, without the persistence-failure clause — for
 * modules with no `to-http-exception.ts`-style domain-error mapper of their own, where a raw
 * persistence failure is an unhandled exception (a plain 500, not documented anywhere in this
 * registry, matching this repo's existing convention for unmapped errors).
 */
export const PDP_UNAVAILABLE: RouteErrorResponse = {
  status: 503,
  description:
    "The PDP could not be reached or returned something this app could not parse " +
    "(authz-error.mapper.ts's pdp_unavailable/pdp_protocol_error, logged server-side and never " +
    "detailed here per docs/14 section 8 A10).",
  documented: true,
};

/**
 * Every route with a request body can fail nestjs-zod's global validation
 * pipe before the handler runs. See the field comment on `documented` above
 * for why this is description-only.
 */
export const VALIDATION_400: RouteErrorResponse = {
  status: 400,
  description:
    "The request body failed Zod validation (nestjs-zod's global ZodValidationPipe, " +
    "apps/api/src/main.ts). Its exact response shape is nestjs-zod's own and is not modelled here.",
  documented: false,
};

/** Converts a standalone Zod schema (not one registered as a named component) to inline JSON Schema. */
export function inlineSchema(schema: z.ZodType): Record<string, unknown> {
  const json: unknown = z.toJSONSchema(schema, { target: "draft-2020-12" });
  if (!isRecord(json)) throw new Error("expected zod to produce an object schema");
  const { $schema: _schema, $id: _id, ...rest } = json;
  return widenSchemaObject(rest);
}

/** `{ $ref: "#/components/schemas/<id>" }`, pointing at an existing registered component. */
export function ref(id: string): { $ref: string } {
  return { $ref: `${COMPONENT_REF_PREFIX}${id}` };
}

export function arrayOf(componentId: string): Record<string, unknown> {
  return { type: "array", items: ref(componentId) };
}

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export interface RouteDefinition {
  readonly method: HttpMethod;
  /** OpenAPI-style template: `:param` from the Nest controller becomes `{param}`. */
  readonly path: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly pathParams: readonly RoutePathParam[];
  /** Absent on every route with none; campaign's `list` is the first to take one. */
  readonly queryParams?: readonly RouteQueryParam[];
  readonly requestBody?: { readonly description: string; readonly schema: Record<string, unknown> };
  readonly successStatus: number;
  readonly successDescription: string;
  readonly successSchema: Record<string, unknown>;
  readonly errors: readonly RouteErrorResponse[];
}

/** One response object; a bare description for an undocumented shape, a schema otherwise. */
function responseObject(
  description: string,
  schema?: Record<string, unknown>,
): Record<string, unknown> {
  if (schema === undefined) return { description };
  return { description, content: { "application/json": { schema } } };
}

function operationObject(route: RouteDefinition): Record<string, unknown> {
  const responses: Record<string, unknown> = {
    [String(route.successStatus)]: responseObject(route.successDescription, route.successSchema),
  };
  for (const error of route.errors) {
    // Two errors sharing one status (e.g. two different 404s) fold into one
    // response entry — OpenAPI has exactly one response object per status
    // code, and both carry the same ErrorResponse envelope, so the fold
    // loses nothing but the disambiguating prose, joined below rather than
    // picking one description and dropping the other silently. That "both
    // carry the same envelope" premise is exactly why every `route.errors`
    // list in this file is written so that no two entries sharing a status
    // ever disagree on `schema` — this fold takes the LAST one's schema
    // unconditionally, so a mismatched pair would silently assert whichever
    // happened to be listed last. Where a status genuinely has more than one
    // shape (a mixed PDP/domain 403, say), that is one hand-written entry
    // with an `anyOf`, not two competing entries.
    const key = String(error.status);
    const existing = responses[key];
    const schema = error.documented ? (error.schema ?? ref("ErrorResponse")) : undefined;
    responses[key] =
      isRecord(existing) && typeof existing.description === "string"
        ? responseObject(`${existing.description} OR: ${error.description}`, schema)
        : responseObject(error.description, schema);
  }

  return {
    summary: route.summary,
    tags: route.tags,
    parameters: [
      ...route.pathParams.map((param) => ({
        name: param.name,
        in: "path",
        required: true,
        description: param.description,
        schema: param.schema,
      })),
      ...(route.queryParams ?? []).map((param) => ({
        name: param.name,
        in: "query",
        required: param.required,
        description: param.description,
        schema: param.schema,
      })),
    ],
    ...(route.requestBody === undefined
      ? {}
      : {
          requestBody: {
            required: true,
            description: route.requestBody.description,
            content: { "application/json": { schema: route.requestBody.schema } },
          },
        }),
    responses,
  };
}

/** Builds the `paths` object `build-document.ts` embeds in the document, from any route list. */
export function buildPathsFrom(
  routes: readonly RouteDefinition[],
): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of routes) {
    paths[route.path] = { ...paths[route.path], [route.method]: operationObject(route) };
  }
  return paths;
}
