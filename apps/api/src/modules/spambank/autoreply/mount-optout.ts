import { Logger } from "@nestjs/common";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { SPAMBANK_OPTOUT_PREFIX } from "@yourtal/contracts/spambank/staff";
import { canonicalOptoutDomain, isOptedOut, optOutDomain, verifyOptoutSig } from "./optout";

/**
 * The auto-reply's opt-out (BUILD.md §4.6 "Opt-out", §5.4), on the raw Fastify instance like the mail API:
 *
 * - `POST /api/spambank/optout/:domain/:sig` is the RFC 8058 one-click target named in `List-Unsubscribe`.
 *   Mailbox providers send `List-Unsubscribe=One-Click` as `application/x-www-form-urlencoded` (or
 *   multipart), which Nest's JSON pipeline would answer with 415, so this scope accepts any body and reads
 *   none of it: the signature in the path is the whole credential. `200 text/plain`.
 * - `GET` on the same path only reads (`{domain, optedOut}`) for the web page, so a link scanner opening the
 *   link changes nothing.
 *
 * A bad link is `404 invalid_link`, whichever part is wrong. Opting out is idempotent and forever.
 */

export interface OptoutContext {
  readonly pool: Pool;
  /** `SPAMBANK_OPTOUT_KEY`; unset answers 503 (no reply can have carried a link). */
  readonly optoutKey: string | undefined;
  readonly now?: () => Date;
}

const logger = new Logger("SpambankOptout");
const BODY_LIMIT = 8 * 1024;

type Params = { domain?: string; sig?: string };

function invalid(reply: FastifyReply): FastifyReply {
  return reply
    .code(404)
    .header("cache-control", "no-store")
    .send({ code: "invalid_link", message: "This opt-out link is not valid." });
}

/** The canonical domain of a good link, null for a bad one, `unavailable` without a key. */
function verified(
  ctx: OptoutContext,
  request: FastifyRequest,
): { readonly domain: string } | null | "unavailable" {
  if (ctx.optoutKey === undefined) return "unavailable";
  const params = request.params as Params;
  const domain = canonicalOptoutDomain(params.domain ?? "");
  if (domain === null) return null;
  return verifyOptoutSig(ctx.optoutKey, domain, params.sig ?? "") ? { domain } : null;
}

export async function mountSpambankOptout(
  fastify: FastifyInstance,
  ctx: OptoutContext,
): Promise<void> {
  await fastify.register((scope, _options, done) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { bodyLimit: BODY_LIMIT }, (_request, _payload, parsed) => {
      parsed(null);
    });
    scope.setErrorHandler((error, _request, reply) => {
      logger.error(`opt-out request failed: ${error instanceof Error ? error.message : "error"}`);
      if (reply.sent || reply.raw.headersSent) return;
      void reply
        .code(503)
        .send({ code: "spambank_unavailable", message: "Try again in a minute." });
    });

    const path = `${SPAMBANK_OPTOUT_PREFIX}/:domain/:sig`;

    scope.get(path, async (request, reply) => {
      const link = verified(ctx, request);
      if (link === "unavailable") {
        return reply.code(503).send({ code: "spambank_unavailable", message: "Not configured." });
      }
      if (link === null) return invalid(reply);
      const { domain } = link;
      return reply
        .header("cache-control", "no-store")
        .send({ domain, optedOut: await isOptedOut(ctx.pool, domain) });
    });

    scope.post(path, async (request, reply) => {
      const link = verified(ctx, request);
      if (link === "unavailable") {
        return reply.code(503).send({ code: "spambank_unavailable", message: "Not configured." });
      }
      if (link === null) return invalid(reply);
      const { domain } = link;
      await optOutDomain(ctx.pool, domain, (ctx.now ?? (() => new Date()))());
      logger.log(`auto-reply opt-out recorded for ${domain}`);
      return reply
        .code(200)
        .header("cache-control", "no-store")
        .type("text/plain; charset=utf-8")
        .send(`Done. Spambank will not send another automatic reply to ${domain}.\n`);
    });
    done();
  });
  logger.log(`auto-reply opt-out mounted at ${SPAMBANK_OPTOUT_PREFIX}`);
}
