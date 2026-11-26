import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import type { MailSession } from "@yourtal/contracts/spambank/common";
import {
  machineCreateAppPasswordRequestSchema,
  machineRevokeAppPasswordRequestSchema,
  machineSettingsRequestSchema,
  machineSubRequestSchema,
} from "@yourtal/contracts/spambank/management";
import type {
  AppPasswordCreated,
  AppPasswordList,
  EnableMailboxResult,
  MachineMailboxStatus,
} from "@yourtal/contracts/spambank/management";
import { PublicRoute } from "../../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { RateLimit } from "../../../shared/rate-limit/rate-limit.decorator";
import { OidcClientRateLimitGuard } from "../../oidc/client-rate-limit.guard";
import { OIDC_RUNTIME, OidcRuntime } from "../../oidc/oidc-runtime";
import { SpambankClientGuard, verifiedClient } from "../../oidc/teen-invite-client.guard";
import { SpambankClientPersonResolver } from "../client-person";
import type { ClientPerson } from "../client-person";
import { SpambankManagementService } from "../spambank-management.service";
import { notAllowed } from "../use-cases/errors";

class SubDto extends createZodDto(machineSubRequestSchema) {}
class SettingsDto extends createZodDto(machineSettingsRequestSchema) {}
class CreateAppPasswordDto extends createZodDto(machineCreateAppPasswordRequestSchema) {}
class RevokeAppPasswordDto extends createZodDto(machineRevokeAppPasswordRequestSchema) {}

const PUBLIC_REASON =
  "client-credentials token with scope spambank, verified by SpambankClientGuard; " +
  "a machine client, never a session or Cerbos principal";

/**
 * Per app, counted on its verified client id. The per-IP window is only a floor for junk before the
 * guard knows the client, and every app's server may call from one address, so it sits well above the
 * sum. Not measured from production traffic.
 */
const LIMITS = {
  identity: { max: 120, windowSeconds: 60 },
  ip: { max: 1200, windowSeconds: 60 },
} as const;

/**
 * Spambank for the apps' servers (spambank/BUILD.md section 5.2): the same management as the session
 * routes, for a person named by the calling app's own pairwise `sub`. The person must be an adult
 * with a live consent for that app, resolved in the client's sector by `SpambankClientPersonResolver`.
 * Not Cerbos: the token and the consent are the authority, and the use-cases repeat the adult check.
 */
@Controller("api/oidc-clients/spambank")
@UseGuards(SpambankClientGuard, OidcClientRateLimitGuard)
export class SpambankClientsController {
  constructor(
    @Inject(OIDC_RUNTIME) private readonly runtime: OidcRuntime,
    private readonly people: SpambankClientPersonResolver,
    private readonly service: SpambankManagementService,
  ) {}

  private personOf(request: FastifyRequest, sub: string): Promise<ClientPerson> {
    return this.people.resolve(verifiedClient(request, this.runtime), sub);
  }

  @RateLimit({ routeId: "oidc.spambank.status", ...LIMITS })
  @NotValueMoving("A read of the person's own mailbox state.")
  @PublicRoute(PUBLIC_REASON)
  @Post("status")
  @HttpCode(HttpStatus.OK)
  async status(
    @Body() body: SubDto,
    @Req() request: FastifyRequest,
  ): Promise<MachineMailboxStatus> {
    return this.service.machineStatus((await this.personOf(request, body.sub)).subject);
  }

  @RateLimit({ routeId: "oidc.spambank.enable", ...LIMITS })
  @NotValueMoving("A repeat finds the mailbox the first call made and returns it, with a 200.")
  @PublicRoute(PUBLIC_REASON)
  @Post("enable")
  async enable(
    @Body() body: SubDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<EnableMailboxResult> {
    const { caller } = await this.personOf(request, body.sub);
    const result = await this.service.enable(caller);
    reply.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  @RateLimit({ routeId: "oidc.spambank.session", ...LIMITS })
  @NotValueMoving("Mints a short-lived token; a repeat mints another that opens the same mailbox.")
  @PublicRoute(PUBLIC_REASON)
  @Post("session")
  @HttpCode(HttpStatus.OK)
  async session(@Body() body: SubDto, @Req() request: FastifyRequest): Promise<MailSession> {
    return this.service.session((await this.personOf(request, body.sub)).caller);
  }

  @RateLimit({ routeId: "oidc.spambank.settings", ...LIMITS })
  @NotValueMoving("Sets two switches to the values given; a repeat sets the same values.")
  @PublicRoute(PUBLIC_REASON)
  @Post("settings")
  @HttpCode(HttpStatus.OK)
  async settings(
    @Body() body: SettingsDto,
    @Req() request: FastifyRequest,
  ): Promise<MachineMailboxStatus> {
    // The statement import and the alerts are SnapApp's; FTR has no use for either.
    if (verifiedClient(request, this.runtime).app !== "snapapp") {
      throw notAllowed("this route is SnapApp's only");
    }
    const person = await this.personOf(request, body.sub);
    await this.service.updateSettings(person.caller.person.userId, {
      statementsToSnapApp: body.statementsToSnapApp,
      newMailAlerts: body.newMailAlerts,
    });
    return this.service.machineStatus(person.subject);
  }

  @RateLimit({ routeId: "oidc.spambank.app_passwords.list", ...LIMITS })
  @NotValueMoving("A read of the person's own app passwords, without their secrets.")
  @PublicRoute(PUBLIC_REASON)
  @Post("app-passwords/list")
  @HttpCode(HttpStatus.OK)
  async listAppPasswords(
    @Body() body: SubDto,
    @Req() request: FastifyRequest,
  ): Promise<AppPasswordList> {
    return this.service.listAppPasswords(
      (await this.personOf(request, body.sub)).caller.person.userId,
    );
  }

  @RateLimit({ routeId: "oidc.spambank.app_passwords.create", ...LIMITS })
  @NotValueMoving("Makes a mail credential, never money; at most five exist and each is revocable.")
  @PublicRoute(PUBLIC_REASON)
  @Post("app-passwords")
  async createAppPassword(
    @Body() body: CreateAppPasswordDto,
    @Req() request: FastifyRequest,
  ): Promise<AppPasswordCreated> {
    return this.service.createAppPassword(
      (await this.personOf(request, body.sub)).caller.person.userId,
      body.name,
    );
  }

  @RateLimit({ routeId: "oidc.spambank.app_passwords.revoke", ...LIMITS })
  @NotValueMoving("Revoking twice ends in the same state: the second finds nothing to revoke.")
  @PublicRoute(PUBLIC_REASON)
  @Post("app-passwords/revoke")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeAppPassword(
    @Body() body: RevokeAppPasswordDto,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.service.revokeAppPassword(
      (await this.personOf(request, body.sub)).caller.person.userId,
      body.id,
    );
  }
}
