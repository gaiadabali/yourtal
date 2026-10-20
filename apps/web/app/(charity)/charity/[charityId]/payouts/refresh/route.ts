import type { NextRequest } from "next/server";
import * as z from "zod";
import { payoutLinkSchema } from "@yourtal/contracts/billing/payouts";
import { apiFetch } from "@/lib/api/api-fetch";
import { seeOther, seeOtherExternal } from "@/features/studio/billing/payouts-redirect";

/** The processor sends the browser here when its onboarding link expired: mint a fresh one and go straight on. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ charityId: string }> },
) {
  const parsed = z.uuid().safeParse((await context.params).charityId);
  if (!parsed.success) return seeOther("/");
  const charityId = parsed.data;
  const result = await apiFetch(`/api/charities/${charityId}/payouts/link`, payoutLinkSchema, {
    method: "POST",
    body: {},
  });
  if (result.ok) return seeOtherExternal(result.data.url);
  return seeOther(`/charity/${charityId}?payouts=error`);
}
