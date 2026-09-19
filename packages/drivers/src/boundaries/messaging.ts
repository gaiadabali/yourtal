import { type Result, err, ok } from "neverthrow";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";

/**
 * Telling a user something happened, outside the app.
 *
 * Templates rather than free text, because WhatsApp Business requires
 * pre-approved templates for anything outside a 24-hour service window.
 * Modelling that now means the constraint is visible while the messages are
 * being designed, rather than discovered during template review — an
 * interface that accepted arbitrary strings would be a simulator that lets
 * us build something the real vendor refuses to send.
 */

export interface MessageRequest {
  readonly idempotencyKey: string;
  readonly to: string;
  readonly template: string;
  readonly variables: Readonly<Record<string, string>>;
}

export interface MessageAccepted {
  readonly providerReference: string;
  readonly status: "queued";
}

export interface MessageEvent {
  readonly id: string;
  readonly providerReference: string;
  readonly status: "queued" | "delivered";
  readonly sequence: number;
}

export interface MessagingDriver {
  readonly mode: DriverMode;
  /** Templates this driver will send. An unknown one is declined, not sent. */
  readonly approvedTemplates: readonly string[];
  send(request: MessageRequest): Promise<Result<MessageAccepted, BoundaryFailure>>;
  deliveries(providerReference: string): readonly MessageEvent[];
}

export const SIMULATED_TEMPLATES = [
  "voucher_issued",
  "voucher_expiring",
  "payout_sent",
  "otp_fallback",
] as const;

export function createSimulatedMessaging(faultPlan?: FaultPlan): MessagingDriver {
  const engine = new FaultEngine(faultPlan);
  const accepted = new Map<string, MessageAccepted>();

  return {
    mode: "simulated",
    approvedTemplates: SIMULATED_TEMPLATES,

    send(request: MessageRequest): Promise<Result<MessageAccepted, BoundaryFailure>> {
      const replay = accepted.get(request.idempotencyKey);
      if (replay !== undefined) return Promise.resolve(ok(replay));

      const directive = engine.nextCall();
      if (directive !== "proceed") {
        return Promise.resolve(err(failureFor("messaging", directive)));
      }

      if (!SIMULATED_TEMPLATES.some((name) => name === request.template)) {
        // Declined, not a server error: the vendor answered, and the answer
        // was no. A caller that retries this sends nothing, forever.
        return Promise.resolve(
          err({
            kind: "declined",
            boundary: "messaging",
            detail: `Template "${request.template}" is not approved. Approved: ${SIMULATED_TEMPLATES.join(", ")}`,
            mayHaveSucceeded: false,
          }),
        );
      }

      const message: MessageAccepted = {
        providerReference: `simmsg_${request.idempotencyKey}`,
        status: "queued",
      };
      accepted.set(request.idempotencyKey, message);
      return Promise.resolve(ok(message));
    },

    deliveries(providerReference: string): readonly MessageEvent[] {
      return engine.shapeDeliveries([
        { id: `${providerReference}_1`, providerReference, status: "queued", sequence: 1 },
        { id: `${providerReference}_2`, providerReference, status: "delivered", sequence: 2 },
      ]);
    },
  };
}

export function createMessagingDriver(
  mode: DriverMode,
  _env: Environment,
  faultPlan?: FaultPlan,
): MessagingDriver {
  return mode === "simulated" ? createSimulatedMessaging(faultPlan) : refuseLiveDriver("messaging");
}
