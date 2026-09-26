import { Controller, Get, Inject, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
import { StreakService } from "./streak.service";

/**
 * `GET /api/me/streak` (5.5.a) — the caller's current streak. Syncing on
 * read (see `StreakService`'s own doc comment) means this single request
 * both answers the question and, if a new completed day crosses day 3 or
 * day 7, pays the bonus and returns the grant it issued.
 */
@Controller("api/me/streak")
export class StreakController {
  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    private readonly streaks: StreakService,
  ) {}

  @Authorize({ kind: "me", action: "view_streak" })
  @NotValueMoving(
    "Reads the streak. Any grant it triggers is idempotent on grantAction's own key " +
      "(streak:<user>:day<n>:<date>), so a retried GET cannot pay the bonus twice.",
  )
  @Get()
  async get(@Req() request: FastifyRequest) {
    const userId = (await this.principals.resolve(request)).id;
    const { state, grantsIssued } = await this.streaks.sync(userId);
    return {
      currentLength: state.currentLength,
      lastCountedDate: state.lastCountedDate,
      grantsIssued,
    };
  }
}
