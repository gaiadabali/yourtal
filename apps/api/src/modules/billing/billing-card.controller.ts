import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { BillingCard, StartCardSetupResult } from "@yourtal/contracts/billing";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { BUSINESS_REGION_LOOKUP } from "../store/persistence/business-region-lookup";
import type { BusinessRegionLookup } from "../store/persistence/business-region-lookup";
import { PAYMENT_ACCOUNTS_SERVICE } from "../payments/payment-accounts.service";
import type { PaymentAccountsService } from "../payments/payment-accounts.service";
import type { PaymentOwner } from "../payments/payment-accounts.repository";

const logger = new Logger("BillingCard");

/**
 * 5.1.a: the card a business's boosts are charged to. Saving one opens the
 * processor's own page (Stripe; the card arrives with the webhook) or, on
 * the simulated driver, is saved in the request. Only brand, last four and
 * expiry ever leave the server.
 */
@Controller("api/:tenantId/studio/billing/card")
export class BillingCardController {
  constructor(
    @Inject(PAYMENT_ACCOUNTS_SERVICE) private readonly accounts: PaymentAccountsService,
    @Inject(BUSINESS_REGION_LOOKUP) private readonly businesses: BusinessRegionLookup,
  ) {}

  @Authorize({ kind: "billing", action: "view" })
  @Get()
  async card(@Param("tenantId") tenantId: string): Promise<BillingCard> {
    const owner = await this.owner(tenantId);
    const stored = await this.accounts.liveCard(owner);
    return {
      card: stored?.card ?? null,
      required: this.accounts.driverFor(owner).needsSavedCard,
    };
  }

  @Authorize({ kind: "billing", action: "update_payment_method" })
  @NotValueMoving(
    "Saving a card charges nothing. A repeat opens another setup page, and only a completed " +
      "one replaces the card.",
  )
  @Post()
  async startSetup(@Param("tenantId") tenantId: string): Promise<StartCardSetupResult> {
    const owner = await this.owner(tenantId);
    const started = await this.accounts.startCardSetup(
      owner,
      `/studio/billing?business=${encodeURIComponent(tenantId)}`,
    );
    if (started.isErr()) {
      logger.warn(`card setup for ${tenantId} failed: ${started.error.detail}`);
      if (started.error.kind === "declined") {
        throw new HttpException(
          { code: "payment_declined", message: "The card page could not be opened." },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      throw new ServiceUnavailableException({
        code: "payment_unavailable",
        message: "The card page could not be opened. Try again.",
      });
    }
    return started.value.kind === "redirect"
      ? { checkoutUrl: started.value.checkoutUrl, card: null }
      : { checkoutUrl: null, card: started.value.card };
  }

  private async owner(tenantId: string): Promise<PaymentOwner> {
    const business = await this.businesses.findRegionAndCurrency(tenantId);
    if (business === null) throw new NotFoundException({ code: "business_not_found" });
    return { kind: "business", id: tenantId, region: business.region };
  }
}
