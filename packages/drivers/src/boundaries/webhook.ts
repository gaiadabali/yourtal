import { type Result, err, ok } from "neverthrow";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";
import { type SimOutboxStore, createInMemorySimOutboxStore } from "../sim-outbox";

/**
 * Telling a PARTNER's own system that something happened here — the
 * outbound half. 1.6.c (TASKS.md).
 *
 * Not to be confused with `webhook-inbox.ts` (deduplicating a webhook WE
 * receive) or `webhook-signature.ts` (verifying one). Those two exist
 * because a real payment provider calls US; this one exists because
 * `snap-app` (the first integration, `docs/16`) or a future partner needs to
 * be called BY us, and every call has to be reviewable the same way an
 * outbound email does — see `sim-outbox.ts`.
 */

export interface WebhookDelivery {
  readonly idempotencyKey: string;
  /** The partner's registered endpoint — never a secret, so it is safe to show a reviewer plainly. */
  readonly url: string;
  readonly region: "AU" | "ID";
  /** The event name a partner's own webhook contract defines, e.g. "voucher.captured". */
  readonly event: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface WebhookSent {
  readonly id: string;
}

export interface WebhookDriver {
  readonly mode: DriverMode;
  send(delivery: WebhookDelivery): Promise<Result<WebhookSent, BoundaryFailure>>;
}

export function createSimulatedWebhook(
  store: SimOutboxStore = createInMemorySimOutboxStore(),
  faultPlan?: FaultPlan,
): WebhookDriver {
  const engine = new FaultEngine(faultPlan);

  return {
    mode: "simulated",

    async send(delivery: WebhookDelivery): Promise<Result<WebhookSent, BoundaryFailure>> {
      const directive = engine.nextCall();
      if (directive !== "proceed") {
        return err(failureFor("webhook", directive));
      }

      const recorded = await store.record({
        boundary: "webhook",
        region: delivery.region,
        recipient: delivery.url,
        category: delivery.event,
        body: JSON.stringify(delivery.payload),
        metadata: delivery.payload,
        idempotencyKey: delivery.idempotencyKey,
      });

      return ok({ id: recorded.id });
    },
  };
}

export function createWebhookDriver(
  mode: DriverMode,
  _env: Environment,
  faultPlan?: FaultPlan,
  store?: SimOutboxStore,
): WebhookDriver {
  return mode === "simulated"
    ? createSimulatedWebhook(store, faultPlan)
    : refuseLiveDriver("webhook");
}
