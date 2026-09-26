import {
  Body,
  ConflictException,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { createZodDto } from "nestjs-zod";
import {
  checkoutQuoteRequestSchema,
  checkoutRequestSchema,
  type CheckoutQuote,
  type CheckoutResult,
} from "@yourtal/contracts/checkout/checkout";
import { Authorize } from "../../shared/authz/authorize.decorator";
import { PrincipalService } from "../../shared/authz/principal.service";
import { Idempotent, NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { USER_PROFILE_REPOSITORY } from "../identity/persistence/user-profile.repository";
import type { UserProfileRepository } from "../identity/persistence/user-profile.repository";
import { CHECKOUT_DB, SAGA_DEPS } from "./checkout.tokens";
import { findListingForCheckout } from "./persistence/listing-for-checkout";
import { quoteCheckout } from "./use-cases/quote-checkout";
import { runSaga, type SagaDeps } from "./use-cases/run-saga";

class CheckoutQuoteDto extends createZodDto(checkoutQuoteRequestSchema) {}
class CheckoutDto extends createZodDto(checkoutRequestSchema) {}

/** A voucher's code is live for its own lifetime; a replayed confirm must still answer. */
const CHECKOUT_RETENTION_MS = 30 * 24 * 60 * 60_000;

/**
 * The viewer's checkout (4.7): quote, then confirm. Spending points is a
 * `redeem` on the caller's own wallet, so a suspended or frozen account
 * cannot (`account_owner_in_good_standing`).
 */
@Controller("api/checkout")
export class CheckoutController {
  constructor(
    private readonly principals: PrincipalService,
    @Inject(SAGA_DEPS) private readonly deps: SagaDeps,
    @Inject(CHECKOUT_DB) private readonly db: AppDb,
    @Inject(USER_PROFILE_REPOSITORY) private readonly profiles: UserProfileRepository,
  ) {}

  @NotValueMoving(
    "A quote spends nothing: a second one is a second 15-minute price hold that lapses unused.",
  )
  @Authorize({ kind: "wallet", action: "redeem" })
  @Post("quote")
  @HttpCode(201)
  async quote(
    @Req() request: FastifyRequest,
    @Body() body: CheckoutQuoteDto,
  ): Promise<CheckoutQuote> {
    const userId = (await this.principals.resolve(request)).id;
    const profile = await this.profiles.findByUserId(userId);
    if (profile === null) throw new NotFoundException("No such account.");
    const quoted = await quoteCheckout(
      this.deps,
      {
        userId,
        region: profile.region,
        dateOfBirth: profile.dateOfBirth,
        trustTier: profile.trustTier,
      },
      await findListingForCheckout(this.db, body.listingId),
    );
    if (quoted.isErr()) throw refusal(quoted.error);
    return quoted.value;
  }

  @Idempotent({ retentionMs: CHECKOUT_RETENTION_MS })
  @Authorize({ kind: "wallet", action: "redeem" })
  @Post()
  @HttpCode(200)
  async confirm(
    @Req() request: FastifyRequest,
    @Body() body: CheckoutDto,
  ): Promise<CheckoutResult> {
    const userId = (await this.principals.resolve(request)).id;
    const saga = await this.deps.sagas.findById(body.checkoutId);
    if (saga === null || saga.userId !== userId) throw new NotFoundException("No such checkout.");
    const ran = await runSaga(this.deps, saga);
    if (ran.isErr()) throw refusal(ran.error);
    if (ran.value.voucherId === null) throw new ConflictException({ code: "checkout_incomplete" });
    return {
      checkoutId: ran.value.id,
      state: ran.value.state === "done" ? "done" : "pending",
      voucherId: ran.value.voucherId,
      pricePoints: ran.value.pricePoints,
    };
  }
}

// A refusal names its closed code; the web words it.
function refusal(error: { readonly code: string; readonly message: string }): Error {
  if (error.code === "listing_unavailable") return new NotFoundException(error);
  return new ConflictException({ code: error.code, message: error.message });
}
