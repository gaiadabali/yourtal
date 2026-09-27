import { Inject, Injectable } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PdpClient } from "@yourtal/authz/pdp-client";
import type { ActionFor, ResourceKind } from "@yourtal/authz/resources";
import type { Principal } from "@yourtal/authz/principal";
import { PDP_CLIENT } from "../../shared/pdp/pdp-client.module";
import { StoreDevicePrincipalResolver } from "../../shared/authz/store-device-principal-resolver";
import { mapAuthzErrorToHttpException } from "../../shared/authz/authz-error.mapper";

/**
 * TASKS.md 8.1.b/8.2: every route a paired counter device calls (unlock,
 * lookup/authorize/capture/log) goes through this instead of the global
 * `PdpGuard` + `@Authorize`.
 *
 * Why a second path exists at all: `PdpGuard` (the global guard every OTHER
 * route relies on) resolves its principal through `AsyncPrincipalResolver`,
 * which only ever answers "anonymous" or a signed-in person's session
 * (`PrincipalService.resolve`'s own doc comment). A counter device has
 * neither — it authenticates with a bearer secret through
 * `StoreDevicePrincipalResolver`, a deliberately separate identity path
 * (see that class's own comment on why a stolen device must never be able
 * to claim a business for itself). `PdpGuard` cannot be taught to try both
 * without Area A rewriting a shared, `apps/api/src/shared/authz/**` file
 * this phase does not own; every device route below is instead marked
 * `@PublicRoute` for the global guard and does the SAME two steps
 * `PdpGuard.canActivate` does — resolve, then ask the PDP — explicitly,
 * right here, so the check still runs before the handler's own body,
 * just not through the global guard's own code path.
 */
@Injectable()
export class DeviceAuthorize {
  constructor(
    @Inject(PDP_CLIENT) private readonly pdp: PdpClient,
    private readonly devicePrincipals: StoreDevicePrincipalResolver,
  ) {}

  /**
   * Throws 401 (invalid/revoked credential) or 403 (a valid device denied
   * the action) — never returns on refusal.
   *
   * `resourceFrom` takes the ALREADY-RESOLVED principal, not the request —
   * a device's own `businessId` (for `redemption.yaml`'s `store_device_of`)
   * comes only from its credential (`principal.attr.deviceBusinessId`,
   * provisioning-time truth), which is not known until `resolve()` below has
   * run. Building the resource before that would either need a second,
   * earlier credential check or trust something request-supplied — the
   * exact "a stolen device names a different merchant" shape this whole
   * split exists to close.
   */
  async requireDevice<K extends ResourceKind>(
    request: FastifyRequest,
    resourceFrom: (principal: Principal) => {
      kind: K;
      id: string;
      attr?: Readonly<Record<string, unknown>>;
    },
    action: ActionFor<K>,
  ): Promise<Principal> {
    // Resolve() itself throws UnauthorizedException for an unknown, expired
    // or revoked credential (8.1.c) — that 401 propagates unchanged.
    const principal = await this.devicePrincipals.resolve(request);
    const resource = resourceFrom(principal);

    const result = await this.pdp.requireAction(
      principal,
      { kind: resource.kind, id: resource.id, attr: resource.attr ?? {} },
      action,
    );
    if (result.isErr()) {
      throw mapAuthzErrorToHttpException(result.error);
    }
    return principal;
  }
}

/** `StoreDevicePrincipalResolver` mints `id: "device:" + deviceId` — the inverse of that one line. */
export function deviceIdOf(principal: Principal): string {
  return principal.id.startsWith("device:") ? principal.id.slice("device:".length) : principal.id;
}
