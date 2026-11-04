import { type Result, err, ok } from "neverthrow";
import { EVENT_RECEIVERS } from "@yourtal/contracts/oidc/event-receivers";
import { type BoundaryFailure, FaultEngine, failureFor } from "../fault-engine";
import type { FaultPlan } from "../faults";
import type { DriverMode } from "../driver-mode";

/**
 * Posting a signed Security Event Token to a sign-in app's receiver (docs/26 §2.3, docs/29 §4.2).
 * The caller signs; this only carries the token, and maps the app's answer onto the shared
 * failure vocabulary so the sender can pick the outbox state:
 * - 202 -> ok (delivered)
 * - 400 with any `err` but `invalid_key` -> `declined` (the sender stops: one side has a bug)
 * - 400 `invalid_key`, 429, 5xx, a timeout, a network error, any other status -> `server_error`
 *   or `timeout` (the sender retries; `invalid_key` means the app holds an old JWKS)
 *
 * `detail` carries the status and the app's `err` code, never the token.
 */

export const SECEVENT_CONTENT_TYPE = "application/secevent+jwt";
export const APP_EVENT_TIMEOUT_MS = 10_000;

export interface AppEventPost {
  readonly endpoint: string;
  /** The compact JWS. */
  readonly token: string;
}

export interface AppEventsDriver {
  readonly mode: DriverMode;
  post(event: AppEventPost): Promise<Result<{ readonly status: 202 }, BoundaryFailure>>;
}

export function createSimulatedAppEvents(faultPlan?: FaultPlan): AppEventsDriver {
  const engine = new FaultEngine(faultPlan);
  return {
    mode: "simulated",
    // No call: dev's and CI's receivers are real apps (docs/29 §4.2).
    post() {
      const directive = engine.nextCall();
      return Promise.resolve(
        directive === "proceed" ? ok({ status: 202 }) : err(failureFor("app_events", directive)),
      );
    },
  };
}

export interface LiveAppEventsOptions {
  /** The only addresses it will post to; the registry's by default. */
  readonly endpoints?: readonly string[];
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

function failure(kind: "server_error" | "decline", detail: string): BoundaryFailure {
  return { ...failureFor("app_events", kind), detail };
}

async function errCode(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const code =
      typeof body === "object" && body !== null ? (body as { err?: unknown }).err : undefined;
    return typeof code === "string" && /^[a-z_]{1,40}$/.test(code) ? code : "none";
  } catch {
    return "none";
  }
}

export function createLiveAppEvents(options: LiveAppEventsOptions = {}): AppEventsDriver {
  const endpoints = options.endpoints ?? EVENT_RECEIVERS.map((receiver) => receiver.endpoint);
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? APP_EVENT_TIMEOUT_MS;

  return {
    mode: "live",

    async post({ endpoint, token }) {
      if (!endpoints.includes(endpoint)) {
        return err(failure("decline", "Not a registered event receiver; nothing was sent."));
      }
      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": SECEVENT_CONTENT_TYPE, Accept: "application/json" },
          body: token,
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        return err(
          error instanceof Error && error.name === "TimeoutError"
            ? failureFor("app_events", "timeout")
            : failure("server_error", "The request to the app failed."),
        );
      }
      if (response.status === 202) {
        await response.body?.cancel();
        return ok({ status: 202 });
      }
      if (response.status === 400) {
        const code = await errCode(response);
        return err(
          code === "invalid_key"
            ? failure("server_error", "400 invalid_key")
            : failure("decline", `400 ${code}`),
        );
      }
      await response.body?.cancel();
      return err(failure("server_error", String(response.status)));
    },
  };
}

export function createAppEventsDriver(mode: DriverMode, faultPlan?: FaultPlan): AppEventsDriver {
  return mode === "simulated" ? createSimulatedAppEvents(faultPlan) : createLiveAppEvents();
}
