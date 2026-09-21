import { Body, Controller, Inject, Post, Req } from "@nestjs/common";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { CreateBusinessDto } from "./dto/create-business.schema";
import { BUSINESS_ONBOARDING_UNIT_OF_WORK } from "./persistence/business-onboarding.unit-of-work";
import type { BusinessOnboardingUnitOfWork } from "./persistence/business-onboarding.unit-of-work";
import { mapBusinessErrorToHttpException } from "./to-http-exception";
import { createBusiness } from "./use-cases/create-business.use-case";
import { Idempotent } from "../../shared/idempotency/idempotent.decorator";
import { ONBOARDING_RETENTION_MS } from "../../shared/idempotency/retention";
import { Authorize } from "../../shared/authz/authorize.decorator";
import type { FastifyRequest } from "fastify";

/**
 * The one endpoint in this module with no `:tenantId` (CLAUDE.md's
 * `/api/:tenantId/*` convention does not apply here on purpose): there is no
 * business yet for the PDP to reason about. `policies/` has no "business"
 * resource kind, only `team`, which governs an EXISTING business's roster
 * (see `policies/README.md`). So this route is gated on identity — is the
 * caller a real, signed-in principal — not on a Cerbos capability, and every
 * other route in this module goes through the PDP as usual.
 */
@Controller("api/businesses")
export class CreateBusinessController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(BUSINESS_ONBOARDING_UNIT_OF_WORK)
    private readonly unitOfWork: BusinessOnboardingUnitOfWork,
  ) {}

  // A retry that lands after a timeout would otherwise create a second
  // business with the caller as owner of both, and nothing downstream
  // would flag it — the second is a perfectly valid business.
  @Idempotent({ retentionMs: ONBOARDING_RETENTION_MS })
  @Authorize({ kind: "business", action: "create" })
  @Post()
  async create(@Body() body: CreateBusinessDto, @Req() request: FastifyRequest) {
    // No inline identity check any more. "Is this somebody rather than
    // nobody" is `business:create` in the policy repo (YT-0500), where it is
    // covered by a test, rather than an `if` in one controller that no
    // policy suite can see. The principal is still resolved here because the
    // caller becomes the business's owner.
    const principal = await this.principals.resolve(request);

    const result = await createBusiness(
      this.unitOfWork,
      {
        legalName: body.legalName,
        displayName: body.displayName,
        district: body.district,
        roles: body.roles,
        logoUrl: body.logoUrl,
      },
      principal.id,
    );
    if (result.isErr()) {
      throw mapBusinessErrorToHttpException(result.error);
    }
    return result.value;
  }
}
