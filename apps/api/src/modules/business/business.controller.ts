import { Controller, Get, Inject, Param } from "@nestjs/common";
import { PrincipalService } from "../../shared/authz/principal.service";
import { BILLING_CONTACT_REPOSITORY } from "./persistence/billing-contact.repository";
import type { BillingContactRepository } from "./persistence/billing-contact.repository";
import { BUSINESS_ACCOUNT_REPOSITORY } from "./persistence/business-account.repository";
import type { BusinessAccountRepository } from "./persistence/business-account.repository";
import { BUSINESS_MEMBER_REPOSITORY } from "./persistence/business-member.repository";
import type { BusinessMemberRepository } from "./persistence/business-member.repository";
import { KYB_DOCUMENT_REPOSITORY } from "./persistence/kyb-document.repository";
import type { KybDocumentRepository } from "./persistence/kyb-document.repository";
import { mapBusinessErrorToHttpException } from "./to-http-exception";
import { getBusinessProfile } from "./use-cases/get-business-profile.use-case";
import { Authorize } from "../../shared/authz/authorize.decorator";

/**
 * Every method in every controller in this module follows this exact
 * three-step shape: resolve the principal, ask the PDP for one action on one
 * resource, call one use-case. YT-0500's guard replaces the middle step;
 * nothing else here should need to change when it does.
 *
 * This controller asks about the `business` kind (YT-0507) -- the profile
 * itself, not the roster (`team`) or the spend (`billing`). `view` reaches
 * all six office roles from docs/17 section 2.1, not just owner and admin;
 * see `policies/resource_policies/business.yaml` for why.
 */
@Controller("api/:tenantId/business")
export class BusinessController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(BUSINESS_ACCOUNT_REPOSITORY) private readonly businesses: BusinessAccountRepository,
    @Inject(BUSINESS_MEMBER_REPOSITORY) private readonly members: BusinessMemberRepository,
    @Inject(BILLING_CONTACT_REPOSITORY) private readonly billingContacts: BillingContactRepository,
    @Inject(KYB_DOCUMENT_REPOSITORY) private readonly kybDocuments: KybDocumentRepository,
  ) {}

  @Authorize({ kind: "business", action: "view" })
  @Get()
  async getProfile(@Param("tenantId") tenantId: string) {
    const result = await getBusinessProfile(
      this.businesses,
      this.members,
      this.billingContacts,
      this.kybDocuments,
      tenantId,
    );
    if (result.isErr()) {
      throw mapBusinessErrorToHttpException(result.error);
    }
    return result.value;
  }
}
