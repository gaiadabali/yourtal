import {
  Controller,
  HttpCode,
  Inject,
  Logger,
  PayloadTooLargeException,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { PublicRoute } from "../../../shared/authz/authorize.decorator";
import { NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { NoRateLimit } from "../../../shared/rate-limit/rate-limit.decorator";
import type { SpambankConfig } from "../../../config/spambank-config";
import { SPAMBANK_CONFIG } from "../spambank.tokens";
import { StalwartWebhookService } from "./stalwart-webhook.service";
import { WEBHOOK_MAX_BYTES, verifyStalwartSignature } from "./webhook-signature";

const logger = new Logger("StalwartWebhook");

/**
 * BUILD.md §5.4: Stalwart's webhook ("mail was delivered"). It is only a nudge: the 1-minute reconcile
 * reads every mailbox's new mail whether or not this ever fires, so Stalwart's acceptance of mail never
 * depends on this route and a payload nobody understands costs a minute, not a message. The HMAC over the
 * raw body is the authentication; a bad or missing signature is 401 and nothing is read from the body.
 */
@Controller("api/spambank/hooks")
export class StalwartWebhookController {
  constructor(
    @Inject(SPAMBANK_CONFIG) private readonly config: SpambankConfig,
    private readonly webhook: StalwartWebhookService,
  ) {}

  @PublicRoute(
    "Stalwart's webhook; the X-Signature HMAC-SHA256 over the raw body with SPAMBANK_WEBHOOK_SECRET is the authentication.",
  )
  @NoRateLimit(
    "One delivery per message from Stalwart on this host; a forged one costs one HMAC before it is refused, " +
      "and a 429 would only delay mail the reconcile reads anyway.",
  )
  @NotValueMoving(
    "A nudge to read a mailbox: ingest is idempotent per message (spambank.ingested_message), and Stalwart sends no Idempotency-Key.",
  )
  @Post("stalwart")
  @HttpCode(202)
  async receive(@Req() request: FastifyRequest): Promise<{ accepted: true }> {
    const raw: unknown = Reflect.get(request, "rawBody");
    const bytes =
      raw instanceof Buffer ? raw : typeof raw === "string" ? Buffer.from(raw) : undefined;
    const secret = this.config.webhookSecret;
    const header = request.headers["x-signature"];
    if (secret === undefined) {
      logger.warn("a webhook arrived but SPAMBANK_WEBHOOK_SECRET is not set; refused");
      throw new UnauthorizedException({ code: "unauthorized", message: "bad signature" });
    }
    if (bytes === undefined || bytes.length > WEBHOOK_MAX_BYTES) {
      if (bytes !== undefined) {
        throw new PayloadTooLargeException({ code: "too_large", message: "body over 64 KB" });
      }
      throw new UnauthorizedException({ code: "unauthorized", message: "bad signature" });
    }
    if (!verifyStalwartSignature(secret, bytes, Array.isArray(header) ? header[0] : header)) {
      throw new UnauthorizedException({ code: "unauthorized", message: "bad signature" });
    }
    await this.webhook.handle(request.body);
    return { accepted: true };
  }
}
