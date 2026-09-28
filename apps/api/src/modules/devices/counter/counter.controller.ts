import { Body, Controller, Get, Inject, Logger, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { Principal } from "@yourtal/authz/principal";
import { Idempotent, NotValueMoving } from "../../../shared/idempotency/idempotent.decorator";
import { PublicRoute } from "../../../shared/authz/authorize.decorator";
import { RateLimit } from "../../../shared/rate-limit/rate-limit.decorator";
import { DeviceAuthorize, deviceIdOf } from "../device-authorize";
import { AUTHORIZATION_META_REPOSITORY } from "../persistence/authorization-meta.repository";
import type { AuthorizationMetaRepository } from "../persistence/authorization-meta.repository";
import { CAPTURE_LOG_REPOSITORY } from "../persistence/capture-log.repository";
import type { CaptureLogRepository } from "../persistence/capture-log.repository";
import { VOUCHER_INTERNAL_CLIENT } from "../../../shared/voucher-client/voucher-internal-client";
import type { VoucherInternalClient } from "../../../shared/voucher-client/voucher-internal-client";
import { WEBHOOK_EVENT_PUBLISHER } from "../developers/webhook-event-publisher";
import type { WebhookEventPublisher } from "../developers/webhook-event-publisher";
import { COUNTER_AUTHORIZE_RETENTION_MS, COUNTER_CAPTURE_RETENTION_MS } from "../retention";
import { CounterAuthorizeDto, CounterCaptureDto, CounterLookupDto } from "./dto/counter.schema";
import { lookupVoucher } from "./use-cases/lookup-voucher.use-case";
import { authorizeVoucher } from "./use-cases/authorize-voucher.use-case";
import { captureVoucher } from "./use-cases/capture-voucher.use-case";
import { listTodayLog } from "./use-cases/list-today-log.use-case";
import { mapCounterErrorToHttpException } from "./to-http-exception";

/** A device's own business/location, read only from its credential-derived principal — never the request. */
function deviceScope(principal: Principal): { businessId: string; locationId: string } {
  const businessId = principal.attr["deviceBusinessId"];
  const locationId = principal.attr["deviceLocationId"];
  if (typeof businessId !== "string" || typeof locationId !== "string") {
    // Unreachable for a real store_device principal (StoreDevicePrincipalResolver always sets both).
    throw new Error("store_device principal is missing its device scope");
  }
  return { businessId, locationId };
}

/**
 * The counter BFF (TASKS.md 8.2): a paired device only, never a session —
 * see `device-authorize.ts`'s header for why every route here is
 * `@PublicRoute` at the global-guard level with the PDP check run
 * explicitly. No offline queue anywhere: a call that cannot reach this
 * service (or that this service cannot forward to `services/voucher`)
 * fails outright, the same as any other network error the client already
 * has to handle (8.2.b).
 */
@Controller("api/counter")
export class CounterController {
  private readonly logger = new Logger(CounterController.name);

  constructor(
    private readonly authorize: DeviceAuthorize,
    @Inject(VOUCHER_INTERNAL_CLIENT) private readonly vouchers: VoucherInternalClient,
    @Inject(AUTHORIZATION_META_REPOSITORY) private readonly authMeta: AuthorizationMetaRepository,
    @Inject(CAPTURE_LOG_REPOSITORY) private readonly captureLog: CaptureLogRepository,
    @Inject(WEBHOOK_EVENT_PUBLISHER) private readonly webhookEvents: WebhookEventPublisher,
  ) {}

  @NotValueMoving("a lookup is a read-only preview; no hold is placed (8.2.a)")
  @RateLimit({ routeId: "counter.lookup", ip: { max: 120, windowSeconds: 60 } })
  @PublicRoute("device-credential authenticated; the PDP check runs explicitly below")
  @Post("lookup")
  async lookup(@Body() body: CounterLookupDto, @Req() request: FastifyRequest) {
    const principal = await this.authorize.requireDevice(
      request,
      (p) => ({
        kind: "redemption",
        id: `redemption-${deviceScope(p).businessId}`,
        attr: deviceScope(p),
      }),
      "lookup",
    );
    const { businessId } = deviceScope(principal);
    const result = await lookupVoucher(this.vouchers, businessId, body.code);
    if (result.isErr()) throw mapCounterErrorToHttpException(result.error);
    return result.value;
  }

  // F70/8.2.h: a device route, never a session — see IdempotentOptions.scopeBy's own doc comment.
  @Idempotent({ retentionMs: COUNTER_AUTHORIZE_RETENTION_MS, scopeBy: "device" })
  @RateLimit({ routeId: "counter.authorize", ip: { max: 60, windowSeconds: 60 } })
  @PublicRoute("device-credential authenticated; the PDP check runs explicitly below")
  @Post("authorize")
  async authorizeRoute(@Body() body: CounterAuthorizeDto, @Req() request: FastifyRequest) {
    const principal = await this.authorize.requireDevice(
      request,
      (p) => ({
        kind: "redemption",
        id: `redemption-${deviceScope(p).businessId}`,
        attr: deviceScope(p),
      }),
      "authorize",
    );
    const { businessId, locationId } = deviceScope(principal);
    const result = await authorizeVoucher(this.vouchers, this.authMeta, {
      code: body.code,
      amountMinor: body.amountMinor,
      currency: body.currency,
      orderRef: body.orderRef,
      orderTotalMinor: body.orderTotalMinor,
      deviceId: deviceIdOf(principal),
      businessId,
      locationId,
    });
    if (result.isErr()) throw mapCounterErrorToHttpException(result.error);
    return result.value;
  }

  // F70/8.2.h: a device route, never a session — see IdempotentOptions.scopeBy's own doc comment.
  @Idempotent({ retentionMs: COUNTER_CAPTURE_RETENTION_MS, scopeBy: "device" })
  @RateLimit({ routeId: "counter.capture", ip: { max: 60, windowSeconds: 60 } })
  @PublicRoute("device-credential authenticated; the PDP check runs explicitly below")
  @Post("capture")
  async captureRoute(@Body() body: CounterCaptureDto, @Req() request: FastifyRequest) {
    const principal = await this.authorize.requireDevice(
      request,
      (p) => ({
        kind: "redemption",
        id: `redemption-${deviceScope(p).businessId}`,
        attr: deviceScope(p),
      }),
      "capture",
    );
    const { businessId, locationId } = deviceScope(principal);
    const result = await captureVoucher(
      this.vouchers,
      this.authMeta,
      this.captureLog,
      deviceIdOf(principal),
      businessId,
      locationId,
      body.authorizationId,
    );
    if (result.isErr()) throw mapCounterErrorToHttpException(result.error);
    // 8.3.c: the capture already happened — an enqueue failure here must
    // never turn into a failed response for it. The queue's own
    // retries/backoff are the delivery job's problem, not this route's.
    try {
      await this.webhookEvents.publish({
        businessId,
        eventType: "voucher.captured",
        payload: {
          captureId: result.value.captureId,
          voucherId: result.value.voucherId,
          amountMinor: result.value.amountMinor,
          currency: result.value.currency,
          capturedAt: result.value.capturedAt,
          orderRef: result.value.orderRef,
        },
        idempotencyKey: result.value.captureId,
      });
    } catch (cause) {
      this.logger.error(`failed to enqueue voucher.captured webhook: ${String(cause)}`);
    }
    return result.value;
  }

  // GET, so @Idempotent/@NotValueMoving does not apply (mutating-routes.test.ts only scans
  // Post/Put/Patch/Delete) — a read carries no idempotency question at all.
  @RateLimit({ routeId: "counter.log", ip: { max: 60, windowSeconds: 60 } })
  @PublicRoute("device-credential authenticated; the PDP check runs explicitly below")
  @Get("log")
  async log(@Req() request: FastifyRequest) {
    const principal = await this.authorize.requireDevice(
      request,
      (p) => ({
        kind: "redemption",
        id: `redemption-${deviceScope(p).businessId}`,
        attr: { ...deviceScope(p), logScope: "today" },
      }),
      "view_log",
    );
    const result = await listTodayLog(this.captureLog, deviceIdOf(principal));
    if (result.isErr()) throw mapCounterErrorToHttpException(result.error);
    return { entries: result.value };
  }
}
