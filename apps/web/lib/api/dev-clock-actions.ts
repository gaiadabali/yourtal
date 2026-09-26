"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { apiFetch } from "./api-fetch";
import type { ApiError } from "./api-fetch";
import {
  advanceDaysResponseSchema,
  releasePendingResponseSchema,
  runJobResponseSchema,
} from "./dev-clock-schema";

/**
 * Server Actions for `/dev/clock` (2.3.d) — same "zero client JS, a plain
 * `<form action={...}>`" convention as `actions.ts`'s `loginAction`/
 * `updateMeAction`. Every result (success or failure) is reported by
 * redirecting back to `/dev/clock` with a query param the page reads and
 * renders — there is no client-side state to manage on a page this plain.
 */

function errorCode(error: ApiError): string {
  return error.kind === "http" ? error.code : error.kind;
}

function redirectWithError(code: string): never {
  redirect(`/dev/clock?error=${encodeURIComponent(code)}` as Route);
}

function redirectWithResult(result: Record<string, unknown>): never {
  redirect(`/dev/clock?result=${encodeURIComponent(JSON.stringify(result))}` as Route);
}

export async function releasePendingAction(): Promise<void> {
  const result = await apiFetch("/api/dev/clock/release-pending", releasePendingResponseSchema, {
    method: "POST",
    body: {},
  });
  if (!result.ok) redirectWithError(errorCode(result.error));
  redirectWithResult({ action: "release-pending", ...result.data });
}

export async function advanceDaysAction(formData: FormData): Promise<void> {
  const raw = formData.get("days");
  const days = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isInteger(days) || days < 1) {
    redirectWithError("invalid_days");
  }

  const result = await apiFetch("/api/dev/clock/advance-days", advanceDaysResponseSchema, {
    method: "POST",
    body: { days },
  });
  if (!result.ok) redirectWithError(errorCode(result.error));
  redirectWithResult({ action: "advance-days", ...result.data });
}

export async function runJobAction(formData: FormData): Promise<void> {
  const job = formData.get("job");
  if (job !== "points-unlocked") redirectWithError("unknown_job");

  const result = await apiFetch("/api/dev/clock/run-job", runJobResponseSchema, {
    method: "POST",
    body: { job },
  });
  if (!result.ok) redirectWithError(errorCode(result.error));
  redirectWithResult({ action: "run-job", ...result.data });
}
