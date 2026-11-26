import type { UnsubscribeResult } from "@yourtal/contracts/spambank/mail";
import { logger } from "../proxy/http";
import type { Problem } from "../proxy/http";
import type { MailPrincipal } from "../proxy/mail-auth";
import type { UnsubscribeRecord } from "../proxy/mail-store";
import type { ProxyContext } from "../proxy/proxy-context";
import {
  JMAP_ID,
  NOT_FOUND,
  USING_MAIL,
  callAs,
  isProblem,
  isRecord,
  sessionOf,
} from "./account-jmap";
import { parseMailto, sendMailto } from "./mailto";

/**
 * One-tap unsubscribe, the person's own (spambank/BUILD.md §4.5): RFC 8058 one-click when the
 * marketer offers it, else a `mailto:` from the person's mailbox, else the https page for the person
 * to open. A message already unsubscribed by one-click is not posted again (a double tap, or a
 * retried request).
 */

export const UNSUBSCRIBED_KEYWORD = "$spambank_unsubscribed";
const ONE_CLICK_VALUE = "list-unsubscribe=one-click";

/** The marketer's domain for the counter: the From address's, else the unsubscribe link's host. */
export function orgDomainOf(from: unknown, urls: readonly string[]): string {
  if (Array.isArray(from) && isRecord(from[0]) && typeof from[0].email === "string") {
    const at = from[0].email.lastIndexOf("@");
    if (at !== -1)
      return from[0].email
        .slice(at + 1)
        .toLowerCase()
        .slice(0, 253);
  }
  for (const url of urls) {
    try {
      const host = new URL(url).hostname;
      if (host !== "") return host.toLowerCase();
    } catch {
      // try the next one
    }
  }
  return "unknown";
}

export async function unsubscribe(
  ctx: ProxyContext,
  principal: MailPrincipal,
  emailId: string,
  moveToJunk: boolean,
): Promise<UnsubscribeResult | Problem> {
  if (!JMAP_ID.test(emailId)) return NOT_FOUND;
  const session = await sessionOf(ctx, principal);
  if (isProblem(session)) return session;
  const accountId = session.accountId;
  const answers = await callAs(ctx, principal, USING_MAIL, [
    [
      "Email/get",
      {
        accountId,
        ids: [emailId],
        properties: [
          "id",
          "keywords",
          "from",
          "header:List-Unsubscribe:asURLs",
          "header:List-Unsubscribe-Post:asText",
        ],
      },
      "g",
    ],
  ]);
  if (isProblem(answers)) return answers;
  const list = answers.get("g")?.list;
  const email: unknown = Array.isArray(list)
    ? list.find((e: unknown) => isRecord(e) && e.id === emailId)
    : undefined;
  if (!isRecord(email)) return NOT_FOUND;

  const header = email["header:List-Unsubscribe:asURLs"];
  const urls = Array.isArray(header)
    ? header.filter((u): u is string => typeof u === "string")
    : [];
  const post = email["header:List-Unsubscribe-Post:asText"];
  const oneClickOffered =
    typeof post === "string" && post.replace(/\s+/g, "").toLowerCase() === ONE_CLICK_VALUE;
  const https = urls.find((u) => /^https:\/\//i.test(u));
  const mailto = urls.map(parseMailto).find((m) => m !== undefined);
  const already = isRecord(email.keywords) && email.keywords[UNSUBSCRIBED_KEYWORD] === true;
  const orgDomain = orgDomainOf(email.from, urls);
  const record = (row: Omit<UnsubscribeRecord, "mailboxId" | "orgDomain">): Promise<void> =>
    ctx.store.recordUnsubscribe({ mailboxId: principal.mailboxId, orgDomain, ...row });

  let result: UnsubscribeResult | undefined;
  if (https !== undefined && oneClickOffered) {
    if (already) {
      result = { status: "done", method: "one_click" };
    } else {
      const posted = await ctx.oneClick(https);
      await record({
        method: "one_click",
        status: posted.ok ? "done" : "failed",
        httpStatus: posted.status,
      });
      if (posted.ok) result = { status: "done", method: "one_click" };
    }
  }
  if (result === undefined && mailto !== undefined) {
    const sent = await sendMailto(ctx, principal, mailto);
    await record({ method: "mailto", status: sent ? "done" : "failed", httpStatus: null });
    if (sent) result = { status: "done", method: "mailto" };
  }
  if (result === undefined && https !== undefined && !oneClickOffered) {
    await record({ method: "link", status: "opened", httpStatus: null });
    result = { status: "open_link", method: "link", url: https };
  }
  if (result === undefined) {
    return urls.length === 0 || (https === undefined && mailto === undefined)
      ? { status: "unavailable" }
      : { status: "failed" };
  }

  const patch: Record<string, unknown> = { [`keywords/${UNSUBSCRIBED_KEYWORD}`]: true };
  if (moveToJunk && principal.junkMailboxId !== null)
    patch.mailboxIds = { [principal.junkMailboxId]: true };
  const marked = await callAs(ctx, principal, USING_MAIL, [
    ["Email/set", { accountId, update: { [emailId]: patch } }, "u"],
  ]);
  const notUpdated = isProblem(marked) ? undefined : marked.get("u")?.notUpdated;
  if (isProblem(marked) || isRecord(notUpdated)) {
    logger.warn("unsubscribe: could not mark or move the message.");
  }
  return result;
}
