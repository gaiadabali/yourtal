import { MAX_RECIPIENTS_PER_DAY } from "@yourtal/contracts/spambank/mail";
import type { MailPrincipal } from "../proxy/mail-auth";
import type { ProxyContext } from "../proxy/proxy-context";
import { logger } from "../proxy/http";
import { USING_SUBMISSION, callAs, isProblem, isRecord, roleIds, sessionOf } from "./account-jmap";

/**
 * The `mailto:` way to unsubscribe (spambank/BUILD.md §4.5 step 3): an RFC 6068 message sent from the
 * person's own mailbox through Stalwart. It counts toward the person's daily send cap like any mail.
 */

export interface MailtoMessage {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

const ADDRESS = /^[^\s@<>()",;:]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,63}$/i;
const MAX_FIELD = 500;

function clean(value: string | null, fallback: string): string {
  // One line for the subject; header injection is Stalwart's to refuse, but nothing gets that far.
  const text = (value ?? "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, MAX_FIELD);
  return text === "" ? fallback : text;
}

/** The first address of a `mailto:` URL, with its subject and body; undefined when unusable. */
export function parseMailto(raw: string): MailtoMessage | undefined {
  if (!/^mailto:/i.test(raw) || raw.length > 2048) return undefined;
  const rest = raw.slice("mailto:".length);
  const query = rest.indexOf("?");
  const addresses = query === -1 ? rest : rest.slice(0, query);
  const params = new URLSearchParams(query === -1 ? "" : rest.slice(query + 1));
  let first: string;
  try {
    first = decodeURIComponent(addresses.split(",")[0] ?? "").trim();
  } catch {
    return undefined;
  }
  if (!ADDRESS.test(first)) return undefined;
  const body = (params.get("body") ?? "").slice(0, MAX_FIELD).trim();
  return {
    to: first,
    subject: clean(params.get("subject"), "unsubscribe"),
    body: body === "" ? "unsubscribe" : body,
  };
}

/** Sends it; false when the cap is reached or Stalwart did not take it. */
export async function sendMailto(
  ctx: ProxyContext,
  principal: MailPrincipal,
  message: MailtoMessage,
): Promise<boolean> {
  const session = await sessionOf(ctx, principal);
  if (isProblem(session)) return false;
  const day = await ctx.store.reserveRecipients(principal.mailboxId, 1, MAX_RECIPIENTS_PER_DAY);
  if (day === undefined) return false;
  const giveBack = (): Promise<void> => ctx.store.releaseRecipients(principal.mailboxId, day, 1);
  const accountId = session.accountId;

  const lookup = await callAs(ctx, principal, USING_SUBMISSION, [
    ["Identity/get", { accountId, ids: null }, "i"],
    ["Mailbox/get", { accountId, ids: null, properties: ["id", "role"] }, "m"],
  ]);
  if (isProblem(lookup)) {
    await giveBack();
    return false;
  }
  const identities = lookup.get("i")?.list;
  const rows = Array.isArray(identities) ? identities.filter(isRecord) : [];
  const own = rows.find(
    (r) => typeof r.email === "string" && r.email.toLowerCase() === principal.address.toLowerCase(),
  );
  const identityId = (own ?? rows[0])?.id;
  const roles = roleIds(lookup.get("m"));
  const drafts = roles.get("drafts");
  const sent = roles.get("sent");
  if (typeof identityId !== "string" || drafts === undefined || sent === undefined) {
    await giveBack();
    logger.warn("mailto unsubscribe: the mailbox has no identity or no drafts/sent folder.");
    return false;
  }

  const result = await callAs(ctx, principal, USING_SUBMISSION, [
    [
      "Email/set",
      {
        accountId,
        create: {
          u: {
            mailboxIds: { [drafts]: true },
            keywords: { $draft: true, $seen: true },
            from: [{ email: principal.address }],
            to: [{ email: message.to }],
            subject: message.subject,
            bodyValues: { b: { value: message.body } },
            textBody: [{ partId: "b", type: "text/plain" }],
          },
        },
      },
      "e",
    ],
    [
      "EmailSubmission/set",
      {
        accountId,
        create: {
          s: {
            identityId,
            emailId: "#u",
            envelope: { mailFrom: { email: principal.address }, rcptTo: [{ email: message.to }] },
          },
        },
        onSuccessUpdateEmail: {
          "#s": {
            "keywords/$draft": null,
            [`mailboxIds/${drafts}`]: null,
            [`mailboxIds/${sent}`]: true,
          },
        },
      },
      "s",
    ],
  ]);
  const created = isProblem(result) ? undefined : result.get("s")?.created;
  if (!isRecord(created) || !isRecord(created.s)) {
    await giveBack();
    return false;
  }
  return true;
}
