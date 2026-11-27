import { orgDomainOf, splitAddress } from "../classify/org-domain";

/**
 * What arrived at the reply domain's system addresses (BUILD.md §4.6 "Bounces and complaints"), read from
 * the raw message. No I/O.
 *
 * - `complaint`: an ARF report (`multipart/report; report-type=feedback-report`), from a mailbox provider's
 *   feedback loop or a person's "report spam".
 * - `bounce`: a delivery-status report saying `Action: failed` that names one of our replies by its
 *   Message-ID, or a non-standard bounce (null sender or a mailer-daemon From) that names one and says it
 *   failed. A bounce that names none of ours is not counted: it cannot be ours, and counting it would let
 *   anyone pause the replies with forged DSNs.
 * - `ignored`: delays, successes, out-of-office and other automatic mail.
 * - `answer`: anything else, i.e. a person writing back; the sender's domain is opted out.
 */

export type ReplyKind = "bounce" | "complaint" | "answer" | "ignored";

export interface ReplyReport {
  readonly kind: ReplyKind;
  /** The `spambank.autoreply.id` the message names, if any. */
  readonly autoreplyId: string | null;
  /** The top-level From address, lower-cased domain. */
  readonly fromAddress: string | null;
  readonly fromOrgDomain: string | null;
  /** Why, for the log. */
  readonly detail: string;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Parsed {
  readonly headers: readonly (readonly [string, string])[];
  readonly body: string;
}

/** Top-level header fields (unfolded, names lower-cased) and the rest. */
export function parseTopLevel(raw: string): Parsed {
  const split = /\r?\n\r?\n/.exec(raw);
  const head = split === null ? raw : raw.slice(0, split.index);
  const body = split === null ? "" : raw.slice(split.index + split[0].length);
  const headers: [string, string][] = [];
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return { headers, body };
}

function header(parsed: Parsed, name: string): string | undefined {
  return parsed.headers.find(([n]) => n === name)?.[1];
}

function all(parsed: Parsed, name: string): string[] {
  return parsed.headers.filter(([n]) => n === name).map(([, v]) => v);
}

/** The `report-type` parameter of a `multipart/report` Content-Type, lower-cased; null otherwise. */
export function reportType(contentType: string | undefined): string | null {
  if (contentType === undefined) return null;
  if (!/^\s*multipart\/report\b/i.test(contentType)) return null;
  const match = /report-type\s*=\s*"?([A-Za-z0-9._-]+)"?/i.exec(contentType);
  return match?.[1]?.toLowerCase() ?? "";
}

function addressIn(value: string | undefined): string | null {
  if (value === undefined) return null;
  const bracketed = /<([^<>\s]+@[^<>\s]+)>/.exec(value);
  const bare = /([^\s<>"(),;:]+@[^\s<>"(),;:]+)/.exec(value);
  const found = bracketed?.[1] ?? bare?.[1];
  if (found === undefined) return null;
  const split = splitAddress(found);
  return split === null ? null : `${split.local}@${split.domain}`;
}

function isAutomatic(parsed: Parsed): string | null {
  const auto = all(parsed, "auto-submitted").map((v) => v.toLowerCase());
  if (auto.some((v) => !/^no\b/.test(v))) return "auto_submitted";
  if (all(parsed, "x-autoreply").length > 0 || all(parsed, "x-autorespond").length > 0) {
    return "x_autoreply";
  }
  const precedence = all(parsed, "precedence").map((v) => v.toLowerCase());
  if (precedence.some((v) => /^(bulk|junk|list|auto_reply)\b/.test(v))) return "precedence";
  if (all(parsed, "return-path").some((v) => v.replace(/\s+/g, "") === "<>")) return "null_sender";
  if (all(parsed, "list-id").length > 0 || all(parsed, "list-unsubscribe").length > 0) {
    return "list_mail";
  }
  return null;
}

const DAEMON = /^(mailer-daemon|postmaster|mail-daemon|mailerdaemon)$/i;
const FAILED_WORDS =
  /(undeliver|delivery (status notification )?\(?fail|delivery has failed|returned mail|mail delivery failed|could not be delivered|rejected|permanent(ly)? (error|failure))/i;

export function classifyReplyMessage(raw: string, replyDomain: string): ReplyReport {
  const parsed = parseTopLevel(raw);
  const ours = new RegExp(`autoreply-(${UUID})@${escapeRegExp(replyDomain)}`, "i");
  const fromAddress = addressIn(header(parsed, "from"));
  const fromLocal = fromAddress === null ? "" : (fromAddress.split("@")[0] ?? "");
  const fromOrgDomain =
    fromAddress === null ? null : orgDomainOf(fromAddress.slice(fromAddress.indexOf("@") + 1));
  const base = { fromAddress, fromOrgDomain };
  const anywhere = ours.exec(raw)?.[1]?.toLowerCase() ?? null;
  const type = reportType(header(parsed, "content-type"));

  if (type === "feedback-report") {
    return { ...base, kind: "complaint", autoreplyId: anywhere, detail: "arf" };
  }
  if (type === "delivery-status") {
    const failed = /^\s*action\s*:\s*failed\b/im.test(parsed.body);
    if (!failed)
      return { ...base, kind: "ignored", autoreplyId: anywhere, detail: "dsn_not_failed" };
    return anywhere === null
      ? { ...base, kind: "ignored", autoreplyId: null, detail: "dsn_not_ours" }
      : { ...base, kind: "bounce", autoreplyId: anywhere, detail: "dsn_failed" };
  }
  const nullSender = all(parsed, "return-path").some((v) => v.replace(/\s+/g, "") === "<>");
  if (nullSender || DAEMON.test(fromLocal)) {
    const subject = header(parsed, "subject") ?? "";
    if (
      anywhere !== null &&
      (FAILED_WORDS.test(subject) || FAILED_WORDS.test(parsed.body.slice(0, 4000)))
    ) {
      return { ...base, kind: "bounce", autoreplyId: anywhere, detail: "nonstandard_bounce" };
    }
    return { ...base, kind: "ignored", autoreplyId: anywhere, detail: "daemon" };
  }
  const automatic = isAutomatic(parsed);
  if (automatic !== null)
    return { ...base, kind: "ignored", autoreplyId: anywhere, detail: automatic };

  // A person: the reply they answer is named in In-Reply-To/References, not merely quoted.
  const threaded = [...all(parsed, "in-reply-to"), ...all(parsed, "references")].join(" ");
  const answered = ours.exec(threaded)?.[1]?.toLowerCase() ?? null;
  return { ...base, kind: "answer", autoreplyId: answered, detail: "person" };
}
