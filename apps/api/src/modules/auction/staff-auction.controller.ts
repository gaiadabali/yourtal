import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { StaffAction, setStaffAuditContext } from "../staff/staff-action.decorator";
import { AuctionService } from "./auction.service";

const cancelBodySchema = z.object({ reason: z.string().trim().min(3).max(500) });

const hasReason = (request: FastifyRequest) => {
  const reason = (request.body as { reason?: unknown } | undefined)?.reason;
  return { hasReason: typeof reason === "string" && reason.trim().length >= 3 };
};

/**
 * 13.22.g: `/staff/auctions`. Ops see every region's open auctions and cancel
 * one with a required reason: every hold is released, the voucher goes back
 * to the seller, and the staff audit trail records it. Who bid is never shown.
 */
@Controller("api/staff/auctions")
export class StaffAuctionController {
  constructor(@Inject(AuctionService) private readonly auctions: AuctionService) {}

  @StaffAction("auction.list")
  @Authorize({ kind: "auction", action: "review" })
  @NotValueMoving("A read.")
  @Get()
  async list() {
    return { auctions: await this.auctions.openForStaff() };
  }

  @StaffAction("auction.cancel")
  @Authorize({ kind: "auction", action: "cancel", attrsFrom: hasReason })
  @NotValueMoving(
    "Only an open auction can be cancelled: a retry after the first call gets 409, never a second release.",
  )
  @Post(":auctionId/cancel")
  async cancel(
    @Param("auctionId") auctionId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    const parsed = cancelBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ code: "invalid_cancel", message: "a reason is required" });
    }
    const cancelled = await this.auctions.cancel(auctionId, parsed.data.reason);
    if (!cancelled) {
      throw new ConflictException({ code: "auction_not_open", message: "Not open." });
    }
    const auction = await this.auctions.view(auctionId, null);
    setStaffAuditContext(request, {
      targetKind: "auction",
      targetId: auctionId,
      region: auction.region,
      reason: parsed.data.reason,
    });
    return auction;
  }
}
