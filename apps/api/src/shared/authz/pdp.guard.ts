import { Inject, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import { PDP_CLIENT } from "../pdp/pdp-client.module";
import { AsyncPrincipalResolver } from "./async-principal-resolver";
import { mapAuthzErrorToHttpException } from "./authz-error.mapper";
import { AUTHORIZE_METADATA, PUBLIC_ROUTE_METADATA } from "./authorize.decorator";
import type { AuthorizeOptions } from "./authorize.decorator";

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
  constructor(
    private readonly reflector: Reflector,
    @Inject(PDP_CLIENT) private readonly pdp: PdpClient,
    private readonly principals: AsyncPrincipalResolver,
  ) {}

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

    const result = await this.pdp.requireAction(
      principal,
      {
        kind: options.kind,
        id: options.idFrom?.(request) ?? tenantId ?? "new",
        attr: {
          // Every tenant-scoped policy reads businessId; the derived roles in
          // policies/derived_roles/business.yaml resolve the caller's role at
          // THAT business from it. Omitted when there is no tenant (a create),
          // where no derived role can or should match.
          ...(tenantId === undefined ? {} : { businessId: tenantId }),
          ...(options.attrsFrom?.(request) ?? {}),
        },
      },
      options.action,
    );

    if (result.isErr()) {
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
