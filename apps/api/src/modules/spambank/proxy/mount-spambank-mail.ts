import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { SPAMBANK_JMAP_PREFIX, SPAMBANK_MAIL_PREFIX } from "@yourtal/contracts/spambank/mail";
import { mailHandlers } from "../mail/mail-routes";
import { corsHeaders, logger, sendProblem } from "./http";
import { eventSourceHandler } from "./eventsource-route";
import { jmapHandlers } from "./jmap-routes";
import type { MailPrincipal } from "./mail-auth";
import type { ProxyContext } from "./proxy-context";
import type { MailBucket } from "./rate-limits";

/**
 * Mounts Spambank's mail API (spambank/BUILD.md §5.3) on the API's own Fastify instance, like
 * `/oidc` and the payment simulation: Nest's guards, pipes and body parsing never run here. Every
 * route checks the mail token itself, then the per-mailbox rate limit, and only then does anything.
 * Bodies are left unread by the scope so uploads stream; each route reads its own with its own limit.
 */

type Handler = (
  request: FastifyRequest,
  reply: FastifyReply,
  principal: MailPrincipal,
) => Promise<unknown>;

/** The `accountId/blobId/name` after the download prefix, decoded; Fastify's 100-character param limit is too short for names. */
export function downloadParams(url: string): Record<string, string> | undefined {
  const prefix = `${SPAMBANK_JMAP_PREFIX}/download/`;
  const path = url.split("?")[0] ?? "";
  if (!path.startsWith(prefix)) return undefined;
  const parts = path.slice(prefix.length).split("/");
  if (parts.length !== 3) return undefined;
  try {
    const [accountId = "", blobId = "", name = ""] = parts.map((p) => decodeURIComponent(p));
    return accountId !== "" && blobId !== "" && name !== ""
      ? { accountId, blobId, name }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function mountSpambankMail(
  fastify: FastifyInstance,
  ctx: ProxyContext,
): Promise<void> {
  const jmap = jmapHandlers(ctx);
  const mail = mailHandlers(ctx);

  function guarded(bucket: MailBucket, handler: Handler) {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      const auth = await ctx.auth.authenticate(request.headers.authorization);
      if (!auth.ok) return sendProblem(reply, auth);
      if (!(await ctx.limiter.allow(bucket, auth.principal.mailboxId, request.ip))) {
        return sendProblem(reply, {
          status: 429,
          code: "rate_limited",
          message: "Too many requests; try again soon.",
        });
      }
      return handler(request, reply, auth.principal);
    };
  }

  await fastify.register((scope, _options, done) => {
    // Bodies stay unread: uploads stream to Stalwart, the JSON routes read theirs with a limit.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", (_request, _payload, parsed) => {
      parsed(null);
    });
    scope.addHook("onRequest", async (request, reply) => {
      reply.headers(
        corsHeaders(request.headers.origin, ctx.config.corsOrigins, request.method === "OPTIONS"),
      );
    });
    scope.setErrorHandler((error, _request, reply) => {
      logger.error(`mail API request failed: ${error instanceof Error ? error.message : "error"}`);
      if (reply.sent || reply.raw.headersSent) return;
      void sendProblem(reply, {
        status: 503,
        code: "spambank_unavailable",
        message: "Mail is not available right now.",
      });
    });

    for (const prefix of [SPAMBANK_JMAP_PREFIX, SPAMBANK_MAIL_PREFIX]) {
      scope.options(`${prefix}/*`, async (_request, reply) => reply.code(204).send());
    }

    scope.get(`${SPAMBANK_JMAP_PREFIX}/session`, guarded("api", jmap.session));
    scope.post(`${SPAMBANK_JMAP_PREFIX}/api`, guarded("api", jmap.api));
    for (const path of ["/upload/:accountId", "/upload/:accountId/"]) {
      scope.post(`${SPAMBANK_JMAP_PREFIX}${path}`, guarded("upload", jmap.upload));
    }
    scope.get(
      `${SPAMBANK_JMAP_PREFIX}/download/*`,
      guarded("api", async (request, reply, principal) => {
        const params = downloadParams(request.raw.url ?? "");
        if (params === undefined)
          return sendProblem(reply, { status: 404, code: "not_found", message: "Not found." });
        request.params = params;
        return jmap.download(request, reply, principal);
      }),
    );
    scope.get(`${SPAMBANK_JMAP_PREFIX}/eventsource`, guarded("api", eventSourceHandler(ctx)));

    scope.get(`${SPAMBANK_MAIL_PREFIX}/summary`, guarded("api", mail.summary));
    scope.get(
      `${SPAMBANK_MAIL_PREFIX}/messages/:emailId/safe-html`,
      guarded("safe_html", mail.safeHtml),
    );
    scope.post(
      `${SPAMBANK_MAIL_PREFIX}/messages/:emailId/unsubscribe`,
      guarded("unsubscribe", mail.unsubscribe),
    );
    done();
  });
  logger.log(`mail API mounted at ${SPAMBANK_JMAP_PREFIX} and ${SPAMBANK_MAIL_PREFIX}`);
}
