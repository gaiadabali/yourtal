import {
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import type { CharityPayouts, PayoutLink } from "@yourtal/contracts/billing/payouts";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import type { PayoutOwner } from "../payouts/connected-account.repository";
import { CONNECTED_ACCOUNTS_SERVICE } from "../payouts/connected-accounts.service";
import type { ConnectedAccountsService } from "../payouts/connected-accounts.service";
import { linkOrThrow } from "../payouts/payout-link";
import { CHARITY_DB, CharityRepository } from "./charity.repository";

/**
 * 5.2 (F103): an AU charity's Stripe account, where its auctions' proceeds
 * are captured. Set up on the processor's own page by the charity's members;
 * once it can take charges and pay out, it becomes the charity's payout
 * reference (charity.module.ts). Indonesia has none (F104).
 */
@Controller("api/charities/:charityId/payouts")
export class CharityPayoutsController {
  constructor(
    @Inject(CHARITY_DB) private readonly charities: CharityRepository,
    @Inject(CONNECTED_ACCOUNTS_SERVICE) private readonly accounts: ConnectedAccountsService,
  ) {}

  @Authorize({ kind: "charity", action: "view_console" })
  @NotValueMoving("A read; it may store the processor's newer view of the account.")
  @Get()
  async status(@Param("charityId") charityId: string): Promise<CharityPayouts> {
    return { account: await this.accounts.status(await this.owner(charityId, false)) };
  }

  @Authorize({ kind: "charity", action: "manage_payouts" })
  @NotValueMoving(
    "Opens the processor's page to set up the account or change its bank; no money moves, and " +
      "a repeat only makes another link to the same account.",
  )
  @Post("link")
  async link(@Param("charityId") charityId: string): Promise<PayoutLink> {
    const owner = await this.owner(charityId, true);
    if (owner === null) {
      throw new NotFoundException({
        code: "payouts_unavailable",
        message: "Payouts to a bank account are not offered in this region.",
      });
    }
    const console = `/charity/${encodeURIComponent(charityId)}`;
    return linkOrThrow(
      await this.accounts.startLink(owner, {
        returnPath: console,
        refreshPath: `${console}/payouts/refresh`,
      }),
      `charity ${charityId}`,
    );
  }

  private async owner(charityId: string, mustBeApproved: boolean): Promise<PayoutOwner | null> {
    const charity = await this.charities.findDetail(charityId);
    if (charity === null) throw new NotFoundException("No such charity.");
    if (mustBeApproved && charity.state !== "approved") {
      throw new ConflictException({
        code: "charity_not_approved",
        message: "Payouts are set up once the charity is approved.",
      });
    }
    return charity.region === "AU" ? { kind: "charity", id: charityId, region: "AU" } : null;
  }
}
