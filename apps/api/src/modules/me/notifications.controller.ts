import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import {
  DEFAULT_NOTIFICATION_CATEGORIES,
  NOTIFICATION_REPOSITORY,
  pushEnabledDefaultFor,
} from "./persistence/notification.repository";
import type { NotificationRepository } from "./persistence/notification.repository";

const DEFAULT_LIMIT = 30;
const preferenceBody = z.object({ pushEnabled: z.boolean() });

/**
 * `GET /api/me/notifications` (5.5.b) — fed by the worker's
 * `ledger.points_unlocked` consumer (real today) and, once their sources
 * exist, `ledger.points_expiring` (10.2, not started) and new campaigns
 * from followed channels (needs 7.3's publish event — requested there).
 * Also the caller's own per-category push preferences.
 */
@Controller("api/me/notifications")
export class NotificationsController {
  constructor(
    // `AsyncPrincipalResolver`, not `PrincipalService`: `ageBand` (12.4.b
    // #8, below) is only populated by the async, profile-reading resolver
    // -- see that class's own doc comment.
    private readonly principals: AsyncPrincipalResolver,
    @Inject(NOTIFICATION_REPOSITORY) private readonly notifications: NotificationRepository,
  ) {}

  @Authorize({ kind: "me", action: "view_notifications" })
  @NotValueMoving("A read of the caller's own notifications.")
  @Get()
  async list(@Req() request: FastifyRequest, @Query("limit") limitParam?: string) {
    const userId = (await this.principals.resolve(request)).id;
    const parsed = Number.parseInt(limitParam ?? "", 10);
    const limit = Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : DEFAULT_LIMIT;
    return { notifications: await this.notifications.listForUser(userId, limit) };
  }

  @NotValueMoving("Marking read twice ends in the same read state as marking it once.")
  @Authorize({ kind: "me", action: "update_notifications" })
  @Patch(":id/read")
  async markRead(@Req() request: FastifyRequest, @Param("id") id: string) {
    const parsedId = Number.parseInt(id, 10);
    if (!Number.isFinite(parsedId)) throw new BadRequestException("id must be a number.");
    const userId = (await this.principals.resolve(request)).id;
    await this.notifications.markRead(userId, parsedId, new Date());
    return { read: true };
  }

  @Authorize({ kind: "me", action: "view_notifications" })
  @NotValueMoving("A read of the caller's own notification preferences.")
  @Get("preferences")
  async preferences(@Req() request: FastifyRequest) {
    const principal = await this.principals.resolve(request);
    const stored = await this.notifications.preferencesFor(principal.id);

    // 12.4.b (#8): push defaults OFF for a teen -- but only for a category
    // this account has never made an explicit choice on, and only for a
    // teen: an adult's response is UNCHANGED by this ticket (a category
    // with no row stays absent, same as before), because the column's own
    // DEFAULT true already matches what an adult should see and there is
    // nothing here to correct for that case. A stored row (`stored`, spread
    // last) always wins regardless of age band.
    const merged = new Map<string, boolean>(stored);
    if (principal.attr.ageBand === "teen") {
      for (const category of DEFAULT_NOTIFICATION_CATEGORIES) {
        if (!merged.has(category)) merged.set(category, pushEnabledDefaultFor("teen"));
      }
    }

    return { preferences: Object.fromEntries(merged) };
  }

  @NotValueMoving("Setting the same preference twice ends in the same stored state.")
  @Authorize({ kind: "me", action: "update_notifications" })
  @Put("preferences/:category")
  async setPreference(
    @Req() request: FastifyRequest,
    @Param("category") category: string,
    @Body() body: unknown,
  ) {
    const parsed = preferenceBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException("pushEnabled must be a boolean.");
    const userId = (await this.principals.resolve(request)).id;
    await this.notifications.setPreference(userId, category, parsed.data.pushEnabled);
    return { category, pushEnabled: parsed.data.pushEnabled };
  }
}
