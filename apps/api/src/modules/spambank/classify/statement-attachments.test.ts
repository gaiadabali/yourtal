import { describe, expect, it } from "vitest";
import {
  type AttachmentPartInput,
  STATEMENT_MAX_BYTES,
  statementCandidates,
} from "./statement-attachments";

const pdf = (n: number, size = 120_000): AttachmentPartInput => ({
  blobId: `b${n}`,
  name: `statement-${n}.pdf`,
  type: "application/pdf",
  size,
});
const base = { enabled: true, inSpam: false, dmarcPass: true };

describe("statementCandidates (§4.8 step 2)", () => {
  it.each([
    ["switch off", { ...base, enabled: false }, "switch_off"],
    ["in Spam", { ...base, inSpam: true }, "in_spam"],
    ["no trusted dmarc=pass", { ...base, dmarcPass: false }, "unauthenticated"],
  ] as const)("%s → %s", (_name, flags, reason) => {
    expect(statementCandidates({ ...flags, attachments: [pdf(1)] })).toEqual({ ok: false, reason });
  });

  it.each<[string, AttachmentPartInput, string]>([
    ["PDF", pdf(1), "offer"],
    ["CSV", { blobId: "c", name: "tx.csv", type: "text/csv", size: 900 }, "offer"],
    ["application/csv", { blobId: "c", name: "tx", type: "application/csv", size: 900 }, "offer"],
    [
      "text/comma-separated-values",
      { blobId: "c", name: "x", type: "text/comma-separated-values", size: 9 },
      "offer",
    ],
    [
      "type with parameters",
      { blobId: "c", name: "x", type: "text/csv; charset=utf-8", size: 9 },
      "offer",
    ],
    [
      "octet-stream named .PDF",
      { blobId: "o", name: "Statement.PDF", type: "application/octet-stream", size: 9 },
      "offer",
    ],
    ["image", { blobId: "i", name: "logo.png", type: "image/png", size: 9 }, "not_statement_type"],
    ["exactly 10 MiB", pdf(2, STATEMENT_MAX_BYTES), "offer"],
    ["over 10 MiB", pdf(3, STATEMENT_MAX_BYTES + 1), "too_large"],
    ["unknown size", { blobId: "u", name: "a.pdf", type: "application/pdf" }, "too_large"],
    ["no blob id", { name: "a.pdf", type: "application/pdf", size: 9 }, "no_blob"],
  ])("%s → %s", (_name, part, verdict) => {
    const extra = pdf(99);
    const r = statementCandidates({ ...base, attachments: [part, extra] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (verdict === "offer") expect(r.offers).toContain(part);
    else expect(r.skipped).toContainEqual({ part, reason: verdict });
  });

  it("offers at most 10 per message, in order", () => {
    const parts = Array.from({ length: 12 }, (_, i) => pdf(i));
    const r = statementCandidates({ ...base, attachments: parts });
    expect(r.ok && r.offers.map((p) => p.blobId)).toEqual(parts.slice(0, 10).map((p) => p.blobId));
    expect(r.ok && r.skipped.map((s) => s.reason)).toEqual(["over_limit", "over_limit"]);
  });

  it("says no_candidates when nothing qualifies", () => {
    const r = statementCandidates({
      ...base,
      attachments: [{ blobId: "i", name: "logo.png", type: "image/png", size: 9 }],
    });
    expect(r).toEqual({ ok: false, reason: "no_candidates" });
  });
});
