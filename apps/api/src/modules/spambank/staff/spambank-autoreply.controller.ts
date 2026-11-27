import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import {
  spambankAutoreplyChangeSchema,
  type SpambankAutoreply,
} from "@yourtal/contracts/spambank/staff";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { AsyncPrincipalResolver } from "../../../shared/authz/async-principal-resolver";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import type { SpambankConfig } from "../../../config/spambank-config";
import { StaffAction, setStaffAuditContext } from "../../staff/staff-action.decorator";
import { SpambankDb } from "../spambank-db";
import { SPAMBANK_CONFIG } from "../spambank.tokens";
import { changeAutoreply, readAutoreply } from "./autoreply.store";

class AutoreplyChangeDto extends createZodDto(spambankAutoreplyChangeSchema) {}

/** The `platform_setting` key this panel is: it is what the policy's region_setting.* exclusion reads. */
const SETTING_KEY = "spambank.autoreply";
const settingAttrs = () => ({ key: SETTING_KEY });

/**
 * BUILD.md 4.6 / 5.4: the counter-spam auto-reply's panel. Global, not regional: one sending reputation.
 * `admin` and `ops` read it and trip the kill switch (platform_setting.yaml, untouched).
 */
@Controller("api/staff/spambank/autoreply")
export class SpambankAutoreplyController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    @Inject(SpambankDb) private readonly db: SpambankDb,
    @Inject(SPAMBANK_CONFIG) private readonly config: SpambankConfig,
  ) {}

  @StaffAction("spambank.autoreply.view")
  @Authorize({
    kind: "platform_setting",
    action: "view",
    idFrom: () => SETTING_KEY,
    attrsFrom: settingAttrs,
  })
  @NotValueMoving("A read.")
  @Get()
  async view(@Req() request: FastifyRequest): Promise<SpambankAutoreply> {
    setStaffAuditContext(request, { targetKind: "platform_setting", targetId: SETTING_KEY });
    return readAutoreply(this.db.pool, this.config.autoreply.mode);
  }

  @StaffAction("spambank.autoreply.change")
  @Authorize({
    kind: "platform_setting",
    action: "trip_kill_switch",
    idFrom: () => SETTING_KEY,
    attrsFrom: settingAttrs,
  })
  @NotValueMoving(
    "Sets the switch, the cap or the pause to the values sent; a repeat changes nothing more.",
  )
  @HttpCode(HttpStatus.OK)
  @Post()
  async change(
    @Body() body: AutoreplyChangeDto,
    @Req() request: FastifyRequest,
  ): Promise<SpambankAutoreply> {
    const actor = await this.principals.resolve(request);
    setStaffAuditContext(request, {
      targetKind: "platform_setting",
      targetId: SETTING_KEY,
      reason: body.reason,
      detail: {
        ...(body.tripped === undefined ? {} : { tripped: body.tripped }),
        ...(body.dailyCap === undefined ? {} : { dailyCap: body.dailyCap }),
        ...(body.resume === true ? { resume: true } : {}),
      },
    });
    await changeAutoreply(this.db.pool, body, actor.id);
    return readAutoreply(this.db.pool, this.config.autoreply.mode);
  }
}
