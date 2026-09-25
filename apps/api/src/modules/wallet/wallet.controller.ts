import {
  BadGatewayException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ResultAsync } from "neverthrow";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type {
  WalletHistoryPage,
  WalletQr,
  WalletSummary,
  WalletVoucher,
  WalletVoucherPage,
} from "@yourtal/contracts/wallet/wallet";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import {
  LEDGER_INTERNAL_CLIENT,
  type LedgerInternalClient,
} from "../../shared/ledger-client/ledger-internal-client";
import {
  VOUCHER_INTERNAL_CLIENT,
  type VoucherInternalClient,
} from "../../shared/voucher-client/voucher-internal-client";
import { USER_PROFILE_REPOSITORY } from "../identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import { toWalletHistoryEntry, toWalletSummary, toWalletVoucher } from "./wallet-mapping";

const HISTORY_PAGE = 20;

/**
 * The viewer's wallet (TASKS.md 4.8.a): points from the ledger, vouchers
 * from the voucher service, always the caller's own (`WalletAttributeLoader`).
 */
@Controller("api/wallet")
export class WalletController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
    @Inject(VOUCHER_INTERNAL_CLIENT) private readonly vouchers: VoucherInternalClient,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
  ) {}

  @Authorize({ kind: "wallet", action: "view" })
  @Get()
  async summary(@Req() request: FastifyRequest): Promise<WalletSummary> {
    const userId = this.principals.resolve(request).id;
    const profile = await this.profiles.findByUserId(userId);
    if (profile === null) throw new NotFoundException("No such wallet.");
    return toWalletSummary(profile.region, await unwrap(this.ledger.balance(userId)));
  }

  @Authorize({ kind: "wallet", action: "view_history" })
  @Get("history")
  async history(
    @Req() request: FastifyRequest,
    @Query("startingAfter") startingAfter?: string,
  ): Promise<WalletHistoryPage> {
    const userId = this.principals.resolve(request).id;
    // One extra row says whether there is a next page.
    const rows = await unwrap(
      this.ledger.history({
        userId,
        limit: HISTORY_PAGE + 1,
        ...(startingAfter === undefined || startingAfter === "" ? {} : { startingAfter }),
      }),
    );
    const page = rows.slice(0, HISTORY_PAGE);
    return {
      entries: page.map(toWalletHistoryEntry),
      nextCursor: rows.length > HISTORY_PAGE ? (page.at(-1)?.id ?? null) : null,
    };
  }

  @Authorize({ kind: "wallet", action: "view" })
  @Get("vouchers")
  async list(
    @Req() request: FastifyRequest,
    @Query("startingAfter") startingAfter?: string,
  ): Promise<WalletVoucherPage> {
    const userId = this.principals.resolve(request).id;
    const page = await unwrap(
      this.vouchers.listForUser({
        userId,
        limit: HISTORY_PAGE,
        ...(startingAfter === undefined || startingAfter === "" ? {} : { startingAfter }),
      }),
    );
    return { vouchers: page.vouchers.map(toWalletVoucher), hasMore: page.hasMore };
  }

  @Authorize({ kind: "wallet", action: "view" })
  @Get("vouchers/:voucherId")
  async voucher(
    @Req() request: FastifyRequest,
    @Param("voucherId") voucherId: string,
  ): Promise<WalletVoucher> {
    const ownerId = this.principals.resolve(request).id;
    return toWalletVoucher(await unwrap(this.vouchers.get({ voucherId, ownerId })));
  }

  @Authorize({ kind: "wallet", action: "view" })
  @Get("vouchers/:voucherId/qr")
  async qr(
    @Req() request: FastifyRequest,
    @Param("voucherId") voucherId: string,
  ): Promise<WalletQr> {
    const ownerId = this.principals.resolve(request).id;
    const qr = await unwrap(this.vouchers.qrToken({ voucherId, ownerId }));
    return { voucherId: qr.voucherId, token: qr.token, expiresAt: qr.expiresAt };
  }
}

// Reads refuse only when a service is down or disagrees; neither is the viewer's fault.
async function unwrap<T>(result: ResultAsync<T, LedgerError>): Promise<T> {
  const settled = await result;
  if (settled.isErr()) {
    throw new BadGatewayException({
      code: settled.error.code,
      message: "The wallet is unavailable.",
    });
  }
  return settled.value;
}
