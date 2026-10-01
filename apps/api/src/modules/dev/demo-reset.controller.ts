import { Controller, HttpCode, Inject, NotFoundException, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { PgBoss } from "pg-boss";
import { defineQueue } from "@yourtal/queue/define-queue";
import { APP_CONFIG } from "../../config/app-config.module";
import type { AppConfig } from "../../config/app-config";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { DEV_CLOCK_QUEUE_CLIENT } from "./dev-clock.service";

/** The worker's queue (apps/worker/src/jobs/demo-reset.ts). */
const DEMO_RESET_QUEUE = "demo-reset";

/**
 * `POST /api/dev/demo/reset` (13.1.a): the staff console's reset button. It
 * only enqueues the worker's `demo-reset` job, which rebuilds the demo world
 * and its logins; admin only, and never in production (red line 11).
 */
@Controller("api/dev/demo")
export class DemoResetController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    @Inject(DEV_CLOCK_QUEUE_CLIENT) private readonly boss: PgBoss,
  ) {}

  @NotValueMoving(
    "Enqueues a reset; the reset itself moves points only by escrowing retired demo balances, " +
      "under keys that name the amount, so a second press re-runs it without a second hold.",
  )
  @Authorize({
    kind: "platform_setting",
    action: "reset_demo_world",
    idFrom: () => "demo.reset",
    attrsFrom: () => ({ key: "demo.reset" }),
  })
  @HttpCode(202)
  @Post("reset")
  async reset(@Req() request: FastifyRequest): Promise<{ queued: true; jobId: string }> {
    if (this.config.appEnv === "production") throw new NotFoundException();
    const principal = await this.principals.resolve(request);
    await defineQueue(this.boss, DEMO_RESET_QUEUE, { retryLimit: 0 });
    const jobId = await this.boss.send(DEMO_RESET_QUEUE, { requestedBy: principal.id });
    if (jobId === null) throw new Error("pg-boss refused the demo-reset job");
    return { queued: true, jobId };
  }
}
