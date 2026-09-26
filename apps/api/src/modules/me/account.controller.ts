import { Controller, Delete, Get, Inject, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { DeletionReport } from "@yourtal/consent/dsar-orchestrator";
import { executeDeletion } from "@yourtal/consent/dsar-orchestrator";
import { deletionPlan } from "@yourtal/consent/dsar";
// `@yourtal/db` had no "exports" map (nothing outside it imported from it
// before this ticket) — added one entry, `./dsar-handlers`, so this crosses
// the package boundary the same way every other cross-package import in
// this repo does, rather than a deep `src/` import (13b §5).
import { postgresHandlers } from "@yourtal/db/dsar-handlers";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
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
import { STREAK_STATE_REPOSITORY } from "./persistence/streak-state.repository";
import type { StreakStateRepository } from "./persistence/streak-state.repository";

/**
 * `DELETE /api/me` and `GET /api/me/data-export` (5.4.b). Deletion runs
 * `@yourtal/consent`'s `executeDeletion` against `postgresHandlers`
 * (`@yourtal/db`, A's file) — the `identity` handler there already erases
 * business membership, `user_profile`, `credential` and `session` in one
 * pass (1.4.f, done for exactly this ticket), which is what ends every
 * session and removes the profile. Domains with no handler yet (`watch_
 * sessions`, `ledger`, ...) come back `unhandled` in the report rather than
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
  ) {}

  // A repeated delete-account call must not run the deletion a second time.
  @Idempotent({ retentionMs: 24 * 60 * 60 * 1000 })
  @Authorize({ kind: "me", action: "delete_account" })
  @Delete()
  async deleteAccount(@Req() request: FastifyRequest): Promise<DeletionReport> {
    const userId = (await this.principals.resolve(request)).id;
    return executeDeletion(userId, postgresHandlers(this.pool));
  }

  @Authorize({ kind: "me", action: "export_data" })
  @NotValueMoving("A read-only export of the caller's own data.")
  @Get("data-export")
  async exportData(@Req() request: FastifyRequest) {
    const userId = (await this.principals.resolve(request)).id;
    const [consents, interests, followed, saved, streak] = await Promise.all([
      this.consents.listForUser(userId),
      this.interests.listForUser(userId),
      this.follows.listForUser(userId),
      this.saves.listForUser(userId),
      this.streaks.find(userId),
    ]);

    return {
      generatedAt: new Date().toISOString(),
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
