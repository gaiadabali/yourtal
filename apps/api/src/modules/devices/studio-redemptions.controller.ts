import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { studioRedemptionQuerySchema } from "@yourtal/contracts/device/studio-redemptions";
import { createZodDto } from "nestjs-zod";
import { Authorize } from "../../shared/authz/authorize.decorator";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { DEVICES_DB } from "./devices.tokens";
import { listStudioRedemptions } from "./studio-redemptions-read-model";

class StudioRedemptionQueryDto extends createZodDto(studioRedemptionQuerySchema) {}

/** TASKS.md 8.2.g: Studio -> Redemptions — today's and recent captures per location and device. */
@Controller("api/:tenantId/studio/redemptions")
export class StudioRedemptionsController {
  constructor(@Inject(DEVICES_DB) private readonly db: AppDb) {}

  @Authorize({ kind: "team", action: "view" })
  @Get()
  async list(@Param("tenantId") tenantId: string, @Query() query: StudioRedemptionQueryDto) {
    const entries = await listStudioRedemptions(this.db, {
      businessId: tenantId,
      ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
      ...(query.deviceId === undefined ? {} : { deviceId: query.deviceId }),
      limit: query.limit,
    });
    return { entries };
  }
}
