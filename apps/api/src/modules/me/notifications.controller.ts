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
import { PrincipalService } from "../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
import { NOTIFICATION_REPOSITORY } from "./persistence/notification.repository";
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
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
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
    const userId = (await this.principals.resolve(request)).id;
    const preferences = await this.notifications.preferencesFor(userId);
    return { preferences: Object.fromEntries(preferences) };
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
