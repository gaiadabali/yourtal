import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import {
  listVoucherForAuctionBodySchema,
  placeBidBodySchema,
  type Auction,
  type AuctionList,
} from "@yourtal/contracts/auction/auction";
import { Inject } from "@nestjs/common";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { USER_PROFILE_REPOSITORY } from "../identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import { AuctionService } from "./auction.service";
import { notFound } from "./use-cases/auction-errors";

class ListVoucherDto extends createZodDto(listVoucherForAuctionBodySchema) {}
class PlaceBidDto extends createZodDto(placeBidBodySchema) {}

const RETENTION_MS = 4 * 24 * 60 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 13.22 (F86): list a voucher for a charity, browse, bid, and the caller's
 * own bids and listings. Teens, anonymous visitors and the other region are
 * refused by `auction.yaml` (and listing by `wallet.yaml`'s teen rule).
 */
@Controller("api")
export class AuctionController {
  constructor(
    private readonly principals: PrincipalService,
    private readonly auctions: AuctionService,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
  ) {}

  @Idempotent({ retentionMs: RETENTION_MS })
  @Authorize({ kind: "wallet", action: "transfer" })
  @Post("wallet/vouchers/:voucherId/auction")
  async list(
    @Req() request: FastifyRequest,
    @Param("voucherId") voucherId: string,
    @Body() body: ListVoucherDto,
  ): Promise<Auction> {
    const userId = (await this.principals.resolve(request)).id;
    return this.auctions.list(userId, voucherId, body.charityId);
  }

  @Authorize({ kind: "auction", action: "view" })
  @NotValueMoving("A read.")
  @Get("auctions")
  async browse(
    @Req() request: FastifyRequest,
    @Query("charityId") charityId?: string,
    @Query("category") category?: string,
  ): Promise<AuctionList> {
    const userId = (await this.principals.resolve(request)).id;
    const profile = await this.profiles.findByUserId(userId);
    if (profile === null) throw notFound();
    const filter = {
      ...(charityId !== undefined && UUID.test(charityId) ? { charityId } : {}),
      ...(category !== undefined && category !== "" ? { category } : {}),
    };
    return { auctions: await this.auctions.browse(profile.region, userId, filter) };
  }

  @Authorize({ kind: "auction", action: "view" })
  @NotValueMoving("A read.")
  @Get("auctions/mine/bids")
  async myBids(@Req() request: FastifyRequest): Promise<AuctionList> {
    const userId = (await this.principals.resolve(request)).id;
    return { auctions: await this.auctions.mine(userId, "bids") };
  }

  @Authorize({ kind: "auction", action: "view" })
  @NotValueMoving("A read.")
  @Get("auctions/mine/listings")
  async myListings(@Req() request: FastifyRequest): Promise<AuctionList> {
    const userId = (await this.principals.resolve(request)).id;
    return { auctions: await this.auctions.mine(userId, "listings") };
  }

  @Authorize({ kind: "auction", action: "view" })
  @NotValueMoving("A read; an auction past its close is settled first.")
  @Get("auctions/:auctionId")
  async view(
    @Req() request: FastifyRequest,
    @Param("auctionId") auctionId: string,
  ): Promise<Auction> {
    const userId = (await this.principals.resolve(request)).id;
    return this.auctions.view(auctionId, userId);
  }

  @Idempotent({ retentionMs: RETENTION_MS })
  @Authorize({ kind: "auction", action: "bid" })
  @Post("auctions/:auctionId/bids")
  async bid(
    @Req() request: FastifyRequest,
    @Param("auctionId") auctionId: string,
    @Body() body: PlaceBidDto,
  ): Promise<Auction> {
    const userId = (await this.principals.resolve(request)).id;
    return this.auctions.bid(userId, auctionId, body.amountMinor);
  }
}
