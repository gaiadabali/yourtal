import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ResultAsync } from "neverthrow";
import { createZodDto } from "nestjs-zod";
import type {
  VoucherGift,
  VoucherGiftError,
  VoucherGiftErrorCode,
} from "@yourtal/contracts/voucher-internal/gifts";
import {
  giftVoucherBodySchema,
  type WalletGift,
  type WalletGiftList,
  type WalletGiftRefusal,
} from "@yourtal/contracts/wallet/wallet-gift";
import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import { Idempotent } from "../../shared/idempotency/idempotent.decorator";
import {
  VOUCHER_INTERNAL_CLIENT,
  type VoucherInternalClient,
} from "../../shared/voucher-client/voucher-internal-client";
import { GIFT_PARTY_READER, type GiftParty, type GiftPartyReader } from "./gift-party-reader";
import { GiftNotifier } from "./gift-notifier";

class GiftVoucherDto extends createZodDto(giftVoucherBodySchema) {}

const GIFT_RETENTION_MS = 8 * 24 * 60 * 60_000;

/**
 * 13.20.b (F86): gift an unused voucher to another verified adult in the
 * same region. Teens can neither send nor receive (wallet.yaml); a
 * recipient who is missing, unverified, under 18, suspended or in the other
 * region gets one refusal, so an email reveals nothing about its owner.
 */
@Controller("api/wallet")
export class WalletGiftController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(VOUCHER_INTERNAL_CLIENT) private readonly vouchers: VoucherInternalClient,
    @Inject(GIFT_PARTY_READER) private readonly parties: GiftPartyReader,
    private readonly notifier: GiftNotifier,
  ) {}

  @Idempotent({ retentionMs: GIFT_RETENTION_MS })
  @Authorize({ kind: "wallet", action: "transfer" })
  @Post("vouchers/:voucherId/gift")
  async gift(
    @Req() request: FastifyRequest,
    @Param("voucherId") voucherId: string,
    @Body() body: GiftVoucherDto,
  ): Promise<WalletGift> {
    const userId = (await this.principals.resolve(request)).id;
    const sender = await this.parties.byUserId(userId);
    if (!isEligible(sender))
      throw refusal("gift_sender_ineligible", "This account cannot send gifts.");

    const recipient = await this.parties.byEmail(body.recipientEmail);
    if (recipient?.userId === userId) throw refusal("gift_to_self", "That is your own account.");
    if (!isEligible(recipient) || recipient.region !== sender.region) {
      throw refusal("gift_recipient_ineligible", "No account can receive this gift.");
    }

    const gift = await unwrap(
      this.vouchers.gift({
        voucherId,
        senderId: userId,
        recipientId: recipient.userId,
        recipientRegion: recipient.region,
      }),
    );
    await this.notifier.received(gift);
    return this.present(gift, userId);
  }

  @Authorize({ kind: "wallet", action: "view" })
  @Get("gifts")
  async list(@Req() request: FastifyRequest): Promise<WalletGiftList> {
    const userId = (await this.principals.resolve(request)).id;
    const { gifts } = await unwrap(this.vouchers.listGifts({ userId }));
    return { gifts: await Promise.all(gifts.map((gift) => this.present(gift, userId))) };
  }

  @Idempotent({ retentionMs: GIFT_RETENTION_MS })
  @Authorize({ kind: "wallet", action: "receive_voucher" })
  @Post("gifts/:giftId/accept")
  @HttpCode(200)
  async accept(
    @Req() request: FastifyRequest,
    @Param("giftId") giftId: string,
  ): Promise<WalletGift> {
    const userId = (await this.principals.resolve(request)).id;
    const recipient = await this.parties.byUserId(userId);
    if (!isEligible(recipient))
      throw refusal("gift_recipient_ineligible", "This gift cannot be accepted.");
    const gift = await unwrap(
      this.vouchers.acceptGift({ giftId: uuidOrNil(giftId), recipientId: userId }),
    );
    return this.present(gift, userId);
  }

  @Idempotent({ retentionMs: GIFT_RETENTION_MS })
  @Authorize({ kind: "wallet", action: "view" })
  @Post("gifts/:giftId/decline")
  @HttpCode(200)
  async decline(
    @Req() request: FastifyRequest,
    @Param("giftId") giftId: string,
  ): Promise<WalletGift> {
    const userId = (await this.principals.resolve(request)).id;
    const gift = await unwrap(
      this.vouchers.declineGift({ giftId: uuidOrNil(giftId), recipientId: userId }),
    );
    await this.notifier.returned(gift);
    return this.present(gift, userId);
  }

  private async present(gift: VoucherGift, userId: string): Promise<WalletGift> {
    const received = gift.recipientId === userId;
    const sender = received ? await this.parties.byUserId(gift.senderId) : null;
    return {
      giftId: gift.giftId,
      direction: received ? "received" : "sent",
      status: gift.state,
      senderDisplayName: sender?.displayName ?? null,
      voucherId: received || gift.state === "returned" ? gift.voucherId : gift.sourceVoucherId,
      title: gift.title,
      merchantName: gift.merchantName,
      currency: gift.currency,
      faceValueMinor: gift.faceValueMinor,
      voucherExpiresAt: gift.voucherExpiresAt,
      createdAt: gift.createdAt,
      acceptBy: gift.expiresAt,
      resolvedAt: gift.resolvedAt,
    };
  }
}

function isEligible(party: GiftParty | null): party is GiftParty {
  return (
    party !== null &&
    !party.suspended &&
    ageBandFrom(ageYearsFrom(party.dateOfBirth, new Date())) === "adult"
  );
}

const REFUSALS: Partial<Record<VoucherGiftErrorCode, WalletGiftRefusal>> = {
  not_unused: "gift_not_unused",
  not_transferable: "gift_not_transferable",
  already_gifted: "gift_already_gifted",
  holdback: "gift_holdback",
  velocity_capped: "gift_velocity_capped",
  region_mismatch: "gift_recipient_ineligible",
  gift_to_self: "gift_to_self",
  not_pending: "gift_not_pending",
  window_closed: "gift_window_closed",
};

function refusal(code: WalletGiftRefusal, message: string): ConflictException {
  return new ConflictException({ code, message });
}

async function unwrap<T>(result: ResultAsync<T, VoucherGiftError>): Promise<T> {
  const settled = await result;
  if (settled.isOk()) return settled.value;
  const { code, message } = settled.error;
  if (code === "not_found")
    throw new NotFoundException({ code, message: "No such voucher or gift." });
  const mapped = REFUSALS[code];
  if (mapped !== undefined) throw refusal(mapped, message);
  throw new BadGatewayException({ code, message: "The wallet is unavailable." });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed id names no gift anyone was sent. */
function uuidOrNil(value: string): string {
  return UUID.test(value) ? value : "00000000-0000-0000-0000-000000000000";
}
