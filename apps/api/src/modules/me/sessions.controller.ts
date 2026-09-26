import { Controller, Get, Inject, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
import { CONTINUE_WATCHING_READER } from "./persistence/continue-watching.reader";
import type { ContinueWatchingReader } from "./persistence/continue-watching.reader";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * `GET /api/me/sessions` (5.4.a) — "continue watching": the caller's own
 * parked (`superseded`) and `active` watch sessions, newest progress first,
 * with coverage. Reads `watch.session`/`watch.coverage` through
 * `ContinueWatchingReader`, a narrow read-only query in this module — the
 * repository that WRITES those tables is A's this phase (5.1-5.3).
 */
@Controller("api/me/sessions")
export class SessionsController {
  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    @Inject(CONTINUE_WATCHING_READER) private readonly reader: ContinueWatchingReader,
  ) {}

  @Authorize({ kind: "me", action: "view_sessions" })
  @NotValueMoving("A read of the caller's own watch sessions.")
  @Get()
  async list(@Req() request: FastifyRequest, @Query("limit") limitParam?: string) {
    const userId = (await this.principals.resolve(request)).id;
    const parsed = Number.parseInt(limitParam ?? "", 10);
    const limit = Number.isFinite(parsed)
      ? Math.max(1, Math.min(MAX_LIMIT, parsed))
      : DEFAULT_LIMIT;
    return { sessions: await this.reader.forUser(userId, limit) };
  }
}
