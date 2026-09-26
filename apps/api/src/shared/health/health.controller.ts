import { Controller, Get, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { PublicRoute } from "../authz/authorize.decorator";
import { HealthService } from "./health.service";
import type { HealthResponse } from "./health-check.schema";

/**
 * `GET /api/health` — the readiness/liveness probe. There was none anywhere
 * in the tree before this; the only proof the API worked was manually
 * exporting env vars and watching it map routes in a terminal.
 *
 * ## Why `@PublicRoute`, not `@Authorize`
 *
 * `PdpGuard` is a global `APP_GUARD` (`app.module.ts`), so an undeclared
 * route is denied by default (`docs/14` §4, `authorized-routes.test.ts`).
 * This route is deliberately exempted rather than gated: one of the two
 * things it checks IS the PDP, so requiring a PDP round trip to reach it
 * would make a Cerbos outage also take down the one endpoint meant to
 * report that outage — the probe becomes unable to describe the very
 * failure it exists to describe. It carries no secrets and mutates nothing,
 * so there is nothing for authorization to protect here.
 */
@Controller("api/health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @PublicRoute(
    "A readiness probe must be reachable without a bearer token or a PDP round trip — " +
      "the PDP is one of the two dependencies this route checks, so gating the check on " +
      "the thing it checks would hide a Cerbos outage instead of reporting it.",
  )
  @Get()
  async check(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthResponse> {
    const result = await this.health.check();
    // 503 on any failed dependency, matching the readiness contract an
    // orchestrator/load balancer expects — "ok" is reserved for "every
    // dependency this process needs answered", not merely "the process is
    // running".
    reply.status(result.status === "ok" ? 200 : 503);
    // `staging-drift.yml` (2.2.c) curls this to read `revision`; a cached
    // 200 from an intermediary would make drift look fixed when it is not.
    reply.header("Cache-Control", "no-store");
    return result;
  }
}
