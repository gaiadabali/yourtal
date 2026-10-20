import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PublicRoute } from "../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../shared/idempotency/idempotent.decorator";
import { NoRateLimit } from "../../shared/rate-limit/rate-limit.decorator";
import { PAYMENT_PROVIDERS } from "../../shared/drivers/payment-providers.module";
import type { RegionPaymentProviders } from "../../shared/drivers/payment-providers.module";
import { PAYMENT_EVENT_HANDLERS } from "./payment-event-handlers";
import type { PaymentEventHandlers } from "./payment-event-handlers";
import { PROVIDER_EVENTS } from "./provider-event.repository";
import type { ProviderEventRepository } from "./provider-event.repository";
import { receiveWebhook } from "./use-cases/receive-webhook.use-case";

const logger = new Logger("StripeWebhook");

/**
 * 5.1.a: Stripe's event deliveries (on staging, the simulation's). Public:
 * the HMAC over the raw body is the authentication, checked by the AU driver.
 * 400 for a delivery that will never verify, 200 once handled or already
 * handled, 500 when a handler failed so the sender tries again.
 */
@Controller("api/webhooks")
export class StripeWebhookController {
  constructor(
    @Inject(PAYMENT_PROVIDERS) private readonly providers: RegionPaymentProviders,
    @Inject(PROVIDER_EVENTS) private readonly events: ProviderEventRepository,
    @Inject(PAYMENT_EVENT_HANDLERS) private readonly handlers: PaymentEventHandlers,
  ) {}

  @PublicRoute(
    "Stripe's signed event deliveries; the signature on the raw body is the authentication.",
  )
  @NoRateLimit(
    "Deliveries arrive in bursts from a few sender addresses and a 429 only delays money already " +
      "received; a forged delivery costs one HMAC before it is refused.",
  )
  @NotValueMoving(
    "Exactly once by the provider's event id (payment.provider_event), and each handler is " +
      "idempotent on its own row; senders do not send an Idempotency-Key.",
  )
  @Post("stripe")
  @HttpCode(200)
  async receive(@Req() request: FastifyRequest): Promise<{ received: true }> {
    const raw: unknown = Reflect.get(request, "rawBody");
    // Without the exact bytes no signature can verify; that is a boot setting, so let the sender retry.
    if (!(raw instanceof Buffer) && typeof raw !== "string") {
      throw new InternalServerErrorException("The raw request body is not available.");
    }
    const headers: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      headers[name] = Array.isArray(value) ? value[0] : value;
    }
    const delivery = { rawBody: typeof raw === "string" ? raw : raw.toString("utf8"), headers };

    let outcome;
    try {
      outcome = await receiveWebhook(
        { driver: this.providers.AU.payments, events: this.events, handlers: this.handlers },
        delivery,
        Date.now(),
      );
    } catch (error) {
      logger.error(
        `webhook handling failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new InternalServerErrorException("The event could not be handled; it will be retried.");
    }
    if (outcome.kind === "refused") {
      logger.warn(`webhook refused: ${outcome.reason}`);
      throw new BadRequestException({ code: outcome.reason, message: "The delivery was refused." });
    }
    return { received: true };
  }
}
