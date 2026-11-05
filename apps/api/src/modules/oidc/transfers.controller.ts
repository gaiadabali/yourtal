import {
  Body,
  ConflictException,
  Controller,
  Header,
  HttpCode,
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
import {
  transferAssertionRequestSchema,
  transferCreateRequestSchema,
} from "@yourtal/contracts/oidc/transfer";
import type { TransferAssertion, TransferCreated } from "@yourtal/contracts/oidc/transfer";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { RateLimit } from "../../shared/rate-limit/rate-limit.decorator";
import { OIDC_RUNTIME, OidcRuntime } from "./oidc-runtime";
import { TransferClientGuard, verifiedClient } from "./teen-invite-client.guard";
import type { TransferStore } from "./transfers";

class CreateDto extends createZodDto(transferCreateRequestSchema) {}
class AssertionDto extends createZodDto(transferAssertionRequestSchema) {}

const RETENTION_MS = 24 * 60 * 60 * 1000;
const transferIdParam = z.uuid();
const PUBLIC_REASON =
  "client-credentials token with scope app_transfers, verified by TransferClientGuard; " +
  "a machine client, never a session or Cerbos principal";

const notFound = (code = "transfer_not_found") =>
  new NotFoundException({ code, message: "no such transfer for this app" });

/**
 * Group 4.8.a (docs/30 §5): SnapApp's server opens a transfer for its own
 * `sub`, and once the person has sent it on YourTal's screen, fetches the
 * assertion only the destination can open. Every transfer belongs to the
 * calling client's sector; the API never says whether the person uses the destination.
 */
@Controller("api/oidc-clients/transfers")
@UseGuards(TransferClientGuard)
export class TransfersController {
  constructor(@Inject(OIDC_RUNTIME) private readonly runtime: OidcRuntime) {}

  @Idempotent({ retentionMs: RETENTION_MS, scopeBy: "oidc_client" })
  @RateLimit({ routeId: "oidc.transfers.create", ip: { max: 60, windowSeconds: 60 } })
  @PublicRoute(PUBLIC_REASON)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateDto, @Req() request: FastifyRequest): Promise<TransferCreated> {
    const client = verifiedClient(request, this.runtime);
    const made = await this.store().create({
      sector: client.sector,
      fromSub: body.fromSub,
      to: body.to,
      financialYear: body.financialYear,
      bundleSha256: body.bundleSha256,
      lineCount: body.lineCount,
      now: new Date(),
    });
    if (!made.ok) {
      throw made.error === "unknown_subject"
        ? new NotFoundException({ code: "unknown_subject", message: "no such person in this app" })
        : notFound("no_route");
    }
    return { transferId: made.transferId, expiresAt: made.expiresAt.toISOString() };
  }

  /** A credential: never kept by the idempotency layer, cached or logged. */
  @NotValueMoving("Mints a short-lived assertion; a repeat mints the same claims.")
  @RateLimit({ routeId: "oidc.transfers.assertion", ip: { max: 60, windowSeconds: 60 } })
  @PublicRoute(PUBLIC_REASON)
  @Post(":transferId/assertion")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  async assertion(
    @Param("transferId") raw: string,
    @Body() body: AssertionDto,
    @Req() request: FastifyRequest,
  ): Promise<TransferAssertion> {
    const parsed = transferIdParam.safeParse(raw);
    if (!parsed.success) throw notFound();
    const minted = await this.store().assertion({
      client: verifiedClient(request, this.runtime),
      transferId: parsed.data,
      fromSub: body.fromSub,
      now: new Date(),
    });
    if (minted.ok) {
      return { assertion: minted.assertion, expiresAt: minted.expiresAt.toISOString() };
    }
    if (minted.error === "not_found") throw notFound();
    throw new ConflictException({
      code: minted.error,
      message:
        minted.error === "not_approved"
          ? "the person has not sent this yet"
          : "this transfer can no longer be sent",
    });
  }

  private store(): TransferStore {
    if (this.runtime.transfers === null) throw notFound();
    return this.runtime.transfers;
  }
}
