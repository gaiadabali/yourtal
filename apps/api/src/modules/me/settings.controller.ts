import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Put,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { autoplaySettingSchema } from "@yourtal/contracts/me/autoplay-setting";
import { themeSettingSchema } from "@yourtal/contracts/me/theme-setting";
import { isKnownPostcode } from "@yourtal/contracts/areas/data";
import { setViewerAreaBodySchema } from "@yourtal/contracts/areas/schema";
import type { ViewerAreaResponse } from "@yourtal/contracts/areas/schema";
import type { Principal } from "@yourtal/authz/principal";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import { AsyncPrincipalResolver } from "../../shared/authz/async-principal-resolver";
import { summariseArea } from "../areas/areas.controller";
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
    private readonly asyncPrincipals: AsyncPrincipalResolver,
  ) {}

  /**
   * F116: "my area" is for adults. A teen never sees it in Me and every
   * route refuses them here, whatever the client sends; anything that is not
   * positively an adult is refused too, so a missing age band fails closed.
   */
  private async adultPrincipal(request: FastifyRequest): Promise<Principal> {
    const principal = await this.asyncPrincipals.resolve(request);
    if (principal.attr.ageBand !== "adult") {
      throw new ForbiddenException({
        code: "area_not_available",
        message: "My area is not available for this account.",
      });
    }
    return principal;
  }

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

  @Authorize({ kind: "me", action: "view_settings" })
  @NotValueMoving("A read of the caller's own theme.")
  @Get("theme")
  async getTheme(@Req() request: FastifyRequest) {
    const principal = await this.principals.resolve(request);
    return { theme: await this.settings.themeFor(principal.id) };
  }

  @NotValueMoving("Setting the same theme twice ends in the same stored state.")
  @Authorize({ kind: "me", action: "update_settings" })
  @Put("theme")
  async setTheme(@Req() request: FastifyRequest, @Body() body: unknown) {
    const parsed = themeSettingSchema.safeParse(
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)["theme"]
        : undefined,
    );
    if (!parsed.success) {
      throw new BadRequestException('theme must be one of "system", "light", "dark".');
    }
    const userId = (await this.principals.resolve(request)).id;
    await this.settings.setTheme(userId, parsed.data);
    return { theme: parsed.data };
  }

  @Authorize({ kind: "me", action: "view_settings" })
  @NotValueMoving("A read of the caller's own declared area.")
  @Get("area")
  async getArea(@Req() request: FastifyRequest): Promise<ViewerAreaResponse> {
    const principal = await this.adultPrincipal(request);
    const postcode = await this.settings.areaFor(principal.id);
    // A postcode that has since left the list reads as no area, never an error.
    return {
      area:
        postcode !== null && isKnownPostcode(principal.attr.jurisdiction, postcode)
          ? summariseArea(principal.attr.jurisdiction, postcode)
          : null,
    };
  }

  /** The viewer picks a suburb; the app sends its postcode, which must be on their own region's list. */
  @NotValueMoving("Setting the same area twice ends in the same stored state.")
  @Authorize({ kind: "me", action: "update_settings" })
  @Put("area")
  async setArea(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<ViewerAreaResponse> {
    const principal = await this.adultPrincipal(request);
    const parsed = setViewerAreaBodySchema.safeParse(body);
    const region = principal.attr.jurisdiction;
    if (!parsed.success || !isKnownPostcode(region, parsed.data.postcode)) {
      throw new BadRequestException({
        code: "unknown_area",
        message: "Pick an area from the list.",
      });
    }
    await this.settings.setArea(principal.id, region, parsed.data.postcode);
    return { area: summariseArea(region, parsed.data.postcode) };
  }

  @NotValueMoving("Clearing an area that is already clear changes nothing.")
  @Authorize({ kind: "me", action: "update_settings" })
  @Delete("area")
  async clearArea(@Req() request: FastifyRequest): Promise<ViewerAreaResponse> {
    const principal = await this.adultPrincipal(request);
    await this.settings.clearArea(principal.id);
    return { area: null };
  }
}
