import type { IncomingMessage } from "node:http";
import type { FastifyInstance } from "fastify";
import { OIDC_PREFIX } from "@yourtal/contracts/oidc/protocol-routes";
import type { OidcRuntime } from "./oidc-runtime";

/** The methods the provider answers on; anything else is Fastify's 404. */
const METHODS = ["GET", "POST", "OPTIONS"] as const;

/**
 * Group 3.9: mounts the provider on the API's own Fastify instance at `/oidc`,
 * like the payment simulation, so Nest's guards, pipes and interceptors never
 * run on it: its routes are authenticated by the protocol itself. One
 * catch-all hands the untouched request to the provider, which reads its own
 * body; no other route may live under `/oidc` (mount-oidc.test.ts).
 * Returns whether it mounted.
 */
export async function mountOidc(fastify: FastifyInstance, runtime: OidcRuntime): Promise<boolean> {
  const provider = runtime.provider;
  if (provider === null) return false;
  const handle = provider.callback();

  await fastify.register((scope, _options, done) => {
    // Leave the body stream unread: the provider parses its own forms.
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", (_request, _payload, parsed) => {
      parsed(null);
    });
    scope.route({
      method: [...METHODS],
      url: `${OIDC_PREFIX}/*`,
      handler: (request, reply) => {
        reply.hijack();
        const raw: IncomingMessage & { originalUrl?: string } = request.raw;
        const full = raw.url ?? OIDC_PREFIX;
        // The provider routes on the path below its mount and rebuilds its own
        // URLs from originalUrl, as it does under Express or Koa's mount.
        raw.originalUrl = full;
        const below = full.slice(OIDC_PREFIX.length);
        raw.url = below.startsWith("/") ? below : `/${below}`;
        void handle(raw, reply.raw);
      },
    });
    done();
  });
  return true;
}
