import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import { MAX_RECIPIENTS_PER_DAY } from "@yourtal/contracts/spambank/mail";
import { BodyTooLarge, declaredLength, limitStream, readJson } from "./body";
import { clientIp, problemForFailure, problemForSession, sendProblem } from "./http";
import type { Problem } from "./http";
import { filterJmapRequest, unsentRecipients } from "./jmap-filter";
import type { MailPrincipal } from "./mail-auth";
import type { ProxyContext } from "./proxy-context";
import { expandTemplate, rewriteSession, upstreamPath } from "./upstream-session";
import type { UpstreamSession } from "./upstream-session";

/**
 * The JMAP passthrough (spambank/BUILD.md §5.3): session, api, upload and download (the EventSource is eventsource-route.ts),
 * each sent to Stalwart as the token's own mailbox through the driver's account client (which sets
 * the Basic credential and `X-Forwarded-For`, and never forwards the client's own headers).
 */

export const API_BODY_LIMIT = 2 * 1024 * 1024;
export const UPLOAD_LIMIT = 25 * 1024 * 1024;
const TRANSFER_TIMEOUT_MS = 5 * 60_000;
/** JMAP `Id` (RFC 8620 §1.2). */
const JMAP_ID = /^[A-Za-z0-9_-]{1,255}$/;
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i;
/** Types a browser would render or run in our origin: always served as bytes. */
const ACTIVE_TYPE = /html|xml|javascript|ecmascript|^multipart\//i;
export const NOT_FOUND: Problem = { status: 404, code: "not_found", message: "Not found." };
export const UNAVAILABLE: Problem = {
  status: 503,
  code: "spambank_unavailable",
  message: "The mail server is not answering.",
};

export type Handler = (
  request: FastifyRequest,
  reply: FastifyReply,
  principal: MailPrincipal,
) => Promise<unknown>;

export async function sessionFor(
  ctx: ProxyContext,
  principal: MailPrincipal,
  request: FastifyRequest,
): Promise<UpstreamSession | Problem> {
  const account = ctx.driver.account(principal.localPart, principal.domain);
  const result = await ctx.sessions.get(principal.mailboxId, account, clientIp(request));
  return result.isOk() ? result.value : problemForSession(result.error);
}

export function isProblem(value: UpstreamSession | Problem): value is Problem {
  return "code" in value;
}

function mediaType(value: unknown, fallback = "application/octet-stream"): string {
  return typeof value === "string" && MEDIA_TYPE.test(value) ? value.toLowerCase() : fallback;
}

/** `Content-Disposition: attachment` with a safe ASCII name and the RFC 5987 UTF-8 one. */
export function attachmentDisposition(name: string): string {
  const clean = name.replace(/[\r\n"\\/]/g, "_").slice(0, 200) || "attachment";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

export function toNode(body: ReadableStream<Uint8Array>): Readable {
  // The DOM and node:stream/web stream types differ only on paper.
  return Readable.fromWeb(body);
}

export function jmapHandlers(
  ctx: ProxyContext,
): Record<"session" | "api" | "upload" | "download", Handler> {
  return {
    async session(request, reply, principal) {
      const session = await sessionFor(ctx, principal, request);
      if (isProblem(session)) return sendProblem(reply, session);
      return reply
        .header("cache-control", "no-store")
        .send(rewriteSession(session, ctx.publicOrigin));
    },

    async api(request, reply, principal) {
      let body: unknown;
      try {
        body = await readJson(request.raw, API_BODY_LIMIT);
      } catch (error) {
        if (error instanceof BodyTooLarge) {
          return sendProblem(reply, {
            status: 413,
            code: "payload_too_large",
            message: "At most 2 MB.",
          });
        }
        throw error;
      }
      const session = await sessionFor(ctx, principal, request);
      if (isProblem(session)) return sendProblem(reply, session);
      const filtered = filterJmapRequest(body, {
        accountId: session.accountId,
        address: principal.address,
      });
      if (!filtered.ok) return sendProblem(reply, filtered);

      let day: string | undefined;
      if (filtered.recipients > 0) {
        day = await ctx.store.reserveRecipients(
          principal.mailboxId,
          filtered.recipients,
          MAX_RECIPIENTS_PER_DAY,
        );
        if (day === undefined) {
          return sendProblem(reply, {
            status: 429,
            code: "daily_send_cap",
            message: `At most ${String(MAX_RECIPIENTS_PER_DAY)} recipients a day.`,
          });
        }
      }
      const giveBack = async (count: number): Promise<void> => {
        if (day !== undefined && count > 0)
          await ctx.store.releaseRecipients(principal.mailboxId, day, count);
      };

      const path = upstreamPath(session.apiUrl);
      const account = ctx.driver.account(principal.localPart, principal.domain);
      const upstream =
        path === undefined
          ? undefined
          : await account.fetch(path, {
              method: "POST",
              headers: { "content-type": "application/json", accept: "application/json" },
              body: JSON.stringify(filtered.body),
              clientIp: clientIp(request),
            });
      if (upstream === undefined || upstream.isErr()) {
        await giveBack(filtered.recipients);
        return sendProblem(
          reply,
          upstream === undefined ? NOT_FOUND : problemForFailure(upstream.error),
        );
      }
      const res = upstream.value;
      const text = await res.text();
      if (filtered.submissions.length > 0) {
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        await giveBack(res.ok ? unsentRecipients(filtered.submissions, json) : filtered.recipients);
      }
      return reply
        .code(res.status)
        .header("cache-control", "no-store")
        .type(res.headers.get("content-type") ?? "application/json")
        .send(text);
    },

    async upload(request, reply, principal) {
      const declared = declaredLength(request.raw);
      if (declared !== undefined && declared > UPLOAD_LIMIT) {
        return sendProblem(reply, {
          status: 413,
          code: "payload_too_large",
          message: "At most 25 MB.",
        });
      }
      const session = await sessionFor(ctx, principal, request);
      if (isProblem(session)) return sendProblem(reply, session);
      const { accountId } = request.params as { accountId?: string };
      if (accountId !== session.accountId) return sendProblem(reply, NOT_FOUND);
      const path = upstreamPath(expandTemplate(session.uploadUrl, { accountId }));
      if (path === undefined) return sendProblem(reply, NOT_FOUND);
      const limit = { exceeded: false };
      const body = (
        Readable.toWeb(request.raw) as unknown as ReadableStream<Uint8Array>
      ).pipeThrough(
        limitStream(UPLOAD_LIMIT, () => {
          limit.exceeded = true;
        }),
      );
      const account = ctx.driver.account(principal.localPart, principal.domain);
      const upstream = await account.fetch(path, {
        method: "POST",
        headers: {
          "content-type": mediaType(request.headers["content-type"]?.split(";")[0]?.trim()),
        },
        body,
        clientIp: clientIp(request),
        timeoutMs: 0,
        signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
      });
      if (limit.exceeded) {
        if (upstream.isOk()) await upstream.value.body?.cancel();
        return sendProblem(reply, {
          status: 413,
          code: "payload_too_large",
          message: "At most 25 MB.",
        });
      }
      if (upstream.isErr()) return sendProblem(reply, problemForFailure(upstream.error));
      const res = upstream.value;
      return reply
        .code(res.status)
        .header("cache-control", "no-store")
        .type(res.headers.get("content-type") ?? "application/json")
        .send(await res.text());
    },

    async download(request, reply, principal) {
      const { accountId, blobId, name } = request.params as Record<string, string | undefined>;
      if (blobId === undefined || !JMAP_ID.test(blobId) || name === undefined) {
        return sendProblem(reply, NOT_FOUND);
      }
      const session = await sessionFor(ctx, principal, request);
      if (isProblem(session)) return sendProblem(reply, session);
      // Another mailbox's account id never reaches Stalwart.
      if (accountId !== session.accountId) return sendProblem(reply, NOT_FOUND);
      const { accept } = request.query as { accept?: unknown };
      const type = mediaType(accept);
      const path = upstreamPath(
        expandTemplate(session.downloadUrl, { accountId, blobId, name, type }),
      );
      if (path === undefined) return sendProblem(reply, NOT_FOUND);
      const account = ctx.driver.account(principal.localPart, principal.domain);
      const upstream = await account.fetch(path, {
        headers: { accept: "*/*" },
        clientIp: clientIp(request),
        timeoutMs: 0,
        signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
      });
      if (upstream.isErr()) return sendProblem(reply, problemForFailure(upstream.error));
      const res = upstream.value;
      if (res.status !== 200 || res.body === null) {
        await res.body?.cancel();
        return sendProblem(
          reply,
          res.status === 404 || res.status === 403 ? NOT_FOUND : UNAVAILABLE,
        );
      }
      const served = res.headers.get("content-type")?.split(";")[0]?.trim() ?? type;
      reply
        .header(
          "content-type",
          ACTIVE_TYPE.test(served) ? "application/octet-stream" : mediaType(served),
        )
        .header("content-disposition", attachmentDisposition(name))
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "private, no-store");
      const length = res.headers.get("content-length");
      if (length !== null && /^\d+$/.test(length)) reply.header("content-length", length);
      return reply.send(toNode(res.body));
    },
  };
}
