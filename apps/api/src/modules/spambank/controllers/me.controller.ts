import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import type { Principal } from "@yourtal/authz/principal";
import type { MailSession } from "@yourtal/contracts/spambank/common";
import {
  appPasswordIdSchema,
  createAppPasswordRequestSchema,
} from "@yourtal/contracts/spambank/management";
import type {
  AppPasswordCreated,
  AppPasswordList,
  EnableMailboxResult,
  MailboxStatus,
} from "@yourtal/contracts/spambank/management";
import { AsyncPrincipalResolver } from "../../../shared/authz/async-principal-resolver";
import { Authorize } from "../../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { RateLimit } from "../../../shared/rate-limit/rate-limit.decorator";
import { SpambankManagementService } from "../spambank-management.service";
import type { Caller } from "../use-cases/deps";
import { notFoundAppPassword, switchedOff } from "../use-cases/errors";
import type { StatusSubject } from "../use-cases/status";

class CreateAppPasswordDto extends createZodDto(createAppPasswordRequestSchema) {}

/** A person's own mailbox: not an app's, so `yourtal` is the app that asks. */
function callerOf(principal: Principal): Caller {
  return { person: { userId: principal.id, region: principal.attr.jurisdiction }, app: "yourtal" };
}

function subjectOf(principal: Principal): StatusSubject {
  return {
    userId: principal.id,
    adult: principal.attr.ageBand === "adult",
    onHold: principal.attr.isSuspended,
  };
}

/**
 * Spambank for the signed-in person (spambank/BUILD.md section 5.1): switch the mailbox on, get a mail
 * token, manage app passwords, delete the mailbox. Cerbos (`spambank`) allows adults in good standing;
 * `GET /api/spambank/me` is open to any signed-in identity so a screen can say "not available". With
 * `SPAMBANK_ENABLED` off, the status says so and every other route is a 404; the apps' own servers
 * keep working through `/api/oidc-clients/spambank`.
 */
@Controller("api/spambank/me")
export class SpambankMeController {
  constructor(
    private readonly principals: AsyncPrincipalResolver,
    private readonly service: SpambankManagementService,
  ) {}

  @Authorize({ kind: "spambank", action: "view" })
  @Get()
  async status(@Req() request: FastifyRequest): Promise<MailboxStatus> {
    if (!this.service.enabled) return { available: false };
    return this.service.status(subjectOf(await this.principals.resolve(request)));
  }

  @RateLimit({ routeId: "spambank.me.enable", identity: { max: 20, windowSeconds: 60 } })
  @NotValueMoving("A repeat finds the mailbox the first call made and returns it, with a 200.")
  @Authorize({ kind: "spambank", action: "enable" })
  @Post("enable")
  async enable(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EnableMailboxResult> {
    if (!this.service.enabled) throw switchedOff();
    const result = await this.service.enable(callerOf(await this.principals.resolve(request)));
    reply.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  @RateLimit({ routeId: "spambank.me.session", identity: { max: 120, windowSeconds: 60 } })
  @NotValueMoving("Mints a short-lived token; a repeat mints another that opens the same mailbox.")
  @Authorize({ kind: "spambank", action: "open" })
  @Post("session")
  @HttpCode(HttpStatus.OK)
  async session(@Req() request: FastifyRequest): Promise<MailSession> {
    if (!this.service.enabled) throw switchedOff();
    return this.service.session(callerOf(await this.principals.resolve(request)));
  }

  @Authorize({ kind: "spambank", action: "manage_app_passwords" })
  @Get("app-passwords")
  async listAppPasswords(@Req() request: FastifyRequest): Promise<AppPasswordList> {
    if (!this.service.enabled) throw switchedOff();
    return this.service.listAppPasswords((await this.principals.resolve(request)).id);
  }

  @RateLimit({
    routeId: "spambank.me.app_password.create",
    identity: { max: 10, windowSeconds: 60 * 60 },
  })
  @NotValueMoving("Makes a mail credential, never money; at most five exist and each is revocable.")
  @Authorize({ kind: "spambank", action: "manage_app_passwords" })
  @Post("app-passwords")
  async createAppPassword(
    @Body() body: CreateAppPasswordDto,
    @Req() request: FastifyRequest,
  ): Promise<AppPasswordCreated> {
    if (!this.service.enabled) throw switchedOff();
    return this.service.createAppPassword((await this.principals.resolve(request)).id, body.name);
  }

  @NotValueMoving("Revoking twice ends in the same state: the second finds nothing to revoke.")
  @Authorize({ kind: "spambank", action: "manage_app_passwords" })
  @Delete("app-passwords/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeAppPassword(
    @Param("id") rawId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    if (!this.service.enabled) throw switchedOff();
    const id = appPasswordIdSchema.safeParse(rawId);
    if (!id.success) throw notFoundAppPassword();
    await this.service.revokeAppPassword((await this.principals.resolve(request)).id, id.data);
  }

  @NotValueMoving(
    "Deleting twice ends in the same state: the second finds the mailbox already going.",
  )
  @Authorize({ kind: "spambank", action: "delete" })
  @Delete()
  @HttpCode(HttpStatus.ACCEPTED)
  async deleteMailbox(@Req() request: FastifyRequest): Promise<void> {
    if (!this.service.enabled) throw switchedOff();
    await this.service.deleteMailbox((await this.principals.resolve(request)).id);
  }
}
