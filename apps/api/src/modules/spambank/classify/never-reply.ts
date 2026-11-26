/** Contained anywhere in the normalised local part. */
const CONTAINS: readonly string[] = [
  "noreply",
  "donotreply",
  // Beyond §4.6: same meaning, same bounce risk.
  "donotrespond",
  "noresponse",
];

/** At the start of the normalised local part. */
const PREFIXES: readonly string[] = [
  "mailerdaemon",
  "postmaster",
  "bounce",
  "abuse",
  "listserv",
  "majordomo",
  "nobody",
  "root",
];

export type NeverReplyReason =
  "empty" | "contains_noreply" | "system_prefix" | "list_owner" | "list_request";

/**
 * Lower-case, quotes and spaces dropped, `+tag` removed, `.`, `-` and `_`
 * removed: `No.Reply+x` → `noreply`, `MAILER-DAEMON` → `mailerdaemon`.
 */
export function normalizeLocalPart(local: string): string {
  const plain = local.toLowerCase().replace(/["\s]/g, "");
  const plus = plain.indexOf("+");
  return (plus === -1 ? plain : plain.slice(0, plus)).replace(/[._-]/g, "");
}

/** BUILD.md §4.6 check 5 (`noreply_address` when non-null). */
export function neverReplyReason(local: string): NeverReplyReason | null {
  const raw = local.toLowerCase().replace(/["\s]/g, "");
  if (raw.startsWith("owner-")) return "list_owner";
  const beforeTag = raw.split("+")[0] ?? raw;
  if (raw.endsWith("-request") || beforeTag.endsWith("-request")) return "list_request";
  const n = normalizeLocalPart(local);
  if (n === "") return "empty";
  if (CONTAINS.some((c) => n.includes(c))) return "contains_noreply";
  if (PREFIXES.some((p) => n.startsWith(p))) return "system_prefix";
  return null;
}
