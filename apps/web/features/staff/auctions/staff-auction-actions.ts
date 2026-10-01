"use server";

import { revalidatePath } from "next/cache";
import { auctionSchema } from "@yourtal/contracts/auction/auction";
import { apiFetch } from "@/lib/api/api-fetch";

/** 13.22.g: cancel one open auction, always with a reason (audited server-side). */
export async function cancelAuctionAction(
  auctionId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const result = await apiFetch(
    `/api/staff/auctions/${encodeURIComponent(auctionId)}/cancel`,
    auctionSchema,
    { method: "POST", body: { reason } },
  );
  if (!result.ok) return { ok: false, message: result.error.message };
  revalidatePath("/staff/auctions");
  return { ok: true };
}
