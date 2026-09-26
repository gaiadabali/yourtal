import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import type { ResourceKind } from "@yourtal/authz/resources";
import { PDP_CLIENT } from "../pdp/pdp-client.module";
import { AsyncPrincipalResolver } from "./async-principal-resolver";
import { mapAuthzErrorToHttpException } from "./authz-error.mapper";
import { AUTHORIZE_METADATA, PUBLIC_ROUTE_METADATA } from "./authorize.decorator";
import type { AuthorizeOptions } from "./authorize.decorator";
import { RESOURCE_ATTRIBUTE_LOADERS } from "./resource-attribute-loader";
import type { ResourceAttributeLoader } from "./resource-attribute-loader";
import { BUSINESS_REGION_LOOKUP } from "../../modules/store/persistence/business-region-lookup";
import type { BusinessRegionLookup } from "../../modules/store/persistence/business-region-lookup";

/**
 * Resolves every route's authorization through the PDP. YT-0500 AC1.
 *
 * Registered globally, so a route is guarded by existing rather than by a
 * controller remembering to ask. `docs/13a` fixes the middleware order as
 * `... auth -> Cerbos -> idempotency -> module`: a guard runs before
 * interceptors, which puts this ahead of `IdempotencyInterceptor` exactly as
 * specified — an unauthenticated caller must not be able to write to the
 * idempotency table at all.
 *
 * ## Fails closed on an undeclared route
 *
 * A route with neither `@Authorize` nor `@PublicRoute` is **denied**, not
 * allowed. `authorized-routes.test.ts` catches that at build time, but the
 * runtime default has to agree with it: if the two ever disagree, the one
 * that ships is this one. `docs/14` §8 (A10) — a value operation that cannot
 * determine its answer must not fall through to "grant".
 */
@Injectable()
export class PdpGuard implements CanActivate {
  /** Built once from the injected array — a `Map` so a request-time lookup is O(1), not a scan. */
  private readonly loaders: ReadonlyMap<ResourceKind, ResourceAttributeLoader>;

  constructor(
    private readonly reflector: Reflector,
    @Inject(PDP_CLIENT) private readonly pdp: PdpClient,
    private readonly principals: AsyncPrincipalResolver,
    @Optional()
    @Inject(RESOURCE_ATTRIBUTE_LOADERS)
    loaders: readonly ResourceAttributeLoader[] = [],
    @Optional()
    @Inject(BUSINESS_REGION_LOOKUP)
    private readonly regions?: BusinessRegionLookup,
  ) {
    this.loaders = new Map(loaders.map((loader) => [loader.kind, loader]));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();

    const publicReason = this.reflector.get<string | undefined>(PUBLIC_ROUTE_METADATA, handler);
    if (publicReason !== undefined) {
      return true;
    }

    const options = this.reflector.get<AuthorizeOptions | undefined>(AUTHORIZE_METADATA, handler);
    if (options === undefined) {
      // Deny-by-default. The build check should have caught this; if it did
      // not, refusing is the only safe disagreement to have.
      throw mapAuthzErrorToHttpException({
        type: "forbidden",
        kind: "platform_setting",
        resourceId: "unknown",
        action: "unknown",
      });
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    // AsyncPrincipalResolver (YT-0582): this is the primary allow/deny gate
    // for every route, so it is the highest-leverage place to read stored
    // security state (the account freeze in particular) into the principal
    // the PDP actually reasons about.
    const principal = await this.principals.resolve(request);
    const tenantId = tenantOf(request);

    // 1.5.d (EW-03): a resource kind with a registered loader gets its id
    // AND attributes from a real DB read, replacing the tenant/attrsFrom
    // path entirely for that kind — the loader is the one place that knows
    // how to get from the URL (a session id, say) to the resource the
    // policy actually reasons about (its campaign).
    const loader = this.loaders.get(options.kind);
    const loaded = await loader?.resolve(request);
    if (loader !== undefined && loaded === null) {
      throw new NotFoundException("No such resource.");
    }

    // 1.5.b (F2): every tenant-scoped resource gets the OWNING business's
    // region alongside its businessId, the same one-line addition to the
    // existing tenant path rather than a per-kind loader — every
    // resource_policy.yaml's `f2-region-wall` rule reads this. `undefined`
    // (no lookup registered, or the business does not exist — the route's
    // own handler gives the real error for that) simply omits the
    // attribute, which the wall's own `has(R.attr.region)` guard treats as
    // "nothing to compare", not as an allow.
    const tenantRegion =
      tenantId === undefined
        ? undefined
        : (await this.regions?.findRegionAndCurrency(tenantId))?.region;

    const result = await this.pdp.requireAction(
      principal,
      {
        kind: options.kind,
        id: loaded?.id ?? options.idFrom?.(request) ?? tenantId ?? "new",
        attr: {
          // Every tenant-scoped policy reads businessId; the derived roles in
          // policies/derived_roles/business.yaml resolve the caller's role at
          // THAT business from it. Omitted when there is no tenant (a create),
          // where no derived role can or should match.
          ...(tenantId === undefined ? {} : { businessId: tenantId }),
          ...(tenantRegion === undefined ? {} : { region: tenantRegion }),
          ...(loaded?.attr ?? {}),
          ...(options.attrsFrom?.(request) ?? {}),
        },
      },
      options.action,
    );

    if (result.isErr()) {
      // F30: an anonymous caller denied on a protected route gets 401, not
      // 403 — there is no session to speak of, so "sign in" is the correct
      // instruction, not "you lack permission". A SIGNED-IN principal
      // Cerbos refuses still gets 403 from mapAuthzErrorToHttpException
      // below; this never touches the pdp_unavailable/pdp_protocol_error
      // cases, which stay 503 regardless of who is asking. Open Viewing's
      // anonymous ALLOW (campaign_view.yaml) is untouched — this only
      // fires once Cerbos has already said no.
      if (result.error.type === "forbidden" && principal.roles.includes("anonymous")) {
        throw new UnauthorizedException({
          code: "no_session",
          message: "sign in to continue",
        });
      }
      throw mapAuthzErrorToHttpException(result.error);
    }
    return true;
  }
}

/**
 * The tenant from the route, never from the body.
 *
 * A tenant a client can choose is a tenant a client can choose to be. It is
 * read from the path parameter the route itself declares, so the value has
 * already been through routing rather than through a payload.
 */
function tenantOf(request: FastifyRequest): string | undefined {
  const params: unknown = request.params;
  if (typeof params !== "object" || params === null || !("tenantId" in params)) {
    return undefined;
  }
  const tenantId: unknown = Reflect.get(params, "tenantId");
  return typeof tenantId === "string" && tenantId.length > 0 ? tenantId : undefined;
}
