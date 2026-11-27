"use server";

import * as z from "zod";
import { LEAD_STATUSES, type SpambankAutoreplyChange } from "./spambank-staff-contract";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError } from "@/lib/api/api-fetch";

export type StaffActionResult = { ok: true } | { ok: false; error: ApiError };

/** BUILD.md 5.4 does not pin either write's response body, so none is relied on: callers apply or re-read. */
const anyBody = z.unknown();

const bad = (message: string): { ok: false; error: ApiError } => ({
  ok: false,
  error: { kind: "http", status: 400, code: "invalid_request", message },
});

/** BUILD.md 5.4: `PATCH /api/staff/spambank/leads/:orgDomain` (`ops` only; the API refuses anyone else). */
export async function updateLeadAction(
  orgDomain: string,
  status: string,
  note: string,
): Promise<StaffActionResult> {
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) return bad("unknown status");
  if (note.length > 2000) return bad("note too long");
  const result = await apiFetch(
    `/api/staff/spambank/leads/${encodeURIComponent(orgDomain)}`,
    anyBody,
    {
      method: "PATCH",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: { status, note: note.trim() === "" ? null : note.trim() },
    },
  );
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/**
 * BUILD.md 5.4: `POST /api/staff/spambank/autoreply` (`admin`, `ops`). Every
 * change names a reason, which the API records. The page re-reads afterwards.
 */
export async function changeAutoreplyAction(
  change: SpambankAutoreplyChange,
): Promise<StaffActionResult> {
  const reason = change.reason.trim();
  if (reason === "") return bad("a reason is required");
  if (
    change.dailyCap !== undefined &&
    (!Number.isInteger(change.dailyCap) || change.dailyCap < 1)
  ) {
    return bad("the daily cap must be a whole number of at least 1");
  }
  const result = await apiFetch("/api/staff/spambank/autoreply", anyBody, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: {
      ...(change.tripped === undefined ? {} : { tripped: change.tripped }),
      ...(change.dailyCap === undefined ? {} : { dailyCap: change.dailyCap }),
      ...(change.resume === undefined ? {} : { resume: change.resume }),
      reason,
    },
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
