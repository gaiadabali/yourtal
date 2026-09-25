import { type Result, err, ok } from "neverthrow";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";
import { type SimOutboxStore, createInMemorySimOutboxStore } from "../sim-outbox";

/**
 * A mobile/web push notification to a device. 1.6.c (TASKS.md).
 *
 * A separate boundary from `messaging.ts` — that one is WhatsApp Business
 * (template-gated, 24-hour service window); this is a platform push
 * (FCM/APNs/Web Push), which has no template requirement but also no
 * delivery guarantee once the OS decides to drop it, which is exactly why a
 * caller needs a durable record of what was SENT, not just a return value —
 * see `sim-outbox.ts`.
 */

export interface PushMessage {
  readonly idempotencyKey: string;
  /** The device/subscription token push would target — never a phone number. */
  readonly to: string;
  readonly region: "AU" | "ID";
  /** e.g. "points_unlocked", "streak_reminder" — the caller's own vocabulary. */
  readonly category: string;
  readonly title: string;
  readonly body: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PushSent {
  readonly id: string;
}

export interface PushDriver {
  readonly mode: DriverMode;
  send(message: PushMessage): Promise<Result<PushSent, BoundaryFailure>>;
}

export function createSimulatedPush(
  store: SimOutboxStore = createInMemorySimOutboxStore(),
  faultPlan?: FaultPlan,
): PushDriver {
  const engine = new FaultEngine(faultPlan);

  return {
    mode: "simulated",

    async send(message: PushMessage): Promise<Result<PushSent, BoundaryFailure>> {
      const directive = engine.nextCall();
      if (directive !== "proceed") {
        return err(failureFor("push", directive));
      }

      const recorded = await store.record({
        boundary: "push",
        region: message.region,
        recipient: message.to,
        category: message.category,
        subject: message.title,
        body: message.body,
        idempotencyKey: message.idempotencyKey,
        // `exactOptionalPropertyTypes`: an explicit `metadata: undefined` is
        // not the same as omitting the key, so it is only ever included.
        ...(message.metadata === undefined ? {} : { metadata: message.metadata }),
      });

      return ok({ id: recorded.id });
    },
  };
}

export function createPushDriver(
  mode: DriverMode,
  _env: Environment,
  faultPlan?: FaultPlan,
  store?: SimOutboxStore,
): PushDriver {
  return mode === "simulated" ? createSimulatedPush(store, faultPlan) : refuseLiveDriver("push");
}
