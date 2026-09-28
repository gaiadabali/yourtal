import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { ResultAsync } from "neverthrow";
import { createZodDto } from "nestjs-zod";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import { toPoints } from "@yourtal/contracts/money";
import {
  goodwillRequestSchema,
  setTrustTierRequestSchema,
  staffUserDetailSchema,
  staffUserLedgerHistorySchema,
  staffUserSearchQuerySchema,
  staffUserSearchResultSchema,
  suspendUserRequestSchema,
  type GoodwillResult,
  type ReleaseUserResult,
  type SetTrustTierResult,
  type StaffUserDetail,
  type StaffUserLedgerHistory,
  type StaffUserSearchResult,
  type StaffUserSummary,
  type SuspendUserResult,
} from "@yourtal/contracts/staff/users";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import { Idempotent } from "../../shared/idempotency/idempotent.decorator";
import {
  LEDGER_INTERNAL_CLIENT,
  type LedgerInternalClient,
} from "../../shared/ledger-client/ledger-internal-client";
import { StaffAction, setStaffAuditContext } from "./staff-action.decorator";
import { STAFF_USER_DIRECTORY } from "./persistence/staff-user-directory";
import type { StaffUserDirectory, StaffUserRow } from "./persistence/staff-user-directory";
import { STAFF_SUSPENSION_REPOSITORY } from "./persistence/staff-suspension-repository";
import type { StaffSuspensionRepository } from "./persistence/staff-suspension-repository";

class SearchQueryDto extends createZodDto(staffUserSearchQuerySchema) {}
class SuspendDto extends createZodDto(suspendUserRequestSchema) {}
class GoodwillDto extends createZodDto(goodwillRequestSchema) {}
class SetTrustTierDto extends createZodDto(setTrustTierRequestSchema) {}

function toSummary(row: StaffUserRow): StaffUserSummary {
  return {
    userId: row.userId,
    email: row.email,
    region: row.region,
    trustTier: row.trustTier,
    isSuspended: row.isSuspended,
    createdAt: row.createdAt.toISOString(),
  };
}

function idempotencyKeyOf(request: FastifyRequest): string {
  const raw = request.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value.length === 0) {
    throw new ConflictException({
      code: "idempotency_key_required",
      message: "This route requires an Idempotency-Key header.",
    });
  }
  return value;
}

/**
 * TASKS.md 9.4.a-c: search, view and act on a consumer account. `suspend`
 * and `release` are 9.4.b; `goodwill` is 9.4.c. Trust tier (9.4.d) is its
 * own controller below, same file for the pair's shared helpers.
 */
@Controller("api/staff/users")
export class StaffUsersController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(STAFF_USER_DIRECTORY) private readonly users: StaffUserDirectory,
    @Inject(STAFF_SUSPENSION_REPOSITORY) private readonly suspensions: StaffSuspensionRepository,
    @Inject(LEDGER_INTERNAL_CLIENT) private readonly ledger: LedgerInternalClient,
  ) {}

  @StaffAction("user.search")
  @Authorize({ kind: "user_account", action: "view", idFrom: () => "search" })
  @Get()
  async search(@Query() query: SearchQueryDto): Promise<StaffUserSearchResult> {
    const rows = await this.users.search(query);
    return staffUserSearchResultSchema.parse(rows.map(toSummary));
  }

  @StaffAction("user.view")
  @Authorize({ kind: "user_account", action: "view" })
  @Get(":userId")
  async detail(
    @Param("userId") userId: string,
    @Req() request: FastifyRequest,
  ): Promise<StaffUserDetail> {
    const target = await this.requireUser(userId);
    const balance = await unwrapLedger(this.ledger.balance(userId));
    const pendingTotal = balance.pending.reduce((sum, bucket) => sum + bucket.points, 0);
    setStaffAuditContext(request, { targetKind: "user", targetId: userId, region: target.region });
    return staffUserDetailSchema.parse({
      ...toSummary(target),
      availablePoints: balance.availablePoints,
      pendingPoints: toPoints(pendingTotal),
    });
  }

  @StaffAction("user.view_ledger")
  @Authorize({ kind: "user_account", action: "view" })
  @Get(":userId/ledger")
  async ledgerHistory(
    @Param("userId") userId: string,
    @Req() request: FastifyRequest,
  ): Promise<StaffUserLedgerHistory> {
    const target = await this.requireUser(userId);
    const rows = await unwrapLedger(this.ledger.history({ userId, limit: 100 }));
    setStaffAuditContext(request, { targetKind: "user", targetId: userId, region: target.region });
    return staffUserLedgerHistorySchema.parse(rows);
  }

  /**
   * TASKS.md 9.4.b: escrows available AND pending points (never zeroes a
   * balance) before marking the account suspended, so a crash between the
   * two steps is recoverable by retrying -- `ledger.escrow` replays on the
   * same idempotency key instead of double-moving points.
   */
  @StaffAction("user.suspend")
  @Idempotent({ retentionMs: 24 * 60 * 60_000 })
  @Authorize({ kind: "user_account", action: "suspend" })
  @Post(":userId/suspend")
  async suspend(
    @Param("userId") userId: string,
    @Body() body: SuspendDto,
    @Req() request: FastifyRequest,
  ): Promise<SuspendUserResult> {
    const target = await this.requireUser(userId);
    if (target.isSuspended) {
      throw new ConflictException({ code: "already_suspended", message: "Already suspended." });
    }

    const balance = await unwrapLedger(this.ledger.balance(userId));
    const pendingTotal = balance.pending.reduce((sum, bucket) => sum + bucket.points, 0);
    const totalPoints = balance.availablePoints + pendingTotal;

    // The ledger's escrow requires points > 0 (there is nothing to protect
    // in a zero balance) -- suspend the account outright without one.
    const escrowId =
      totalPoints > 0
        ? (
            await unwrapLedger(
              this.ledger.escrow({
                userId,
                points: toPoints(totalPoints),
                reason: body.reason,
                idempotencyKey: idempotencyKeyOf(request),
              }),
            )
          ).escrowId
        : null;

    const suspendedAt = await this.users.suspend(userId);
    if (suspendedAt === null) {
      throw new ConflictException({ code: "already_suspended", message: "Already suspended." });
    }

    const actor = await this.principals.resolve(request);
    await this.suspensions.record({
      userId,
      escrowId,
      points: totalPoints,
      reason: body.reason,
      suspendedBy: actor.id,
    });

    setStaffAuditContext(request, {
      targetKind: "user",
      targetId: userId,
      region: target.region,
      reason: body.reason,
      detail: { escrowedPoints: totalPoints },
    });

    return {
      userId,
      suspendedAt: suspendedAt.toISOString(),
      escrowId,
      escrowedPoints: toPoints(totalPoints),
    };
  }

  /** TASKS.md 9.4.b: reverses a suspension, releasing the escrow it created. */
  @StaffAction("user.release")
  @Idempotent({ retentionMs: 24 * 60 * 60_000 })
  @Authorize({ kind: "user_account", action: "reinstate" })
  @Post(":userId/release")
  async release(
    @Param("userId") userId: string,
    @Req() request: FastifyRequest,
  ): Promise<ReleaseUserResult> {
    const target = await this.requireUser(userId);
    const open = await this.suspensions.findOpenByUser(userId);
    if (open === null) {
      throw new ConflictException({ code: "not_suspended", message: "Not suspended." });
    }

    const releasedPoints =
      open.escrowId === null
        ? toPoints(0)
        : (await unwrapLedger(this.ledger.releaseEscrow(open.escrowId))).points;
    const released = await this.users.release(userId);
    if (!released) {
      throw new ConflictException({ code: "not_suspended", message: "Not suspended." });
    }

    const actor = await this.principals.resolve(request);
    await this.suspensions.markReleased(open.id, actor.id);

    setStaffAuditContext(request, {
      targetKind: "user",
      targetId: userId,
      region: target.region,
      detail: { releasedPoints },
    });

    return { userId, releasedPoints };
  }

  /**
   * TASKS.md 9.4.c: marketing-funded (K6), within F12's per-case limit --
   * `UserAccountAttributeLoader` reads that limit fresh from
   * `platform.region_setting` and Cerbos refuses before this handler ever
   * runs if the request exceeds it. Reason is mandatory (the DTO enforces it).
   */
  @StaffAction("user.goodwill_credit")
  @Idempotent({ retentionMs: 24 * 60 * 60_000 })
  @Authorize({ kind: "user_account", action: "goodwill_credit" })
  @Post(":userId/goodwill")
  async goodwill(
    @Param("userId") userId: string,
    @Body() body: GoodwillDto,
    @Req() request: FastifyRequest,
  ): Promise<GoodwillResult> {
    const target = await this.requireUser(userId);
    const granted = await unwrapLedger(
      this.ledger.grantAction({
        kind: "goodwill",
        userId,
        region: target.region,
        points: body.points,
        trustTier: target.trustTier,
        idempotencyKey: idempotencyKeyOf(request),
      }),
    );

    setStaffAuditContext(request, {
      targetKind: "user",
      targetId: userId,
      region: target.region,
      reason: body.reason,
      detail: { points: body.points },
    });

    return { grantId: granted.grantId, points: granted.points, unlockAt: granted.unlockAt };
  }

  /**
   * TASKS.md 9.4.d: F12's holdback tier, staff-set only, never shown to the
   * user. `risk_analyst` only -- see `user_account.yaml`'s `risk-sets-trust-tier` rule.
   */
  @StaffAction("user.set_trust_tier")
  @Idempotent({ retentionMs: 24 * 60 * 60_000 })
  @Authorize({ kind: "user_account", action: "set_trust_tier" })
  @Post(":userId/trust-tier")
  async setTrustTier(
    @Param("userId") userId: string,
    @Body() body: SetTrustTierDto,
    @Req() request: FastifyRequest,
  ): Promise<SetTrustTierResult> {
    const target = await this.requireUser(userId);
    const changed = await this.users.setTrustTier(userId, body.trustTier);
    if (!changed) throw new NotFoundException("No such user.");

    setStaffAuditContext(request, {
      targetKind: "user",
      targetId: userId,
      region: target.region,
      reason: body.reason,
      detail: { trustTier: body.trustTier },
    });

    return { userId, trustTier: body.trustTier };
  }

  private async requireUser(userId: string): Promise<StaffUserRow> {
    const target = await this.users.findById(userId);
    if (target === null) throw new NotFoundException("No such user.");
    return target;
  }
}

// Reads/writes refuse only when the ledger is down, disagrees, or the
// request breaks a real rule (idempotency conflict, insufficient funds) --
// none of those are the staff console's own fault.
async function unwrapLedger<T>(result: ResultAsync<T, LedgerError>): Promise<T> {
  const settled = await result;
  if (settled.isErr()) {
    const status: 409 | 502 =
      settled.error.code === "idempotency_conflict" ||
      settled.error.code === "insufficient_available"
        ? 409
        : 502;
    if (status === 409) {
      throw new ConflictException({ code: settled.error.code, message: settled.error.message });
    }
    throw new BadGatewayException({ code: settled.error.code, message: settled.error.message });
  }
  return settled.value;
}
