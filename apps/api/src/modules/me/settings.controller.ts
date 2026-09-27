import { Body, Controller, Get, Inject, Put, Req } from "@nestjs/common";
import { BadRequestException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { autoplaySettingSchema } from "@yourtal/contracts/me/autoplay-setting";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import type { PrincipalResolver } from "../../shared/authz/principal-resolver";
import { USER_PROFILE_REPOSITORY } from "../identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import {
  AUTOPLAY_SETTING_READER,
  VIEWER_SETTING_REPOSITORY,
} from "./persistence/viewer-setting.repository";
import type {
  AutoplaySettingReader,
  ViewerSettingRepository,
} from "./persistence/viewer-setting.repository";
import { requireRegion } from "./require-region";

/**
 * `GET`/`PUT /api/me/settings/autoplay` (6.7.a). The reader resolves the
 * region default when the viewer has never set one; the write always
 * writes a concrete value, never "use the default" itself, so a later
 * region-default change never silently moves someone who chose otherwise.
 */
@Controller("api/me/settings")
export class SettingsController {
  constructor(
    @Inject(PrincipalService) private readonly principals: PrincipalResolver,
    @Inject(VIEWER_SETTING_REPOSITORY) private readonly settings: ViewerSettingRepository,
    @Inject(AUTOPLAY_SETTING_READER) private readonly autoplay: AutoplaySettingReader,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
  ) {}

  @Authorize({ kind: "me", action: "view_settings" })
  @NotValueMoving("A read of the caller's own resolved autoplay setting.")
  @Get("autoplay")
  async getAutoplay(@Req() request: FastifyRequest) {
    const principal = await this.principals.resolve(request);
    const region = await requireRegion(this.profiles, principal.id);
    return { autoplay: await this.autoplay.resolveFor(principal.id, region) };
  }

  @NotValueMoving("Setting the same autoplay value twice ends in the same stored state.")
  @Authorize({ kind: "me", action: "update_settings" })
  @Put("autoplay")
  async setAutoplay(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = autoplaySettingSchema.safeParse(
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)["autoplay"]
        : undefined,
    );
    if (!parsed.success) {
      throw new BadRequestException('autoplay must be one of "always", "wifi_only", "never".');
    }
    const userId = (await this.principals.resolve(request)).id;
    await this.settings.setAutoplay(userId, parsed.data);
    return { autoplay: parsed.data };
  }
}
