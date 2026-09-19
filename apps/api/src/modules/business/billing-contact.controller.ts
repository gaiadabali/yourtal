import { Body, Controller, Get, Inject, Param, Put } from "@nestjs/common";
import { PrincipalService } from "../../shared/authz/principal.service";
import { SetBillingContactDto } from "./dto/set-billing-contact.schema";
import { BILLING_CONTACT_REPOSITORY } from "./persistence/billing-contact.repository";
import type { BillingContactRepository } from "./persistence/billing-contact.repository";
import { BUSINESS_ACCOUNT_REPOSITORY } from "./persistence/business-account.repository";
import type { BusinessAccountRepository } from "./persistence/business-account.repository";
import { mapBusinessErrorToHttpException } from "./to-http-exception";
import { getBillingContact } from "./use-cases/get-billing-contact.use-case";
import { setBillingContact } from "./use-cases/set-billing-contact.use-case";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { Authorize } from "../../shared/authz/authorize.decorator";

/**
 * `billing` is the closest existing resource kind to "who may see/change the
 * business's billing contact" (docs/17 section 2.1's Billing zone: Owner and
 * Finance edit, Admin views). Reusing `update_payment_method` for writing a
 * billing contact, rather than adding a dedicated action, is a deliberate
 * best-fit choice flagged in the ticket report — a `billing:update_contact`
 * action would be cleaner but is not mine to add to `policies/`.
 */
@Controller("api/:tenantId/business/billing-contact")
export class BillingContactController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(BUSINESS_ACCOUNT_REPOSITORY) private readonly businesses: BusinessAccountRepository,
    @Inject(BILLING_CONTACT_REPOSITORY) private readonly billingContacts: BillingContactRepository,
  ) {}

  @Authorize({ kind: "billing", action: "view" })
  @Get()
  async get(@Param("tenantId") tenantId: string) {
    const result = await getBillingContact(this.businesses, this.billingContacts, tenantId);
    if (result.isErr()) {
      throw mapBusinessErrorToHttpException(result.error);
    }
    return result.value;
  }

  @NotValueMoving(
    "A full-replacement PUT of the billing contact. Replaying it writes the same " +
      "values, so a retry is indistinguishable from the first call and creates nothing.",
  )
  @Authorize({ kind: "billing", action: "update_payment_method" })
  @Put()
  async set(@Param("tenantId") tenantId: string, @Body() body: SetBillingContactDto) {
    const result = await setBillingContact(this.businesses, this.billingContacts, {
      businessId: tenantId,
      name: body.name,
      email: body.email,
      phone: body.phone,
    });
    if (result.isErr()) {
      throw mapBusinessErrorToHttpException(result.error);
    }
    return result.value;
  }
}
