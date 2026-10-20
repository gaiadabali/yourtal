import type { NextRequest } from "next/server";
import * as z from "zod";
import { payoutLinkSchema } from "@yourtal/contracts/billing/payouts";
import { apiFetch } from "@/lib/api/api-fetch";
import { seeOther, seeOtherExternal } from "@/features/studio/billing/payouts-redirect";

/**
 * The processor sends the browser here when its onboarding link expired:
 * mint a fresh one and go straight on. `apiFetch` reads the session cookie
 * from the request, so it works from a route handler.
 */
export async function GET(request: NextRequest) {
  const parsed = z.uuid().safeParse(request.nextUrl.searchParams.get("business"));
  if (!parsed.success) return seeOther("/studio/billing");
  const businessId = parsed.data;
  const result = await apiFetch(
    `/api/${businessId}/studio/billing/payouts/link`,
    payoutLinkSchema,
    {
      method: "POST",
      body: {},
    },
  );
  if (result.ok) return seeOtherExternal(result.data.url);
  return seeOther(`/studio/billing?business=${businessId}&payouts=error`);
}
