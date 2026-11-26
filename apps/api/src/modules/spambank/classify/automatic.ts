import { type HeaderInput, headerValues, simpleValue, stripComments } from "./header-values";

export interface AutomaticHeaders {
  readonly autoSubmitted?: HeaderInput;
  readonly xAutoreply?: HeaderInput;
  readonly xAutorespond?: HeaderInput;
  readonly xAutoResponseSuppress?: HeaderInput;
  readonly precedence?: HeaderInput;
  readonly returnPath?: HeaderInput;
  /** Top-level `bodyStructure.type`. */
  readonly contentType?: string | null | undefined;
}

export type AutomaticReason =
  | "auto_submitted"
  | "x_autoreply"
  | "x_autorespond"
  | "auto_response_suppress"
  | "precedence_auto_reply"
  | "null_return_path"
  | "report";

/** Delivery and feedback reports; §4.6 names `multipart/report`, the rest are its parts sent bare. */
const REPORT_TYPES: readonly string[] = [
  "multipart/report",
  "message/delivery-status",
  "message/disposition-notification",
  "message/feedback-report",
];

/**
 * BUILD.md §4.6 check 4 (`auto_or_bounce`). Every instance of a header is
 * checked, so a trailing `Auto-Submitted: no` cannot hide an earlier
 * `auto-replied`, and an unreadable value counts as automatic.
 */
export function automaticReason(h: AutomaticHeaders): AutomaticReason | null {
  for (const v of headerValues(h.autoSubmitted)) {
    // `auto-replied; owner-email="…"`: the keyword is before the first `;`.
    const keyword = simpleValue(v)?.split(";")[0]?.trim();
    if (keyword !== "no") return "auto_submitted";
  }
  if (headerValues(h.xAutoreply).length > 0) return "x_autoreply";
  if (headerValues(h.xAutorespond).length > 0) return "x_autorespond";
  for (const v of headerValues(h.xAutoResponseSuppress)) {
    const tokens = (simpleValue(v) ?? "all").split(/[\s,]+/);
    if (tokens.includes("all") || tokens.includes("autoreply")) return "auto_response_suppress";
  }
  for (const v of headerValues(h.precedence)) {
    const p = simpleValue(v);
    if (p === "auto_reply" || p === "auto-reply") return "precedence_auto_reply";
  }
  for (const v of headerValues(h.returnPath)) {
    // `<>`, `< >`, `<>  (comment)` and an empty value are all the null sender.
    const path = (stripComments(v) ?? v).replace(/\s+/g, "");
    if (path === "<>" || path === "") return "null_return_path";
  }
  const type = (h.contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (REPORT_TYPES.includes(type)) return "report";
  return null;
}
