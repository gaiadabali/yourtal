import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import { startBidderCardBodySchema } from "@yourtal/contracts/auction/auction";
import type { BillingCard, StartCardSetupResult } from "@yourtal/contracts/billing";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { USER_PROFILE_REPOSITORY } from "../identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import type { PaymentOwner } from "../payments/payment-accounts.repository";
import { PAYMENT_ACCOUNTS_SERVICE } from "../payments/payment-accounts.service";
import type { PaymentAccountsService } from "../payments/payment-accounts.service";
import { notFound } from "./use-cases/auction-errors";

class StartBidderCardDto extends createZodDto(startBidderCardBodySchema) {}

const logger = new Logger("BidderCard");

/**
 * 5.1.d (F86): the card a bid holds, for the signed-in adult only. Where the region's processor
 * charges a saved card (AU on Stripe) a bid needs one; saving opens the processor's own page, or is
 * done in the request on the simulated driver. Only brand, last four and expiry leave the server.
 * `auction.yaml` refuses teens, suspended accounts and the other region.
 */
@Controller("api/me/payment-card")
export class BidderCardController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(PAYMENT_ACCOUNTS_SERVICE) private readonly accounts: PaymentAccountsService,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
  ) {}

  @Authorize({ kind: "auction", action: "view_card" })
  @NotValueMoving("A read.")
  @Get()
  async card(@Req() request: FastifyRequest): Promise<BillingCard> {
    const owner = await this.owner(request);
    const stored = await this.accounts.liveCard(owner);
    return {
      card: stored?.card ?? null,
      required: this.accounts.driverFor(owner).needsSavedCard,
    };
  }

  @Authorize({ kind: "auction", action: "update_card" })
  @NotValueMoving(
    "Saving a card charges nothing. A repeat opens another setup page, and only a completed " +
      "one replaces the card.",
  )
  @Post()
  async startSetup(
    @Req() request: FastifyRequest,
    @Body() body: StartBidderCardDto,
  ): Promise<StartCardSetupResult> {
    const owner = await this.owner(request);
    // A path built here from an id, never a URL from the client: the page comes back to the auction.
    const returnPath = body.auctionId === undefined ? "/auctions" : `/auctions/${body.auctionId}`;
    const started = await this.accounts.startCardSetup(owner, returnPath);
    if (started.isErr()) {
      logger.warn(`card setup for a bidder failed: ${started.error.detail}`);
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

  private async owner(request: FastifyRequest): Promise<PaymentOwner> {
    const userId = (await this.principals.resolve(request)).id;
    const profile = await this.profiles.findByUserId(userId);
    if (profile === null) throw notFound();
    return { kind: "user", id: userId, region: profile.region };
  }
}
