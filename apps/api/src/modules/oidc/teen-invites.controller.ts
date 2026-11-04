import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { teenInviteParentRequestSchema } from "@yourtal/contracts/oidc/teen-invite";
import type { TeenInvite, TeenInviteCreated } from "@yourtal/contracts/oidc/teen-invite";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { Idempotent } from "../../shared/idempotency/idempotent.decorator";
import { RateLimit } from "../../shared/rate-limit/rate-limit.decorator";
import { OIDC_RUNTIME, OidcRuntime } from "./oidc-runtime";
import { TeenInviteClientGuard, verifiedClient } from "./teen-invite-client.guard";
import type { TeenInviteStore } from "./teen-invites";

class ParentDto extends createZodDto(teenInviteParentRequestSchema) {}

const RETENTION_MS = 24 * 60 * 60 * 1000;
const inviteIdParam = z.uuid();
const PUBLIC_REASON =
  "client-credentials token with scope teen_invites, verified by TeenInviteClientGuard; " +
  "a machine client, never a session or Cerbos principal";

/** The code is a credential kept only as a hash, so a replay never holds it. */
function withoutCode(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const { code: _code, ...rest } = value as Record<string, unknown>;
  return rest;
}

function inviteIdOf(raw: string): string {
  const parsed = inviteIdParam.safeParse(raw);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

const notFound = () =>
  new NotFoundException({ code: "invite_not_found", message: "no such invite for this app" });

/**
 * Group 3.9.e (docs/26 §3.3): SnapApp's server makes, reads and ends a
 * parent's invite for their teen. Every `sub` is the app's own pairwise one,
 * and every invite belongs to the calling client's sector.
 */
@Controller("api/oidc-clients/teen-invites")
@UseGuards(TeenInviteClientGuard)
export class TeenInvitesController {
  constructor(@Inject(OIDC_RUNTIME) private readonly runtime: OidcRuntime) {}

  @Idempotent({ retentionMs: RETENTION_MS, scopeBy: "oidc_client", redact: withoutCode })
  @RateLimit({ routeId: "oidc.teen_invites.create", ip: { max: 60, windowSeconds: 60 } })
  @PublicRoute(PUBLIC_REASON)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: ParentDto,
    @Req() request: FastifyRequest,
  ): Promise<TeenInviteCreated> {
    const client = verifiedClient(request, this.runtime);
    const made = await this.store().create({
      sector: client.sector,
      parentSub: body.parentSub,
      now: new Date(),
    });
    if (made.ok) return made.invite;
    if (made.error === "too_many_invites") {
      throw new HttpException(
        { code: "too_many_invites", message: "a parent may create 10 invites a day" },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    throw new ForbiddenException({
      code: "parent_not_eligible",
      message: "the parent is not a verified adult with YourTal",
    });
  }

  @RateLimit({ routeId: "oidc.teen_invites.read", ip: { max: 120, windowSeconds: 60 } })
  @PublicRoute(PUBLIC_REASON)
  @Get(":inviteId")
  async read(@Param("inviteId") raw: string, @Req() request: FastifyRequest): Promise<TeenInvite> {
    const client = verifiedClient(request, this.runtime);
    const invite = await this.store().find({
      sector: client.sector,
      inviteId: inviteIdOf(raw),
      now: new Date(),
    });
    if (invite === null) throw notFound();
    return invite;
  }

  @Idempotent({ retentionMs: RETENTION_MS, scopeBy: "oidc_client" })
  @RateLimit({ routeId: "oidc.teen_invites.end", ip: { max: 60, windowSeconds: 60 } })
  @PublicRoute(PUBLIC_REASON)
  @Post(":inviteId/end")
  @HttpCode(HttpStatus.OK)
  async end(
    @Param("inviteId") raw: string,
    @Body() body: ParentDto,
    @Req() request: FastifyRequest,
  ): Promise<TeenInvite> {
    const client = verifiedClient(request, this.runtime);
    // docs/29 §5: one receiver per sector (`event-receivers.ts`); `clients` carries only this environment's.
    const receiver =
      this.runtime.clients.find(
        (one) => one.sector === client.sector && one.eventsEndpoint !== undefined,
      )?.clientId ?? null;
    const ended = await this.store().end({
      sector: client.sector,
      inviteId: inviteIdOf(raw),
      parentSub: body.parentSub,
      receiver,
      now: new Date(),
    });
    if (ended === null) throw notFound();
    return ended;
  }

  private store(): TeenInviteStore {
    if (this.runtime.teenInvites === null) throw notFound();
    return this.runtime.teenInvites;
  }
}
