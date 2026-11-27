import {
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Req,
  ServiceUnavailableException,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import { Readable } from "node:stream";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import {
  attachmentFetchRequestSchema,
  statementAckRequestSchema,
} from "@yourtal/contracts/spambank/events";
import { PublicRoute } from "../../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { RateLimit } from "../../../shared/rate-limit/rate-limit.decorator";
import { OidcClientRateLimitGuard } from "../../oidc/client-rate-limit.guard";
import { OIDC_RUNTIME, OidcRuntime } from "../../oidc/oidc-runtime";
import { OidcClientGuard, verifiedClient } from "../../oidc/teen-invite-client.guard";
import { SpambankMachineService } from "./machine.service";
import type { ResolvedPerson } from "./machine.service";

export const SPAMBANK_SCOPE = "spambank";
/** A client-credentials token with scope `spambank`, looked up in the provider in this process. */
export const SpambankIngestClientGuard = OidcClientGuard(SPAMBANK_SCOPE);

class FetchDto extends createZodDto(attachmentFetchRequestSchema) {}
class AckDto extends createZodDto(statementAckRequestSchema) {}

const PUBLIC_REASON =
  "client-credentials token with scope spambank, verified by SpambankIngestClientGuard; " +
  "a machine client, never a session or Cerbos principal";

/** Per app, counted on its verified client id: a statement mail has up to 10 files. */
const LIMITS = {
  identity: { max: 300, windowSeconds: 60 },
  ip: { max: 1200, windowSeconds: 60 },
} as const;

/**
 * BUILD.md §5.2: the two routes SnapApp's server uses to bring a mailed statement in. `/attachments/fetch`
 * returns the bytes of one offered (message, blob) pair; `/statements/ack` records what SnapApp did with it.
 * SnapApp only (its sector's client): FTR's server client can reach the other `spambank` routes, not these.
 */
@Controller("api/oidc-clients/spambank")
@UseGuards(SpambankIngestClientGuard, OidcClientRateLimitGuard)
export class SpambankIngestMachineController {
  constructor(
    @Inject(OIDC_RUNTIME) private readonly runtime: OidcRuntime,
    private readonly machine: SpambankMachineService,
  ) {}

  /** Someone's mail: never cached, never sniffed. */
  @NotValueMoving("Reads one offered attachment; nothing is created, so a repeat is harmless.")
  @RateLimit({ routeId: "spambank.attachments.fetch", ...LIMITS })
  @PublicRoute(PUBLIC_REASON)
  @Post("attachments/fetch")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  @Header("X-Content-Type-Options", "nosniff")
  async fetch(@Body() body: FetchDto, @Req() request: FastifyRequest): Promise<StreamableFile> {
    const person = await this.person(request, body.sub);
    const result = await this.machine.fetchOffered(person, body.emailId, body.blobId);
    if (!result.ok) {
      if (result.code === "not_found") {
        throw new NotFoundException({ code: "not_found", message: "no such offered attachment" });
      }
      if (result.code === "unavailable") {
        throw new ServiceUnavailableException({
          code: "spambank_unavailable",
          message: "the mail server could not be reached",
        });
      }
      throw new BadGatewayException({ code: "upstream_auth", message: "the mail server refused" });
    }
    return new StreamableFile(Readable.fromWeb(result.body), {
      type: result.type,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(result.name)}`,
    });
  }

  @NotValueMoving("Records the outcome of one offer; the same outcome twice is the same row.")
  @RateLimit({ routeId: "spambank.statements.ack", ...LIMITS })
  @PublicRoute(PUBLIC_REASON)
  @Post("statements/ack")
  @HttpCode(HttpStatus.NO_CONTENT)
  async ack(@Body() body: AckDto, @Req() request: FastifyRequest): Promise<void> {
    const person = await this.person(request, body.sub);
    const found = await this.machine.acknowledge(
      person,
      body.emailId,
      body.blobId,
      body.outcome,
      body.detail,
    );
    if (!found) throw new NotFoundException({ code: "not_found", message: "no such offer" });
  }

  /** SnapApp's client only, then the person by its `sub`, with the refusals §5 names. */
  private async person(request: FastifyRequest, sub: string): Promise<ResolvedPerson> {
    const client = verifiedClient(request, this.runtime);
    if (client.app !== "snapapp") {
      throw new ForbiddenException({ code: "not_allowed", message: "this route is for SnapApp" });
    }
    const resolved = await this.machine.resolve(client.sector, sub);
    if (resolved.ok) return resolved;
    if (resolved.code === "unknown_subject") {
      throw new NotFoundException({
        code: "unknown_subject",
        message: "no such person in this app",
      });
    }
    if (resolved.code === "not_enabled") {
      throw new ConflictException({ code: "not_enabled", message: "the person has no mailbox" });
    }
    throw new ForbiddenException({
      code: "not_allowed",
      message: "mail is not available for this person",
    });
  }
}
