"use server";

import { revalidatePath } from "next/cache";
import { charityDetailSchema } from "@yourtal/contracts/charity";
import type { CharityApplicationRequest, CharityDetail } from "@yourtal/contracts/charity";
import { apiFetch } from "@/lib/api/api-fetch";
import type { ApiError } from "@/lib/api/api-fetch";

export type CharityActionResult =
  | { ok: true; charity: CharityDetail }
  | { ok: false; status: number | null; code: string | null; message: string };

function failure(error: ApiError): CharityActionResult {
  return error.kind === "http"
    ? { ok: false, status: error.status, code: error.code, message: error.message }
    : { ok: false, status: null, code: null, message: error.message };
}

/** 13.21.a: submit an application; the API runs the simulated KYB check. */
export async function applyForCharity(
  application: CharityApplicationRequest,
): Promise<CharityActionResult> {
  const result = await apiFetch("/api/charities/applications", charityDetailSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: application,
  });
  if (!result.ok) return failure(result.error);
  revalidatePath("/charity/apply");
  return { ok: true, charity: result.data };
}

/** 13.21.a: an ops decision, always with a reason (audited server-side). */
export async function decideCharity(
  charityId: string,
  decision: "approve" | "reject",
  reason: string,
): Promise<CharityActionResult> {
  const result = await apiFetch(
    `/api/staff/charities/${encodeURIComponent(charityId)}/decision`,
    charityDetailSchema,
    { method: "POST", body: { decision, reason } },
  );
  if (!result.ok) return failure(result.error);
  revalidatePath("/staff/charities");
  return { ok: true, charity: result.data };
}
