import { BadGatewayException, Controller, Delete, Get, Inject, Req } from "@nestjs/common";
import type { ResultAsync } from "neverthrow";
import type { LedgerHistoryEntry } from "@yourtal/contracts/ledger-internal/wallet";
import type { WalletVoucherRow } from "@yourtal/contracts/voucher-internal/wallet";
import type { FastifyRequest } from "fastify";
import type { DeletionReport } from "@yourtal/consent/dsar-orchestrator";
import { executeDeletion } from "@yourtal/consent/dsar-orchestrator";
import { deletionPlan } from "@yourtal/consent/dsar";
import { deletionHandlers } from "../../shared/dsar/deletion-handlers";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import { VOUCHER_INTERNAL_CLIENT } from "../../shared/voucher-client/voucher-internal-client";
import type { VoucherInternalClient } from "../../shared/voucher-client/voucher-internal-client";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
import { buildDataExportSections } from "./data-export";
import { ME_PG_POOL } from "./me.tokens";
import type { MePgPool } from "./me.tokens";
import { CONSENT_RECORD_REPOSITORY } from "./persistence/consent-record.repository";
import type { ConsentRecordRepository } from "./persistence/consent-record.repository";
import { INTEREST_REPOSITORY } from "./persistence/interest.repository";
import type { InterestRepository } from "./persistence/interest.repository";
import { FOLLOW_REPOSITORY } from "./persistence/follow.repository";
import type { FollowRepository } from "./persistence/follow.repository";
import { SAVE_REPOSITORY } from "./persistence/save.repository";
import type { SaveRepository } from "./persistence/save.repository";
import { DATA_EXPORT_READER } from "./persistence/data-export.reader";
import type { DataExportReader } from "./persistence/data-export.reader";
import { STREAK_STATE_REPOSITORY } from "./persistence/streak-state.repository";
import type { StreakStateRepository } from "./persistence/streak-state.repository";

const EXPORT_PAGE = 100;
/** A ceiling on pages per list, so one export cannot hold a request open forever. */
const EXPORT_MAX_PAGES = 50;
const EXPORT_MAX_SESSIONS = 5000;

async function settle<T>(result: ResultAsync<T, { code: string }>): Promise<T> {
  const settled = await result;
  if (settled.isErr()) {
    throw new BadGatewayException({
      code: settled.error.code,
      message: "Your wallet could not be read just now.",
    });
  }
  return settled.value;
}

/**
 * `DELETE /api/me` and `GET /api/me/data-export` (5.4.b). Deletion runs
 * `@yourtal/consent`'s `executeDeletion` against `deletionHandlers`
 * (A's, 13.24: Postgres's plus the ledger's) — the `identity` handler erases
 * business membership, `user_profile`, `credential` and `session` in one
 * pass (1.4.f, done for exactly this ticket), which is what ends every
 * session and removes the profile. Domains with no handler yet (`watch_
 * sessions`, ...) come back `unhandled` in the report rather than
 * silently reported done — see `dsar-orchestrator.ts`'s own header for why.
 */
@Controller("api/me")
export class AccountController {
  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    @Inject(ME_PG_POOL) private readonly pool: MePgPool,
    @Inject(CONSENT_RECORD_REPOSITORY) private readonly consents: ConsentRecordRepository,
    @Inject(INTEREST_REPOSITORY) private readonly interests: InterestRepository,
    @Inject(FOLLOW_REPOSITORY) private readonly follows: FollowRepository,
    @Inject(SAVE_REPOSITORY) private readonly saves: SaveRepository,
    @Inject(STREAK_STATE_REPOSITORY) private readonly streaks: StreakStateRepository,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
    @Inject(VOUCHER_INTERNAL_CLIENT) private readonly vouchers: VoucherInternalClient,
    @Inject(DATA_EXPORT_READER) private readonly exportReader: DataExportReader,
  ) {}

  /** Every ledger entry for the caller, newest first, page by page. */
  private async allHistory(userId: string): Promise<LedgerHistoryEntry[]> {
    const entries: LedgerHistoryEntry[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < EXPORT_MAX_PAGES; page += 1) {
      const rows = await settle(
        this.ledger.history({
          userId,
          limit: EXPORT_PAGE,
          ...(startingAfter === undefined ? {} : { startingAfter }),
        }),
      );
      entries.push(...rows);
      const last = rows.at(-1);
      if (rows.length < EXPORT_PAGE || last === undefined) break;
      startingAfter = last.id;
    }
    return entries;
  }

  private async allVouchers(userId: string): Promise<WalletVoucherRow[]> {
    const rows: WalletVoucherRow[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < EXPORT_MAX_PAGES; page += 1) {
      const result = await settle(
        this.vouchers.listForUser({
          userId,
          limit: EXPORT_PAGE,
          ...(startingAfter === undefined ? {} : { startingAfter }),
        }),
      );
      rows.push(...result.vouchers);
      const last = result.vouchers.at(-1);
      if (!result.hasMore || last === undefined) break;
      startingAfter = last.voucherId;
    }
    return rows;
  }

  // A repeated delete-account call must not run the deletion a second time.
  @Idempotent({ retentionMs: 24 * 60 * 60 * 1000 })
  @Authorize({ kind: "me", action: "delete_account" })
  @Delete()
  async deleteAccount(@Req() request: FastifyRequest): Promise<DeletionReport> {
    const userId = (await this.principals.resolve(request)).id;
    return executeDeletion(userId, deletionHandlers(this.pool, this.ledger));
  }

  @Authorize({ kind: "me", action: "export_data" })
  @NotValueMoving("A read-only export of the caller's own data.")
  @Get("data-export")
  async exportData(@Req() request: FastifyRequest) {
    const userId = (await this.principals.resolve(request)).id;
    const [consents, interests, followed, saved, streak, account, history, vouchers, sessions] =
      await Promise.all([
        this.consents.listForUser(userId),
        this.interests.listForUser(userId),
        this.follows.listForUser(userId),
        this.saves.listForUser(userId),
        this.streaks.find(userId),
        this.exportReader.account(userId),
        this.allHistory(userId),
        this.allVouchers(userId),
        this.exportReader.watchSessions(userId, EXPORT_MAX_SESSIONS),
      ]);
    const now = new Date();
    const held = buildDataExportSections({ now, account, history, vouchers, sessions });

    return {
      generatedAt: now.toISOString(),
      account: held.account,
      wallet: held.wallet,
      vouchers: held.vouchers,
      watchSessions: held.watchSessions,
      consents,
      interests,
      follows: followed,
      saves: saved,
      streak,
      // Named honestly per @yourtal/consent/dsar's own design: this export
      // covers what this module holds, not the other 9 data domains a full
      // DSAR (delete-account) accounts for — that list stays visible here
      // too, rather than implying completeness this route cannot provide.
      otherDataDomains: deletionPlan().map((domain) => ({ id: domain.id, holds: domain.holds })),
    };
  }
}
