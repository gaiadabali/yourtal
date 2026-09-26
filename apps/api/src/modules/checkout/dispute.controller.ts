import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import { disputeRequestSchema, type DisputeResult } from "@yourtal/contracts/checkout/dispute";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import { Idempotent } from "../../shared/idempotency/idempotent.decorator";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { CHECKOUT_DB, SAGA_DEPS } from "./checkout.tokens";
import { disputeVoucher } from "./use-cases/dispute-voucher";
import type { SagaDeps } from "./use-cases/run-saga";

class DisputeDto extends createZodDto(disputeRequestSchema) {}

const DISPUTE_RETENTION_MS = 30 * 24 * 60 * 60_000;

/**
 * 4.7.c: under the wallet's path, owned by checkout because a dispute undoes
 * a checkout. `WalletAttributeLoader` 404s a voucher the caller does not hold.
 */
@Controller("api/wallet/vouchers")
export class DisputeController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(SAGA_DEPS) private readonly deps: SagaDeps,
    @Inject(CHECKOUT_DB) private readonly db: AppDb,
  ) {}

  @Idempotent({ retentionMs: DISPUTE_RETENTION_MS })
  @Authorize({ kind: "wallet", action: "view" })
  @Post(":voucherId/dispute")
  @HttpCode(200)
  async dispute(
    @Req() request: FastifyRequest,
    @Param("voucherId") voucherId: string,
    @Body() body: DisputeDto,
  ): Promise<DisputeResult> {
    const userId = (await this.principals.resolve(request)).id;
    const result = await disputeVoucher(this.deps, this.db, userId, voucherId, body.reason);
    if (result.isErr())
      throw new ConflictException({ code: result.error.code, message: result.error.message });
    return result.value;
  }
}
