/** JMAP `EmailBodyPart`, the fields this rule reads. */
export interface AttachmentPartInput {
  readonly blobId?: string | null | undefined;
  readonly name?: string | null | undefined;
  readonly type?: string | null | undefined;
  /** Decoded size in octets. */
  readonly size?: number | null | undefined;
}

export const STATEMENT_MAX_BYTES = 10 * 1024 * 1024;
export const STATEMENT_MAX_PER_MESSAGE = 10;

const STATEMENT_TYPES: readonly string[] = [
  "application/pdf",
  "text/csv",
  "application/csv",
  "text/comma-separated-values",
];

export type StatementSkip = "switch_off" | "in_spam" | "unauthenticated" | "no_candidates";
export type AttachmentSkip = "no_blob" | "not_statement_type" | "too_large" | "over_limit";

export interface StatementInput {
  /** `mailbox.statements_to_snapapp`. */
  readonly enabled: boolean;
  readonly inSpam: boolean;
  /** `checkSenderAuth(…).ok`: the trusted `dmarc=pass`. */
  readonly dmarcPass: boolean;
  readonly attachments: readonly AttachmentPartInput[];
}

export type StatementDecision<P extends AttachmentPartInput> =
  | {
      readonly ok: true;
      readonly offers: readonly P[];
      readonly skipped: readonly { readonly part: P; readonly reason: AttachmentSkip }[];
    }
  | { readonly ok: false; readonly reason: StatementSkip };

export function isStatementFile(part: AttachmentPartInput): boolean {
  const type = (part.type ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const name = (part.name ?? "").trim().toLowerCase();
  return STATEMENT_TYPES.includes(type) || name.endsWith(".pdf") || name.endsWith(".csv");
}

/**
 * BUILD.md §4.8 step 2. Offers at most 10 statement files of ≤ 10 MiB each,
 * in message order; a file of unknown size is not offered.
 */
export function statementCandidates<P extends AttachmentPartInput>(
  input: StatementInput & { readonly attachments: readonly P[] },
): StatementDecision<P> {
  if (!input.enabled) return { ok: false, reason: "switch_off" };
  if (input.inSpam) return { ok: false, reason: "in_spam" };
  if (!input.dmarcPass) return { ok: false, reason: "unauthenticated" };

  const offers: P[] = [];
  const skipped: { part: P; reason: AttachmentSkip }[] = [];
  for (const part of input.attachments) {
    const size = part.size;
    let reason: AttachmentSkip | null = null;
    if (typeof part.blobId !== "string" || part.blobId === "") reason = "no_blob";
    else if (!isStatementFile(part)) reason = "not_statement_type";
    else if (typeof size !== "number" || !Number.isFinite(size) || size < 0) reason = "too_large";
    else if (size > STATEMENT_MAX_BYTES) reason = "too_large";
    else if (offers.length >= STATEMENT_MAX_PER_MESSAGE) reason = "over_limit";
    if (reason === null) offers.push(part);
    else skipped.push({ part, reason });
  }
  return offers.length === 0
    ? { ok: false, reason: "no_candidates" }
    : { ok: true, offers, skipped };
}
