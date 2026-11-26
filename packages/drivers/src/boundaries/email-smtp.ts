import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { type Result, err, ok } from "neverthrow";
import { type BoundaryFailure, failureFor } from "../fault-engine";
import type { Environment } from "../driver-mode";
import type { EmailDriver, EmailMessage, EmailSent } from "./email";

/**
 * The live email driver, SMTP flavour: our own relay (Helios) instead of Resend.
 * Chosen over Resend when `EMAIL_SMTP_URL` is set (see `selectEmailVendor`).
 *
 * `EMAIL_SMTP_URL` is `smtp://host[:587]` (STARTTLS), `smtps://host[:465]`
 * (implicit TLS), optionally `user:pass@` (percent-encoded). No credentials is
 * valid: a trusted relay that authenticates by network.
 *
 * ## Transport security (never relaxed on staging or production)
 * - `smtp://` REQUIRES STARTTLS (`requireTLS`): nodemailer's default is to send
 *   in the clear when the server does not offer it, and these emails carry
 *   sign-in and reset links. No STARTTLS means the send fails, not downgrades.
 * - The certificate must verify (`rejectUnauthorized: true`), so the host in the
 *   URL must be the name on the relay's certificate.
 * - `EMAIL_SMTP_ALLOW_INSECURE=true` drops TLS for a local dev relay only. It is
 *   refused unless `APP_ENV` is unset or `dev`, so it fails closed on staging,
 *   production and any misspelt value.
 * - connect, greeting and socket timeouts, so a dead relay cannot hang a request.
 *
 * ## Failure mapping (same `BoundaryFailure` vocabulary as the Resend driver)
 * - timeout -> `timeout`; connection/network error -> `server_error`
 * - 4xx reply (greylisting, mailbox full, rate limit) -> `server_error`, nothing sent
 * - 5xx reply, rejected recipient, refused TLS, bad certificate, bad login -> `declined`
 *
 * SMTP has no idempotency key. The Message-ID is derived from `idempotencyKey`,
 * so a retried send carries the same Message-ID and receivers can collapse it.
 *
 * It never logs, and `detail` never carries the recipient, subject, body,
 * credentials or the relay's own reply text: only the SMTP code or error code.
 */

export const SMTP_TIMEOUT_MS = 10_000;

/** The slice of a nodemailer transport this driver uses; tests inject a fake. */
export interface SmtpTransport {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    messageId: string;
  }): Promise<{ messageId?: string; rejected?: readonly unknown[] }>;
}

export interface SmtpEmailConfig {
  readonly url: string;
  readonly from: string;
  /** Local dev only: no TLS at all. Refused unless `appEnv` is unset or `dev`. */
  readonly allowInsecure?: boolean;
  readonly appEnv?: string;
  readonly timeoutMs?: number;
  readonly transport?: SmtpTransport;
}

const DEFAULT_PORTS = { "smtp:": 587, "smtps:": 465 } as const;

export function smtpConfigFromEnv(env: Environment): SmtpEmailConfig {
  const url = env.EMAIL_SMTP_URL?.trim();
  const from = env.EMAIL_FROM?.trim();
  // Defence in depth: `resolveDriverMode` already refuses a live boot without these.
  if (url === undefined || url === "" || from === undefined || from === "") {
    throw new Error('EMAIL_DRIVER="live" with SMTP requires EMAIL_SMTP_URL and EMAIL_FROM.');
  }
  const appEnv = env.APP_ENV?.trim();
  return {
    url,
    from,
    allowInsecure: env.EMAIL_SMTP_ALLOW_INSECURE?.trim() === "true",
    ...(appEnv === undefined || appEnv === "" ? {} : { appEnv }),
  };
}

interface ConnectionOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  ignoreTLS: boolean;
  auth?: { user: string; pass: string };
}

/** Parses and validates the URL. Throws a message that never includes the URL (it may hold a password). */
export function parseSmtpUrl(config: SmtpEmailConfig): ConnectionOptions {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new Error(
      "EMAIL_SMTP_URL is not a valid URL (expected smtp://host:587 or smtps://host:465).",
    );
  }
  if (url.protocol !== "smtp:" && url.protocol !== "smtps:") {
    throw new Error(
      "EMAIL_SMTP_URL must start with smtp:// (STARTTLS) or smtps:// (implicit TLS).",
    );
  }
  if (url.hostname === "") {
    throw new Error("EMAIL_SMTP_URL has no host.");
  }
  const secure = url.protocol === "smtps:";

  if (config.allowInsecure === true) {
    if (config.appEnv !== undefined && config.appEnv !== "dev") {
      throw new Error(
        `EMAIL_SMTP_ALLOW_INSECURE=true is refused when APP_ENV is "${config.appEnv.slice(0, 40)}". ` +
          `Email carries sign-in and reset links and is never sent unencrypted outside local dev. ` +
          `Remove the flag, or point EMAIL_SMTP_URL at a relay that offers STARTTLS.`,
      );
    }
    if (secure) {
      throw new Error("EMAIL_SMTP_ALLOW_INSECURE=true only applies to smtp://, not smtps://.");
    }
  }

  const auth =
    url.username === ""
      ? undefined
      : { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) };
  const insecure = config.allowInsecure === true;
  return {
    host: url.hostname,
    port: url.port === "" ? DEFAULT_PORTS[url.protocol] : Number(url.port),
    secure,
    requireTLS: !secure && !insecure,
    ignoreTLS: insecure,
    ...(auth === undefined ? {} : { auth }),
  };
}

function failure(
  directive: "timeout" | "server_error" | "decline",
  detail: string,
  mayHaveSucceeded: boolean,
): BoundaryFailure {
  return { ...failureFor("email", directive), detail, mayHaveSucceeded };
}

interface NodemailerError {
  code?: unknown;
  responseCode?: unknown;
  command?: unknown;
  syscall?: unknown;
}

/** Maps a nodemailer error onto the shared vocabulary. Exported for the unit test. */
export function classifySmtpError(error: unknown): BoundaryFailure {
  const e = (typeof error === "object" && error !== null ? error : {}) as NodemailerError;
  const code = typeof e.code === "string" ? e.code.slice(0, 32) : "unknown";

  if (typeof e.responseCode === "number") {
    const reply = String(e.responseCode);
    return e.responseCode >= 500
      ? failure("decline", `The mail relay rejected the message (${reply}).`, false)
      : failure("server_error", `The mail relay deferred the message (${reply}).`, false);
  }
  if (code === "ETIMEDOUT") return failureFor("email", "timeout");
  // Configuration, not weather: retrying the same send cannot fix these.
  if (code === "ETLS") {
    return failure(
      "decline",
      "The mail relay does not offer STARTTLS; refusing to send unencrypted.",
      false,
    );
  }
  if (code === "EAUTH") {
    return failure("decline", "The mail relay rejected the login (EAUTH).", false);
  }
  // ESOCKET covers both a certificate that does not verify (no syscall) and an
  // ordinary socket failure (has one); only the latter can clear on its own.
  if (code === "ESOCKET" && typeof e.syscall !== "string") {
    return failure("decline", "The mail relay's TLS certificate did not verify.", false);
  }
  // Nothing was sent when the connection itself never opened.
  const neverConnected = e.command === "CONN";
  return failure(
    "server_error",
    `The request to the mail relay failed (${code}).`,
    !neverConnected,
  );
}

function messageIdFor(idempotencyKey: string, from: string): string {
  const domain = /@([^>\s]+)>?\s*$/.exec(from)?.[1] ?? "yourtal.invalid";
  const digest = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);
  return `<${digest}@${domain}>`;
}

export function createSmtpEmail(config: SmtpEmailConfig): EmailDriver {
  const timeout = config.timeoutMs ?? SMTP_TIMEOUT_MS;
  // Parse even with an injected transport, so the security refusals are always enforced.
  const connection = parseSmtpUrl(config);
  const transport: SmtpTransport =
    config.transport ??
    nodemailer.createTransport({
      ...connection,
      // Every one of these defaults to "wait forever".
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
      tls: { rejectUnauthorized: true },
    });

  return {
    mode: "live",

    async send(message: EmailMessage): Promise<Result<EmailSent, BoundaryFailure>> {
      try {
        const info = await transport.sendMail({
          from: config.from,
          to: message.to,
          subject: message.subject,
          text: message.body,
          messageId: messageIdFor(message.idempotencyKey, config.from),
        });
        if (info.rejected !== undefined && info.rejected.length > 0) {
          return err(failure("decline", "The mail relay rejected the recipient.", false));
        }
        return typeof info.messageId === "string" && info.messageId !== ""
          ? ok({ id: info.messageId, route: "live" })
          : err(
              failure(
                "server_error",
                "The mail relay accepted the message without a message id.",
                true,
              ),
            );
      } catch (error) {
        return err(classifySmtpError(error));
      }
    },
  };
}
