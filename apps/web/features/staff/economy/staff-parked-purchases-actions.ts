"use server";

import { economyProposalSchema } from "@yourtal/contracts/staff/economy";
import { apiFetch } from "@/lib/api/api-fetch";

/** What a refund button shows: nothing on success, the server's own words on a refusal (403/409/503); `""` when the reason was unusable. */
export type ParkedPurchaseActionResult = { ok: true } | { ok: false; message: string };

function regionOrThrow(region: string): "AU" | "ID" {
  if (region !== "AU" && region !== "ID") throw new Error("invalid region");
  return region;
}

async function post(path: string, body: unknown): Promise<ParkedPurchaseActionResult> {
  const result = await apiFetch(path, economyProposalSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body,
  });
  return result.ok ? { ok: true } : { ok: false, message: result.error.message };
}

/** 5.1.g: proposes refunding a parked card purchase in full. The reason is required. */
export async function proposeRefundAction(
  region: string,
  purchaseId: string,
  reason: string,
): Promise<ParkedPurchaseActionResult> {
  const trimmed = reason.trim();
  if (trimmed === "" || trimmed.length > 500) {
    return { ok: false, message: "" };
  }
  return post(
    `/api/staff/economy/${regionOrThrow(region)}/parked-purchases/${encodeURIComponent(purchaseId)}/refund-proposals`,
    { reason: trimmed },
  );
}

/** A second staff member approves (the refund is sent once) or rejects the pending refund proposal. */
export async function decideRefundAction(
  region: string,
  proposalId: string,
  decision: "approve" | "reject",
): Promise<ParkedPurchaseActionResult> {
  return post(
    `/api/staff/economy/${regionOrThrow(region)}/refund-proposals/${encodeURIComponent(proposalId)}/${decision}`,
    {},
  );
}
