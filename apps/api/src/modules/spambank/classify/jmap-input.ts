import type { HeaderInput } from "./header-values";
import type { AddressInput } from "./sender-auth";
import type { SenderInput } from "./sender-checks";

type Text = string | null | undefined;
type TextAll = readonly string[] | null | undefined;

/**
 * The JMAP `Email/get` properties `senderInputFromJmap` reads. Ask for the
 * `:all` forms where listed: plain `asText` returns only the LAST instance,
 * so a sender could append `Auto-Submitted: no` after `auto-replied`.
 */
export interface JmapSenderFields {
  readonly from?: readonly AddressInput[] | null | undefined;
  readonly replyTo?: readonly AddressInput[] | null | undefined;
  readonly bodyStructure?: { readonly type?: string | null | undefined } | null | undefined;
  readonly "header:From:asAddresses:all"?: readonly unknown[] | null | undefined;
  /** Required: topmost first (RFC 8621 §4.1.3). */
  readonly "header:Authentication-Results:asText:all"?: TextAll;
  readonly "header:List-Unsubscribe:asText:all"?: TextAll;
  readonly "header:List-Unsubscribe:asText"?: Text;
  readonly "header:List-Unsubscribe:asURLs"?: readonly string[] | null | undefined;
  readonly "header:List-Id:asText:all"?: TextAll;
  readonly "header:List-Id:asText"?: Text;
  readonly "header:Precedence:asText:all"?: TextAll;
  readonly "header:Precedence:asText"?: Text;
  readonly "header:Auto-Submitted:asText:all"?: TextAll;
  readonly "header:Auto-Submitted:asText"?: Text;
  readonly "header:X-Autoreply:asText:all"?: TextAll;
  readonly "header:X-Autoreply:asText"?: Text;
  readonly "header:X-Autorespond:asText:all"?: TextAll;
  readonly "header:X-Autorespond:asText"?: Text;
  readonly "header:X-Auto-Response-Suppress:asText:all"?: TextAll;
  readonly "header:X-Auto-Response-Suppress:asText"?: Text;
  readonly "header:Return-Path:asText:all"?: TextAll;
  readonly "header:Return-Path:asText"?: Text;
}

/** `:all` when present, else the single value. */
function pick(all: TextAll, one: Text): HeaderInput {
  return all ?? one;
}

export function senderInputFromJmap(e: JmapSenderFields): SenderInput {
  const urls = e["header:List-Unsubscribe:asURLs"];
  // asURLs is null when the header is absent OR unparsable; asText says which.
  const listUnsubscribe =
    pick(e["header:List-Unsubscribe:asText:all"], e["header:List-Unsubscribe:asText"]) ??
    (urls && urls.length > 0 ? urls.join(", ") : null);
  const fromFields = e["header:From:asAddresses:all"];
  return {
    from: e.from ?? null,
    fromHeaderCount: fromFields?.length,
    replyTo: e.replyTo ?? null,
    authenticationResults: e["header:Authentication-Results:asText:all"] ?? [],
    listUnsubscribe,
    listId: pick(e["header:List-Id:asText:all"], e["header:List-Id:asText"]),
    precedence: pick(e["header:Precedence:asText:all"], e["header:Precedence:asText"]),
    autoSubmitted: pick(e["header:Auto-Submitted:asText:all"], e["header:Auto-Submitted:asText"]),
    xAutoreply: pick(e["header:X-Autoreply:asText:all"], e["header:X-Autoreply:asText"]),
    xAutorespond: pick(e["header:X-Autorespond:asText:all"], e["header:X-Autorespond:asText"]),
    xAutoResponseSuppress: pick(
      e["header:X-Auto-Response-Suppress:asText:all"],
      e["header:X-Auto-Response-Suppress:asText"],
    ),
    returnPath: pick(e["header:Return-Path:asText:all"], e["header:Return-Path:asText"]),
    contentType: e.bodyStructure?.type ?? null,
  };
}

/** Every property above, for T6's `Email/get` `properties` list. */
export const JMAP_SENDER_PROPERTIES: readonly string[] = [
  "from",
  "replyTo",
  "bodyStructure",
  "header:From:asAddresses:all",
  "header:Authentication-Results:asText:all",
  "header:List-Unsubscribe:asText:all",
  "header:List-Unsubscribe:asURLs",
  "header:List-Id:asText:all",
  "header:Precedence:asText:all",
  "header:Auto-Submitted:asText:all",
  "header:X-Autoreply:asText:all",
  "header:X-Autorespond:asText:all",
  "header:X-Auto-Response-Suppress:asText:all",
  "header:Return-Path:asText:all",
];
