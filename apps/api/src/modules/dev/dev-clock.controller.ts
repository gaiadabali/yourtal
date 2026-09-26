import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { AdvanceDaysDto, RunJobDto } from "./dev-clock.schema";
import type {
  AdvanceDaysResponse,
  DevClockJobsResponse,
  ReleasePendingResponse,
  RunJobResponse,
} from "./dev-clock.schema";
import { DevClockService } from "./dev-clock.service";

/**
 * `/api/dev/clock` — 2.3.d. A reviewer's own actions on their own signed-in
 * account only: there is no `:userId` anywhere in this controller, so every
 * route is declared against the `session` resource kind, same as
 * `MeController`'s `view_profile`/`update_profile` (see that file's own
 * comment) and the same three `dev_clock_*` actions
 * `policies/resource_policies/session.yaml` grants to any real signed-in
 * identity and refuses to `anonymous`.
 *
 * `APP_ENV` is the other half of the gate, checked in every method exactly
 * like `DevInboxController`: a 404 in production, not a 403, so a production
 * deployment does not even reveal the route exists.
 */
@Controller("api/dev/clock")
export class DevClockController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    private readonly clock: DevClockService,
  ) {}

  private refuseInProduction(): void {
    if (this.config.appEnv === "production") throw new NotFoundException();
  }

  /**
   * Re-checks what `AdvanceDaysDto`'s zod schema already declares
   * (`min(1).max(3650)`). Belt-and-suspenders rather than redundant: nestjs-
   * zod's global pipe resolves which schema to run from the parameter's
   * reflected TypeScript type (`design:paramtypes`), which needs real
   * `tsc`-emitted decorator metadata — present in the built app (`dev`/
   * `start` run through `@swc-node/register`, which does emit it) but NOT
   * guaranteed under every test transform. A guard that only works when a
   * particular build pipeline is used is not a guard.
   */
  private assertValidDays(days: number): void {
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new BadRequestException(
        `days must be an integer between 1 and 3650, got ${String(days)}`,
      );
    }
  }

  /** Same reasoning as `assertValidDays` above, for `RunJobDto`'s `z.literal`. */
  private assertKnownJob(job: string): asserts job is "points-unlocked" {
    if (job !== "points-unlocked") {
      throw new BadRequestException(`"${job}" is not a job this endpoint can run yet`);
    }
  }

  // A read, reusing `view_profile` rather than a fourth action: the question
  // is the same one — "is a real signed-in identity looking at its own
  // account" — and TASKS.md's ownership table asks for as few new policy
  // surfaces as the job actually needs.
  @Authorize({ kind: "session", action: "view_profile" })
  @Get("jobs")
  listJobs(): DevClockJobsResponse {
    this.refuseInProduction();
    return { jobs: [...this.clock.listJobs()] };
  }

  @NotValueMoving(
    "The UPDATE only ever moves unlock_at TO now() for rows still in the future, so a retry " +
      "after a first success finds nothing left to touch and is a no-op — naturally idempotent, " +
      "not just assumed so.",
  )
  @Authorize({ kind: "session", action: "dev_clock_release_pending" })
  @HttpCode(200)
  @Post("release-pending")
  async releasePending(@Req() request: FastifyRequest): Promise<ReleasePendingResponse> {
    this.refuseInProduction();
    const userId = (await this.principals.resolve(request)).id;
    return this.clock.releasePending(userId);
  }

  @NotValueMoving(
    "A dev/staging reviewer tool (APP_ENV gates it out of production entirely), not a " +
      "production balance-moving endpoint. A double click shifts the caller's own pending " +
      "unlock times twice, which is the reviewer's own repeated action on their own simulated " +
      "data, not an automated client retry this needs to protect against.",
  )
  @Authorize({ kind: "session", action: "dev_clock_advance_days" })
  @HttpCode(200)
  @Post("advance-days")
  async advanceDays(
    @Req() request: FastifyRequest,
    @Body() body: AdvanceDaysDto,
  ): Promise<AdvanceDaysResponse> {
    this.refuseInProduction();
    this.assertValidDays(body.days);
    const userId = (await this.principals.resolve(request)).id;
    return this.clock.advanceDays(userId, body.days);
  }

  @NotValueMoving(
    "Enqueuing a job is not itself value-moving, and the handler it triggers " +
      "(announceUnlockedPoints) is already idempotent per grant — pg-boss's own primary key on " +
      "unlockJobId dedupes the announcement, and releasesNotified guards re-notification — so " +
      "running the same tick twice is harmless, the same as the cron schedule doing it anyway.",
  )
  @Authorize({ kind: "session", action: "dev_clock_run_job" })
  @HttpCode(200)
  @Post("run-job")
  async runJob(@Req() request: FastifyRequest, @Body() body: RunJobDto): Promise<RunJobResponse> {
    this.refuseInProduction();
    this.assertKnownJob(body.job);
    const userId = (await this.principals.resolve(request)).id;
    return this.clock.runJob(userId, body.job);
  }
}
