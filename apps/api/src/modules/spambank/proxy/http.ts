import { Logger } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { SpambankFailure } from "@yourtal/drivers/spambank";
import type { MailApiErrorCode } from "@yourtal/contracts/spambank/mail";
import type { SessionFailure } from "./upstream-session";

/** Replies, CORS and failure mapping shared by the mail API's routes (spambank/BUILD.md §4.3, §5). */

export const logger = new Logger("SpambankProxy");

export interface Problem {
  readonly status: number;
  readonly code: MailApiErrorCode;
  readonly message: string;
}

export function sendProblem(reply: FastifyReply, problem: Problem): FastifyReply {
  return reply
    .code(problem.status)
    .header("cache-control", "no-store")
    .type("application/json; charset=utf-8")
    .send({ code: problem.code, message: problem.message });
}

/** A driver failure as the client sees it. Our own credential failing is logged: it is a bug or a misconfiguration. */
export function problemForFailure(failure: SpambankFailure): Problem {
  switch (failure.code) {
    case "upstream_auth":
      logger.error(
        "Stalwart refused a mailbox's derived credential (check SPAMBANK_CREDENTIAL_KEY).",
      );
      return {
        status: 502,
        code: "upstream_auth",
        message: "The mail server refused the service.",
      };
    case "simulated":
      return {
        status: 503,
        code: "spambank_unavailable",
        message: "simulated: there is no mail server here.",
      };
    default:
      return {
        status: 503,
        code: "spambank_unavailable",
        message: "The mail server is not answering.",
      };
  }
}

export function problemForSession(failure: SessionFailure): Problem {
  if (failure.kind === "driver") return problemForFailure(failure.failure);
  logger.warn(
    failure.kind === "status"
      ? `Stalwart's session answered ${String(failure.status)}.`
      : "Stalwart's session was not readable.",
  );
  return {
    status: 503,
    code: "spambank_unavailable",
    message: "The mail server is not answering.",
  };
}

/** The client's address as Fastify resolved it (trusting only loopback proxies). */
export function clientIp(request: FastifyRequest): string {
  return request.ip;
}

const CORS_METHODS = "GET, POST, OPTIONS";
const CORS_HEADERS = "Authorization, Content-Type";

/**
 * §4.3 CORS: an origin on the list is echoed back, nothing else is; never with credentials, because
 * the token in the header is the only authentication. Returns the headers to set.
 */
export function corsHeaders(
  origin: string | undefined,
  allowed: readonly string[],
  preflight: boolean,
): Record<string, string> {
  const headers: Record<string, string> = { vary: "Origin" };
  if (origin === undefined || !allowed.includes(origin)) return headers;
  headers["access-control-allow-origin"] = origin;
  if (preflight) {
    headers["access-control-allow-methods"] = CORS_METHODS;
    headers["access-control-allow-headers"] = CORS_HEADERS;
    headers["access-control-max-age"] = "600";
  }
  return headers;
}
