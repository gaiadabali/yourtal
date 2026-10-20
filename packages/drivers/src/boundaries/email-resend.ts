import { type Result, err, ok } from "neverthrow";
import { type BoundaryFailure, failureFor } from "../fault-engine";
import type { Environment } from "../driver-mode";
import type { EmailDriver, EmailMessage, EmailSent } from "./email";

/**
 * The live email driver: Resend's REST API (F103), plain `fetch`.
 *
 * Failure mapping onto the shared `BoundaryFailure` vocabulary:
 * - timeout -> `timeout`; network error -> `server_error` (both `mayHaveSucceeded`)
 * - 429, 5xx, 409 concurrent-idempotency -> `server_error` (retryable)
 * - any other 4xx -> `declined` (not retryable)
 *
 * It never logs, and `detail` never carries the recipient, subject, body or
 * key: only the HTTP status and Resend's error name.
 */

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const RESEND_TIMEOUT_MS = 10_000;

export interface ResendEmailConfig {
  readonly apiKey: string;
  readonly from: string;
  readonly timeoutMs?: number;
  readonly endpoint?: string;
  readonly fetch?: typeof fetch;
}

export function resendConfigFromEnv(env: Environment): ResendEmailConfig {
  const apiKey = env.EMAIL_API_KEY?.trim();
  const from = env.EMAIL_FROM?.trim();
  // Defence in depth: `resolveDriverMode` already refuses a live boot without these.
  if (apiKey === undefined || apiKey === "" || from === undefined || from === "") {
    throw new Error('EMAIL_DRIVER="live" requires EMAIL_API_KEY and EMAIL_FROM.');
  }
  return { apiKey, from };
}

function failure(
  directive: "timeout" | "server_error" | "decline",
  detail: string,
  mayHaveSucceeded: boolean,
): BoundaryFailure {
  return { ...failureFor("email", directive), detail, mayHaveSucceeded };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function field(body: unknown, key: string): string | undefined {
  if (typeof body !== "object" || body === null || !(key in body)) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function createResendEmail(config: ResendEmailConfig): EmailDriver {
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? RESEND_TIMEOUT_MS;
  const endpoint = config.endpoint ?? RESEND_ENDPOINT;

  return {
    mode: "live",

    async send(message: EmailMessage): Promise<Result<EmailSent, BoundaryFailure>> {
      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: message.subject,
            text: message.body,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        return err(
          timedOut
            ? failureFor("email", "timeout")
            : failure("server_error", "The request to the email provider failed.", true),
        );
      }

      const body = await readJson(response);
      const status = String(response.status);

      if (response.ok) {
        const id = field(body, "id");
        return id === undefined
          ? err(
              failure(
                "server_error",
                "The email provider answered 2xx without a message id.",
                true,
              ),
            )
          : ok({ id });
      }

      const name = (field(body, "name") ?? "unknown").slice(0, 64);
      if (response.status === 429) {
        return err(
          failure("server_error", `Rate limited by the email provider (${status} ${name}).`, false),
        );
      }
      if (
        response.status >= 500 ||
        (response.status === 409 && name === "concurrent_idempotent_requests")
      ) {
        return err(failure("server_error", `The email provider returned ${status} ${name}.`, true));
      }
      return err(
        failure("decline", `The email provider rejected the message (${status} ${name}).`, false),
      );
    },
  };
}
