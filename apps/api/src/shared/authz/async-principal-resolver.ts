import { Inject, Injectable } from "@nestjs/common";
import { principalSchema } from "@yourtal/authz/principal";
import type { Principal } from "@yourtal/authz/principal";
import type { FastifyRequest } from "fastify";
import { PrincipalService } from "./principal.service";
import { PRINCIPAL_SECURITY_STATE_REPOSITORY } from "../../modules/identity/persistence/principal-security-state.repository";
import type { PrincipalSecurityStateRepository } from "../../modules/identity/persistence/principal-security-state.repository";

/**
 * The async, DB-reading counterpart to `PrincipalService.resolve()`
 * (YT-0582). `resolve()` is synchronous and reads only the request, which
 * is exactly why `valueFrozenUntil` — the 72h SIM-swap / account-recovery
 * freeze `policies/derived_roles/common.yaml` gates spend on (docs/14
 * section 5) — was never populatable by anything in this codebase
 * (`principal-attribute-coverage.test.ts` proves that generically, not just
 * for this one attribute). `reauthenticatedAt`, `hasPasskey` and
 * `goodwillCreditCeilingIdr` remain unpopulated on purpose:
 * `reauthenticatedAt`/`hasPasskey` are step-up-auth state pending the auth
 * work in YT-0540/0541, and `goodwillCreditCeilingIdr` is economy-owned
 * (YT-0050) — inventing either here would repeat the undecided-schema
 * mistake this ticket exists not to make.
 *
 * ## A separate class, not a new method on `PrincipalService`
 *
 * `apps/api/src/modules/store/**` and `apps/api/src/modules/watch/**` (other
 * work in flight, out of this ticket's reach) duck-type `PrincipalService`
 * directly in their own tests — a plain `{ resolve: vi.fn() }` passed
 * wherever a `PrincipalService` is expected, with no cast. Any new public
 * member added to that class breaks structural assignability for every one
 * of those fakes, in files this ticket must not touch. Composing
 * `PrincipalService` from outside, in a class those files never reference,
 * keeps `PrincipalService`'s own type exactly as it was — this class
 * exists instead of widening that one.
 *
 * Wired into `PdpGuard`, `IdempotencyInterceptor` and the three
 * business-module controllers that resolve a principal
 * (`create-business.controller.ts`, `team-invite.controller.ts`,
 * `team-member.controller.ts`) — see this ticket's report for the full
 * call-site list, including the six sites in `store/**`/`watch/**` that
 * were deliberately left on `PrincipalService.resolve()` unchanged.
 */
@Injectable()
export class AsyncPrincipalResolver {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(PRINCIPAL_SECURITY_STATE_REPOSITORY)
    private readonly securityState: PrincipalSecurityStateRepository,
  ) {}

  /**
   * Does the identical header parse `PrincipalService.resolve()` does, then
   * augments with a read of stored security state. An anonymous principal
   * never has a user id to look up, so it is returned unchanged — there is
   * no security state for someone who isn't signed in.
   *
   * A user with no row on file, and a user with a row whose
   * `valueFrozenUntil` is `null`, resolve identically: `attr.valueFrozenUntil`
   * stays unset either way, which `common.yaml`'s `!has(...)` reads as
   * "never frozen" — the correct default for almost every principal.
   */
  async resolve(request: FastifyRequest): Promise<Principal> {
    const base = this.principals.resolve(request);
    if (base.id === "anonymous") {
      return base;
    }

    const security = await this.securityState.findByUserId(base.id);
    if (security?.valueFrozenUntil == null) {
      return base;
    }

    return principalSchema.parse({
      ...base,
      attr: { ...base.attr, valueFrozenUntil: security.valueFrozenUntil.toISOString() },
    });
  }
}
