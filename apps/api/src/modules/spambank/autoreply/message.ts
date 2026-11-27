import { randomBytes } from "node:crypto";
import { BANNER_PNG_BASE64, REPLY_HTML_EN_AU, REPLY_TEXT_EN_AU } from "./content.generated";
import {
  cleanMessageId,
  escapeHtml,
  mailbox,
  messageIdListHeader,
  quotedPrintable,
  rfc5322Date,
  unstructuredHeader,
  wrappedBase64,
} from "./mime";
import type { OptoutLinks } from "./optout";

/**
 * The counter-spam reply (BUILD.md §4.6 "The reply", superseded on content by §12.2/§12.3 v2): the owner's
 * GOD-branded draft as `multipart/alternative` (text/plain, then `multipart/related` with the HTML and the
 * banner inline as `cid:god-banner`). No remote image, no tracking, no link but the contact mailto and the
 * opt-out. The headers are the safeguards: `Auto-Submitted: auto-replied` and
 * `X-Auto-Response-Suppress: All` so the far side does not answer an automaton with another, and RFC 8058
 * `List-Unsubscribe` + `List-Unsubscribe-Post` for one-click opt-out. No I/O.
 */

/** The display name on `From:` (the sender identity the owner chose, BUILD.md §12.1 Q1). */
export const AUTOREPLY_FROM_NAME = "GOD (Global Omni Data)";
export const BANNER_CONTENT_ID = "god-banner";
/** At most this many ids in `References` (the original's last ones and its own). */
const REFERENCES_MAX = 10;

export interface AutoreplyMessageInput {
  /** `spambank.autoreply.id`; also the Message-ID's left part. */
  readonly id: string;
  readonly replyDomain: string;
  /** Where the reply goes: the sender, or the tester in `redirect` mode. */
  readonly to: string;
  /** `redirect` mode: the sender the reply was meant for, shown to the tester. */
  readonly redirectedFrom?: string;
  /** The original's Message-ID(s) and References, as JMAP gives them (no angle brackets). */
  readonly originalMessageIds: readonly string[];
  readonly originalReferences: readonly string[];
  readonly optout: OptoutLinks;
  /** The ABN as printed, or the mock line. */
  readonly abnLine: string;
  readonly contactEmail: string;
  readonly date: Date;
}

export interface BuiltMessage {
  readonly raw: string;
  /** Without angle brackets. */
  readonly messageId: string;
  readonly subject: string;
}

/** `autoreply-<uuid>@<reply domain>`: what bounces and complaints are matched by. */
export function autoreplyMessageId(id: string, replyDomain: string): string {
  return `autoreply-${id}@${replyDomain}`;
}

/** The template's first line is `Subject: ...`, then a blank line, then the text part. */
export function splitTextTemplate(template: string): { subject: string; body: string } {
  const match = /^Subject: ([^\n]*)\n\n([\s\S]*)$/.exec(template.replace(/\r\n?/g, "\n"));
  if (match === null) throw new Error("the reply template must start with a Subject line");
  return { subject: match[1] ?? "", body: match[2] ?? "" };
}

function fill(
  template: string,
  values: Readonly<Record<string, string>>,
  escape: (v: string) => string,
): string {
  const out = template.replace(/\{\{([A-Z_]+)\}\}/g, (whole, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`no value for ${whole} in the reply template`);
    return escape(value);
  });
  return out;
}

function boundary(kind: string): string {
  // "=_" cannot occur in quoted-printable or base64 output, so the boundary never collides with a part.
  return `=_sb_${kind}_${randomBytes(12).toString("hex")}`;
}

export function buildAutoreplyMessage(input: AutoreplyMessageInput): BuiltMessage {
  const { subject, body } = splitTextTemplate(REPLY_TEXT_EN_AU);
  const values = {
    OPTOUT_URL: input.optout.page,
    ABN: input.abnLine,
    CONTACT_EMAIL: input.contactEmail,
  };
  const text = fill(body, values, (v) => v);
  const html = fill(REPLY_HTML_EN_AU, values, escapeHtml);
  const messageId = autoreplyMessageId(input.id, input.replyDomain);
  const original = input.originalMessageIds
    .map(cleanMessageId)
    .filter((id): id is string => id !== null);
  const references = [
    ...input.originalReferences.map(cleanMessageId).filter((id): id is string => id !== null),
    ...original,
  ]
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(-REFERENCES_MAX);
  const alt = boundary("alt");
  const rel = boundary("rel");

  const headers = [
    `From: ${mailbox(AUTOREPLY_FROM_NAME, `reply@${input.replyDomain}`)}`,
    `To: <${input.to}>`,
    unstructuredHeader("Subject", subject),
    `Date: ${rfc5322Date(input.date)}`,
    `Message-ID: <${messageId}>`,
    ...(original[0] === undefined ? [] : [`In-Reply-To: <${original[0]}>`]),
    ...(references.length === 0 ? [] : [messageIdListHeader("References", references)]),
    "Auto-Submitted: auto-replied",
    "X-Auto-Response-Suppress: All",
    `List-Unsubscribe: <${input.optout.oneClick}>`,
    "List-Unsubscribe-Post: List-Unsubscribe=One-Click",
    ...(input.redirectedFrom === undefined
      ? []
      : [`X-Spambank-Redirected-From: <${input.redirectedFrom}>`]),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${alt}"`,
  ];

  const parts = [
    `--${alt}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    quotedPrintable(text),
    `--${alt}`,
    `Content-Type: multipart/related; type="text/html"; boundary="${rel}"`,
    "",
    `--${rel}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    quotedPrintable(html),
    `--${rel}`,
    'Content-Type: image/png; name="god-banner.png"',
    "Content-Transfer-Encoding: base64",
    `Content-ID: <${BANNER_CONTENT_ID}>`,
    'Content-Disposition: inline; filename="god-banner.png"',
    "",
    wrappedBase64(BANNER_PNG_BASE64),
    `--${rel}--`,
    `--${alt}--`,
    "",
  ];
  return { raw: [...headers, "", ...parts].join("\r\n"), messageId, subject };
}

export interface AlertMessageInput {
  readonly replyDomain: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly id: string;
  readonly date: Date;
}

/** A plain-text alert to the ops list (auto-pause, blocklist trouble), sent from the reply address. */
export function buildAlertMessage(input: AlertMessageInput): BuiltMessage {
  const messageId = `alert-${input.id}@${input.replyDomain}`;
  const headers = [
    `From: ${mailbox("Spambank alerts", `reply@${input.replyDomain}`)}`,
    `To: ${input.to.map((address) => `<${address}>`).join(", ")}`,
    unstructuredHeader("Subject", input.subject),
    `Date: ${rfc5322Date(input.date)}`,
    `Message-ID: <${messageId}>`,
    "Auto-Submitted: auto-generated",
    "X-Auto-Response-Suppress: All",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
  ];
  return {
    raw: [...headers, "", quotedPrintable(input.text), ""].join("\r\n"),
    messageId,
    subject: input.subject,
  };
}
