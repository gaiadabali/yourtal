import type { FastifyReply, FastifyRequest } from "fastify";
import { unsubscribeRequestSchema } from "@yourtal/contracts/spambank/mail";
import { BodyTooLarge, readJson } from "../proxy/body";
import { sendProblem } from "../proxy/http";
import type { MailPrincipal } from "../proxy/mail-auth";
import type { ProxyContext } from "../proxy/proxy-context";
import { isProblem } from "./account-jmap";
import { safeHtmlFor } from "./safe-html-service";
import { summaryFor } from "./summary";
import { unsubscribe } from "./unsubscribe";

/** The helpers under `/api/spambank/mail` (spambank/BUILD.md §5.3). */

type Handler = (
  request: FastifyRequest,
  reply: FastifyReply,
  principal: MailPrincipal,
) => Promise<unknown>;

const UNSUBSCRIBE_BODY_LIMIT = 2048;

function emailIdOf(request: FastifyRequest): string {
  const params = request.params as { emailId?: unknown };
  return typeof params.emailId === "string" ? params.emailId : "";
}

export function mailHandlers(
  ctx: ProxyContext,
): Record<"summary" | "safeHtml" | "unsubscribe", Handler> {
  return {
    async summary(request, reply, principal) {
      const { locale } = request.query as { locale?: unknown };
      return reply
        .header("cache-control", "no-store")
        .send(await summaryFor(ctx, principal, locale));
    },

    async safeHtml(request, reply, principal) {
      const result = await safeHtmlFor(ctx, principal, emailIdOf(request));
      if (isProblem(result)) return sendProblem(reply, result);
      return reply.header("cache-control", "private, no-store").send(result);
    },

    async unsubscribe(request, reply, principal) {
      let body: unknown;
      try {
        body = await readJson(request.raw, UNSUBSCRIBE_BODY_LIMIT);
      } catch (error) {
        if (error instanceof BodyTooLarge) {
          return sendProblem(reply, {
            status: 413,
            code: "payload_too_large",
            message: "Body too large.",
          });
        }
        throw error;
      }
      const parsed = unsubscribeRequestSchema.safeParse(body ?? {});
      if (!parsed.success) {
        return sendProblem(reply, {
          status: 400,
          code: "invalid_request",
          message: "Body is { moveToJunk?: boolean }.",
        });
      }
      const result = await unsubscribe(
        ctx,
        principal,
        emailIdOf(request),
        parsed.data.moveToJunk === true,
      );
      if (isProblem(result)) return sendProblem(reply, result);
      return reply.header("cache-control", "no-store").send(result);
    },
  };
}
