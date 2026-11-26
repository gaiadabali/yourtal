import type { JmapMethodCall } from "@yourtal/drivers/spambank";
import { problemForFailure, problemForSession } from "../proxy/http";
import type { Problem } from "../proxy/http";
import type { MailPrincipal } from "../proxy/mail-auth";
import type { ProxyContext } from "../proxy/proxy-context";
import type { UpstreamSession } from "../proxy/upstream-session";

/** The helpers' own JMAP calls, made as the token's mailbox (spambank/BUILD.md §4.4, §4.5, §4.13). */

export const USING_MAIL = ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"];
export const USING_SUBMISSION = [...USING_MAIL, "urn:ietf:params:jmap:submission"];
/** JMAP `Id` (RFC 8620 §1.2). */
export const JMAP_ID = /^[A-Za-z0-9_-]{1,255}$/;

export const NOT_FOUND: Problem = { status: 404, code: "not_found", message: "No such message." };
export const UNAVAILABLE: Problem = {
  status: 503,
  code: "spambank_unavailable",
  message: "The mail server is not answering.",
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function sessionOf(
  ctx: ProxyContext,
  principal: MailPrincipal,
): Promise<UpstreamSession | Problem> {
  const result = await ctx.sessions.get(
    principal.mailboxId,
    ctx.driver.account(principal.localPart, principal.domain),
  );
  return result.isOk() ? result.value : problemForSession(result.error);
}

export function isProblem(value: unknown): value is Problem {
  return isRecord(value) && typeof value.code === "string" && typeof value.status === "number";
}

/**
 * Runs the calls and returns each call id's result arguments. A method-level error, or a missing
 * answer, is `UNAVAILABLE`: none of these calls should fail for a healthy mailbox.
 */
export async function callAs(
  ctx: ProxyContext,
  principal: MailPrincipal,
  using: readonly string[],
  calls: readonly JmapMethodCall[],
): Promise<Map<string, Record<string, unknown>> | Problem> {
  const account = ctx.driver.account(principal.localPart, principal.domain);
  const result = await account.jmap({ using, methodCalls: calls });
  if (result.isErr()) return problemForFailure(result.error);
  const out = new Map<string, Record<string, unknown>>();
  for (const [name, args, callId] of result.value.methodResponses) {
    if (name === "error") return UNAVAILABLE;
    // The first answer under a call id is the method's own (an implicit Email/set may follow).
    if (!out.has(callId)) out.set(callId, args);
  }
  for (const [, , callId] of calls) if (!out.has(callId)) return UNAVAILABLE;
  return out;
}

/** The ids of the mailbox's role mailboxes (`inbox`, `junk`, `sent`, `drafts`, ...). */
export function roleIds(mailboxGet: Record<string, unknown> | undefined): Map<string, string> {
  const roles = new Map<string, string>();
  const list = mailboxGet?.list;
  if (!Array.isArray(list)) return roles;
  for (const entry of list) {
    if (isRecord(entry) && typeof entry.role === "string" && typeof entry.id === "string") {
      roles.set(entry.role, entry.id);
    }
  }
  return roles;
}
