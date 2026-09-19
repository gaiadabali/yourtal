import { SetMetadata } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ActionFor, ResourceKind } from "@yourtal/authz/resources";

/**
 * Declares the PDP question a route asks. YT-0500.
 *
 * Before this, every controller resolved a principal, built a resource and
 * called `requireAction` in its own body — nine routes, nine copies, each an
 * opportunity to get the resource shape subtly wrong or to forget the call
 * entirely. `docs/14` §4 wants deny-by-default on every value-bearing
 * operation as a CI suite rather than a review habit, and a check can only
 * see a declaration; it cannot see whether a function body remembered to
 * await something.
 *
 * So the question moves to the route signature, `PdpGuard` asks it, and
 * `authorized-routes.test.ts` fails the build for any route that declares
 * nothing.
 */
export const AUTHORIZE_METADATA = "yt:authorize";
export const PUBLIC_ROUTE_METADATA = "yt:public-route";

export interface AuthorizeOptions<K extends ResourceKind = ResourceKind> {
  readonly kind: K;
  /**
   * Tied to `kind`, so an action that kind does not define is a compile
   * error rather than a permanent DENY discovered in production. The
   * registry it narrows against is checked against the policy repo in
   * both directions by `packages/authz`'s drift test.
   */
  readonly action: ActionFor<K>;
  /**
   * Extra resource attributes for rules that need more than the tenant.
   *
   * Most routes need none: the resource is the tenant, and the guard builds
   * `{ businessId: tenantId }` for them. Two do — changing a member's role
   * and removing a member both feed `targetRole` and `targetPrincipalId`
   * into `policies/resource_policies/team.yaml`, which uses them to refuse
   * any change that would touch an owner.
   *
   * Takes the request rather than pre-extracted values so the extraction
   * stays next to the rule that needs it.
   */
  readonly attrsFrom?: (request: FastifyRequest) => Readonly<Record<string, unknown>>;
  /**
   * The resource id, when it is not the tenant. Defaults to the tenant, or
   * to `"new"` for a create, where the thing being authorized does not exist
   * yet and there is nothing narrower to name.
   */
  readonly idFrom?: (request: FastifyRequest) => string;
}

export const Authorize = <K extends ResourceKind>(options: AuthorizeOptions<K>) =>
  SetMetadata(AUTHORIZE_METADATA, options);

/**
 * Declares a route deliberately reachable without a PDP check, with a reason.
 *
 * There are none today, and that is the intended state. It exists so that
 * the day a health check or a public catalogue page arrives, the exemption
 * is a decision written at the route with a justification a reviewer reads —
 * not a missing decorator that looks identical to an oversight.
 */
export const PublicRoute = (reason: string) => SetMetadata(PUBLIC_ROUTE_METADATA, reason);
