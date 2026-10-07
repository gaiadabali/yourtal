import {
  BadGatewayException,
  ConflictException,
  Controller,
  Get,
  Header,
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
  WalletVoucherDetail,
  WalletVoucherPage,
} from "@yourtal/contracts/wallet/wallet";
import type { WalletVoucherRow } from "@yourtal/contracts/voucher-internal/wallet";
import { ageBandFrom, ageYearsFrom } from "@yourtal/jurisdiction/age";
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
import { REGION_SETTINGS_READER } from "../../shared/settings/region-settings-reader";
import type { RegionSettingsReader } from "../../shared/settings/region-settings-reader";
import { USER_PROFILE_REPOSITORY } from "../identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import { toWalletHistoryEntry, toWalletSummary, toWalletVoucher } from "./wallet-mapping";

/** F12's key in `platform.region_setting` for a teen's own daily earn cap. */
const TEEN_DAILY_EARN_CAP_SETTING = "teen_daily_earn_cap";

const HISTORY_PAGE = 20;

/** A code is only worth showing while a counter or checkout would still accept it. */
function isCodeUsable(row: WalletVoucherRow, nowMs: number): boolean {
  return (
    (row.lifecycleState === "active" || row.lifecycleState === "held") &&
    new Date(row.expiresAt).getTime() > nowMs
  );
}

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
    @Inject(REGION_SETTINGS_READER) private readonly settings: RegionSettingsReader,
  ) {}

  @Authorize({ kind: "wallet", action: "view" })
  @Get()
  async summary(@Req() request: FastifyRequest): Promise<WalletSummary> {
    const userId = (await this.principals.resolve(request)).id;
    const profile = await this.profiles.findByUserId(userId);
    if (profile === null) throw new NotFoundException("No such wallet.");
    const balance = await unwrap(this.ledger.balance(userId));

    // 12.2.b: a teen's own daily-cap meter reads this same summary — never
    // hardcoded, read from the region's own settings, and simply absent for
    // an adult (no such meter exists for one).
    const isTeen = ageBandFrom(ageYearsFrom(profile.dateOfBirth, new Date())) === "teen";
    const dailyCapPoints = isTeen
      ? await this.settings.getSetting<number>(profile.region, TEEN_DAILY_EARN_CAP_SETTING)
      : null;

    return toWalletSummary(profile.region, balance, dailyCapPoints ?? undefined);
  }

  @Authorize({ kind: "wallet", action: "view_history" })
  @Get("history")
  async history(
    @Req() request: FastifyRequest,
    @Query("startingAfter") startingAfter?: string,
  ): Promise<WalletHistoryPage> {
    const userId = (await this.principals.resolve(request)).id;
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
    const userId = (await this.principals.resolve(request)).id;
    const page = await unwrap(
      this.vouchers.listForUser({
        userId,
        limit: HISTORY_PAGE,
        ...(startingAfter === undefined || startingAfter === "" ? {} : { startingAfter }),
      }),
    );
    return { vouchers: page.vouchers.map(toWalletVoucher), hasMore: page.hasMore };
  }

  /**
   * 13.3.o: the one read that carries the redemption code. Ownership is
   * settled twice before the code leaves custody: `WalletAttributeLoader`
   * (a voucher the caller does not hold is a 404 before this runs) and the
   * voucher service's own owner-scoped `reveal`. The code is sent only while
   * the voucher can still be redeemed, and `no-store` keeps it out of any
   * cache between here and the screen. A failed reveal drops the code and
   * keeps the voucher: the QR still works. Never log the code or this body.
   */
  @Authorize({ kind: "wallet", action: "view" })
  @Header("Cache-Control", "no-store")
  @Get("vouchers/:voucherId")
  async voucher(
    @Req() request: FastifyRequest,
    @Param("voucherId") voucherId: string,
  ): Promise<WalletVoucherDetail> {
    const ownerId = (await this.principals.resolve(request)).id;
    const row = await unwrap(this.vouchers.get({ voucherId, ownerId }));
    const voucher = toWalletVoucher(row);
    if (!isCodeUsable(row, Date.now())) return voucher;
    const revealed = await this.vouchers.reveal({ voucherId, ownerId });
    return revealed.isOk() ? { ...voucher, code: revealed.value.code } : voucher;
  }

  @Authorize({ kind: "wallet", action: "view" })
  @Get("vouchers/:voucherId/qr")
  async qr(
    @Req() request: FastifyRequest,
    @Param("voucherId") voucherId: string,
  ): Promise<WalletQr> {
    const ownerId = (await this.principals.resolve(request)).id;
    const qr = await unwrap(this.vouchers.qrToken({ voucherId, ownerId }));
    return {
      voucherId: qr.voucherId,
      token: qr.token,
      expiresAt: qr.expiresAt,
      ...(qr.tokens === undefined ? {} : { tokens: qr.tokens }),
    };
  }
}

// Reads refuse only when a service is down or disagrees; neither is the viewer's fault.
// The two exceptions are about the voucher itself: not this viewer's, or no
// longer spendable (a voided voucher asked for a QR).
async function unwrap<T>(result: ResultAsync<T, LedgerError>): Promise<T> {
  const settled = await result;
  if (settled.isErr()) {
    const { code } = settled.error;
    if (code === "audience_blocked") {
      throw new NotFoundException({ code, message: "No such voucher." });
    }
    if (code === "already_granted") {
      throw new ConflictException({ code, message: "This voucher can no longer be used." });
    }
    throw new BadGatewayException({
      code: settled.error.code,
      message: "The wallet is unavailable.",
    });
  }
  return settled.value;
}
