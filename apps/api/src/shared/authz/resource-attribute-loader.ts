import type { FastifyRequest } from "fastify";
import type { ResourceKind } from "@yourtal/authz/resources";

/**
 * 1.5.d (EW-03): an async counterpart to `AuthorizeOptions.attrsFrom`.
 *
 * `attrsFrom` is a plain function stored as route metadata at class-load
 * time (`SetMetadata`, in `authorize.decorator.ts`) — it can only close over
 * the request, never over an injected repository, because nothing has been
 * constructed by Nest's DI yet when a decorator runs. That is exactly how
 * `watch.controller.ts` shipped with `@Authorize({ kind: "campaign_view",
 * action: "earn" })` and no attributes at all: there was no way for the
 * decorator itself to look up the campaign's `state`. Real Cerbos then
 * denied every route silently, because `campaign_view.yaml`'s ALLOW rules
 * all key on `R.attr.state`.
 *
 * A `ResourceAttributeLoader` is a normal NestJS provider instead, injected
 * into `PdpGuard` (see its constructor) and looked up by `kind`. It resolves
 * BOTH the resource id and its attributes together, because for a route like
 * `POST /api/watch/sessions/:sessionId/progress` the id in the URL
 * (`sessionId`) is not the id the policy reasons about (`campaignId`) — only
 * a loader with a repository can make that hop.
 */
export interface ResourceAttributeLoader<K extends ResourceKind = ResourceKind> {
  readonly kind: K;
  /**
   * Resolves the real resource id and its Cerbos attributes from the raw
   * request.
   *
   * Three outcomes, not two, because a loader is registered by KIND and a
   * kind can back both a single-resource route and a collection route (e.g.
   * `campaign_view`'s `GET /api/campaigns` list vs. `GET /api/campaigns/:id`)
   * — the loader has to be able to say "this request does not name one of
   * mine" without that being confused for "it named one and it is gone":
   *
   * - `undefined`: no resource of this kind is identifiable in the request
   *   at all (a list route). `PdpGuard` falls through to the ordinary
   *   `idFrom`/`attrsFrom`/tenant path, unchanged.
   * - `null`: a resource of this kind WAS named (an id in the URL, a body
   *   field) and it does not exist. `PdpGuard` turns this into a 404 — the
   *   same answer the route's own existence check would give a moment
   *   later, so no route need change its own not-found behaviour.
   * - the object: found, with its id and Cerbos attributes.
   */
  resolve(
    request: FastifyRequest,
  ): Promise<
    { readonly id: string; readonly attr: Readonly<Record<string, unknown>> } | null | undefined
  >;
}

/** Multi-bound in `app.module.ts` — one entry per resource kind that needs a DB-backed lookup. */
export const RESOURCE_ATTRIBUTE_LOADERS = Symbol("RESOURCE_ATTRIBUTE_LOADERS");
