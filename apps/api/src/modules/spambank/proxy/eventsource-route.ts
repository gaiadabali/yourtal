import type { FastifyRequest } from "fastify";
import { STREAM_LIFETIME_MS } from "./event-streams";
import { clientIp, logger, problemForFailure, sendProblem } from "./http";
import type { Problem } from "./http";
import { NOT_FOUND, UNAVAILABLE, isProblem, sessionFor, toNode } from "./jmap-routes";
import type { Handler } from "./jmap-routes";
import type { MailPrincipal } from "./mail-auth";
import type { ProxyContext } from "./proxy-context";
import { expandTemplate, upstreamPath } from "./upstream-session";

/**
 * `GET /api/spambank/jmap/eventsource` (spambank/BUILD.md §5.3, §4.3): Stalwart's EventSource for the
 * token's mailbox, streamed through unbuffered. At most 3 per mailbox, each closed after 25 minutes
 * (the engine reconnects with a fresh token); closing either side tears down the other.
 */

const STATE_TYPES: ReadonlySet<string> = new Set([
  "*",
  "Email",
  "Mailbox",
  "Thread",
  "EmailSubmission",
  "EmailDelivery",
  "Identity",
  "Quota",
]);

/** Opens Stalwart's EventSource as the mailbox; a Problem when it cannot. */
async function openEvents(
  ctx: ProxyContext,
  request: FastifyRequest,
  principal: MailPrincipal,
  query: Readonly<Record<"types" | "closeafter" | "ping", string>>,
  signal: AbortSignal,
): Promise<Response | Problem> {
  const session = await sessionFor(ctx, principal, request);
  if (isProblem(session)) return session;
  const path = upstreamPath(expandTemplate(session.eventSourceUrl, query));
  if (path === undefined) return NOT_FOUND;
  const account = ctx.driver.account(principal.localPart, principal.domain);
  const upstream = await account.fetch(path, {
    headers: { accept: "text/event-stream" },
    clientIp: clientIp(request),
    timeoutMs: 0,
    signal,
  });
  if (upstream.isErr()) return problemForFailure(upstream.error);
  const res = upstream.value;
  if (res.status !== 200 || res.body === null) {
    await res.body?.cancel();
    logger.warn(`Stalwart's EventSource answered ${String(res.status)}.`);
    return UNAVAILABLE;
  }
  return res;
}

export function eventSourceHandler(ctx: ProxyContext): Handler {
  return async (request, reply, principal) => {
    const query = request.query as Record<string, unknown>;
    const types =
      typeof query.types === "string" && query.types !== "" ? query.types : "Email,Mailbox";
    if (!types.split(",").every((t) => STATE_TYPES.has(t))) {
      return sendProblem(reply, {
        status: 400,
        code: "invalid_request",
        message: "Unknown types.",
      });
    }
    const closeafter = query.closeafter === "state" ? "state" : "no";
    // A ping at least every minute keeps nginx (read timeout 120 s) from cutting a quiet stream.
    const asked = typeof query.ping === "string" ? Number.parseInt(query.ping, 10) : 30;
    const ping = String(
      Number.isFinite(asked) && asked > 0 ? Math.min(Math.max(asked, 15), 60) : 30,
    );

    const slot = ctx.streams.open(principal.mailboxId);
    if (slot === undefined) {
      return sendProblem(reply, {
        status: 429,
        code: "too_many_streams",
        message: "At most 3 open streams.",
      });
    }
    const abort = new AbortController();
    const lifetime: { timer?: NodeJS.Timeout } = {};
    const finish = (): void => {
      if (lifetime.timer !== undefined) clearTimeout(lifetime.timer);
      abort.abort();
      slot.release();
    };
    const opened = await openEvents(
      ctx,
      request,
      principal,
      { types, closeafter, ping },
      abort.signal,
    ).catch((error: unknown) => {
      finish();
      throw error;
    });
    if (!(opened instanceof Response) || opened.body === null) {
      finish();
      return sendProblem(reply, opened instanceof Response ? UNAVAILABLE : opened);
    }
    reply.hijack();
    const raw = reply.raw;
    // A hijacked reply sends nothing Fastify queued, so the CORS headers are copied over.
    const queued: Record<string, string> = {};
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (typeof value === "string") queued[name] = value;
    }
    raw.writeHead(200, {
      ...queued,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    });
    raw.flushHeaders();
    const end = (): void => {
      finish();
      raw.end();
    };
    raw.on("close", finish);
    lifetime.timer = setTimeout(end, ctx.streamLifetimeMs ?? STREAM_LIFETIME_MS);
    const stream = toNode(opened.body);
    stream.on("error", end);
    stream.on("end", end);
    stream.pipe(raw, { end: false });
    return reply;
  };
}
