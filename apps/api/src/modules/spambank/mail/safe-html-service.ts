import type { SafeHtmlResponse } from "@yourtal/contracts/spambank/mail";
import type { Problem } from "../proxy/http";
import type { MailPrincipal } from "../proxy/mail-auth";
import type { ProxyContext } from "../proxy/proxy-context";
import { expandTemplate, upstreamPath } from "../proxy/upstream-session";
import type { UpstreamSession } from "../proxy/upstream-session";
import {
  JMAP_ID,
  NOT_FOUND,
  USING_MAIL,
  callAs,
  isProblem,
  isRecord,
  sessionOf,
} from "./account-jmap";
import { sanitizeMailHtml, textAsHtml } from "./safe-html";

/**
 * `GET /api/spambank/mail/messages/:emailId/safe-html` (spambank/BUILD.md §4.4): the message's HTML
 * body read as the mailbox, its `cid:` images inlined as `data:` URIs within the size limits, then
 * sanitised. Nothing remote is ever fetched.
 */

export const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_INLINE_IMAGE = 2 * 1024 * 1024;
const MAX_INLINE_TOTAL = 5 * 1024 * 1024;
const RASTER = /^image\/(png|jpe?g|gif|webp)$/i;
const CID_REF = /cid:([^\s"'()<>]+)/gi;

interface InlinePart {
  readonly cid: string;
  readonly blobId: string;
  readonly type: string;
  readonly size: number;
}

function inlineParts(attachments: unknown): InlinePart[] {
  if (!Array.isArray(attachments)) return [];
  const parts: InlinePart[] = [];
  for (const a of attachments) {
    if (!isRecord(a) || typeof a.cid !== "string" || typeof a.blobId !== "string") continue;
    parts.push({
      cid: a.cid.replace(/^<|>$/g, "").trim().toLowerCase(),
      blobId: a.blobId,
      type: typeof a.type === "string" ? a.type.toLowerCase() : "",
      size: typeof a.size === "number" ? a.size : Number.MAX_SAFE_INTEGER,
    });
  }
  return parts;
}

async function inlineImages(
  ctx: ProxyContext,
  principal: MailPrincipal,
  session: UpstreamSession,
  html: string,
  parts: readonly InlinePart[],
): Promise<Map<string, string>> {
  const wanted = new Set([...html.matchAll(CID_REF)].map((m) => (m[1] ?? "").toLowerCase()));
  const inline = new Map<string, string>();
  const account = ctx.driver.account(principal.localPart, principal.domain);
  let total = 0;
  for (const part of parts) {
    if (!wanted.has(part.cid) || inline.has(part.cid) || !RASTER.test(part.type)) continue;
    if (part.size > MAX_INLINE_IMAGE || total + part.size > MAX_INLINE_TOTAL) continue;
    const path = upstreamPath(
      expandTemplate(session.downloadUrl, {
        accountId: session.accountId,
        blobId: part.blobId,
        name: "inline",
        type: part.type,
      }),
    );
    if (path === undefined) continue;
    const res = await account.fetch(path, { headers: { accept: part.type } });
    if (res.isErr()) continue;
    if (res.value.status !== 200) {
      await res.value.body?.cancel();
      continue;
    }
    const bytes = Buffer.from(await res.value.arrayBuffer());
    // The size Stalwart reported is a claim; the bytes are what count.
    if (bytes.length > MAX_INLINE_IMAGE || total + bytes.length > MAX_INLINE_TOTAL) continue;
    total += bytes.length;
    inline.set(part.cid, `data:${part.type};base64,${bytes.toString("base64")}`);
  }
  return inline;
}

export async function safeHtmlFor(
  ctx: ProxyContext,
  principal: MailPrincipal,
  emailId: string,
): Promise<SafeHtmlResponse | Problem> {
  if (!JMAP_ID.test(emailId)) return NOT_FOUND;
  const session = await sessionOf(ctx, principal);
  if (isProblem(session)) return session;
  const answers = await callAs(ctx, principal, USING_MAIL, [
    [
      "Email/get",
      {
        accountId: session.accountId,
        ids: [emailId],
        properties: ["id", "htmlBody", "attachments", "bodyValues"],
        bodyProperties: ["partId", "blobId", "type", "cid", "size", "disposition", "name"],
        fetchHTMLBodyValues: true,
        maxBodyValueBytes: MAX_BODY_BYTES,
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

  const values = isRecord(email.bodyValues) ? email.bodyValues : {};
  const pieces: string[] = [];
  let truncated = false;
  for (const part of Array.isArray(email.htmlBody) ? email.htmlBody : []) {
    if (!isRecord(part) || typeof part.partId !== "string") continue;
    const value = values[part.partId];
    if (!isRecord(value) || typeof value.value !== "string") continue;
    if (value.isTruncated === true) truncated = true;
    const type = typeof part.type === "string" ? part.type.toLowerCase() : "";
    if (type === "text/html") pieces.push(value.value);
    else if (type.startsWith("text/")) pieces.push(textAsHtml(value.value));
  }
  const html = pieces.join("\n");
  const inline = await inlineImages(ctx, principal, session, html, inlineParts(email.attachments));
  const safe = sanitizeMailHtml({ html, inline });
  return { ...safe, truncated };
}
