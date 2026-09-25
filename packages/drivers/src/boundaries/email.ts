import { type Result, err, ok } from "neverthrow";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode, Environment } from "../driver-mode";
import { refuseLiveDriver } from "../live-driver";
import { type SimOutboxStore, createInMemorySimOutboxStore } from "../sim-outbox";

/**
 * Sending a user an email. 1.6.a (driver half — TASKS.md; the caller,
 * `AuthService.deliver`, is wired up separately once 1.4 lands).
 *
 * Every simulated call records to `SimOutboxStore` (real deployments of this
 * — a Postgres-backed store over `platform.sim_outbox` — let `/api/dev/inbox`,
 * 1.6.b, show a reviewer exactly what would have gone out) rather than
 * holding state in a private `Map` the way `messaging.ts` does — see
 * `sim-outbox.ts`'s header for why that distinction matters here
 * specifically.
 */

export interface EmailMessage {
  readonly idempotencyKey: string;
  readonly to: string;
  readonly region: "AU" | "ID";
  /** e.g. "email_verification", "password_reset", "invitation" — `AuthService`'s own vocabulary. */
  readonly category: string;
  readonly subject: string;
  readonly body: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface EmailSent {
  readonly id: string;
}

export interface EmailDriver {
  readonly mode: DriverMode;
  send(message: EmailMessage): Promise<Result<EmailSent, BoundaryFailure>>;
}

export function createSimulatedEmail(
  store: SimOutboxStore = createInMemorySimOutboxStore(),
  faultPlan?: FaultPlan,
): EmailDriver {
  const engine = new FaultEngine(faultPlan);

  return {
    mode: "simulated",

    async send(message: EmailMessage): Promise<Result<EmailSent, BoundaryFailure>> {
      const directive = engine.nextCall();
      if (directive !== "proceed") {
        return err(failureFor("email", directive));
      }

      const recorded = await store.record({
        boundary: "email",
        region: message.region,
        recipient: message.to,
        category: message.category,
        subject: message.subject,
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

export function createEmailDriver(
  mode: DriverMode,
  _env: Environment,
  faultPlan?: FaultPlan,
  store?: SimOutboxStore,
): EmailDriver {
  return mode === "simulated" ? createSimulatedEmail(store, faultPlan) : refuseLiveDriver("email");
}
