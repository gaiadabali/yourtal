"use server";

import { boostChargeListSchema, boostViewSchema } from "@yourtal/contracts/studio/boost";
import type {
  BoostCharge,
  BoostView,
  SetBoostRequest,
  StopBoostRequest,
} from "@yourtal/contracts/studio/boost";
import { apiFetch } from "@/lib/api/api-fetch";

export type BoostResult =
  { ok: true; view: BoostView } | { ok: false; message: string; code: string | null };

const failure = (error: { message: string; code?: string }): BoostResult => ({
  ok: false,
  message: error.message,
  code: error.code ?? null,
});

/** 13.23.a: `GET .../studio/campaigns/:campaignId/boost`. */
export async function loadBoost(businessId: string, campaignId: string): Promise<BoostResult> {
  const result = await apiFetch(
    `/api/${businessId}/studio/campaigns/${encodeURIComponent(campaignId)}/boost`,
    boostViewSchema,
  );
  return result.ok ? { ok: true, view: result.data } : failure(result.error);
}

/** 13.23.a: `PUT .../studio/campaigns/:campaignId/boost`; the server prices nothing here, it stores the bid. */
export async function saveBoost(
  businessId: string,
  campaignId: string,
  body: SetBoostRequest,
): Promise<BoostResult> {
  const result = await apiFetch(
    `/api/${businessId}/studio/campaigns/${encodeURIComponent(campaignId)}/boost`,
    boostViewSchema,
    { method: "PUT", body },
  );
  return result.ok ? { ok: true, view: result.data } : failure(result.error);
}

/** 14.22.f: `POST .../boost/stop`: stops bidding now or at the end of today; served days are still charged. */
export async function stopBoost(
  businessId: string,
  campaignId: string,
  effective: StopBoostRequest["effective"],
): Promise<BoostResult> {
  const result = await apiFetch(
    `/api/${businessId}/studio/campaigns/${encodeURIComponent(campaignId)}/boost/stop`,
    boostViewSchema,
    { method: "POST", body: { effective } },
  );
  return result.ok ? { ok: true, view: result.data } : failure(result.error);
}

/** 13.23.c: the business's boost charges, for the Billing statement. */
export async function listBoostCharges(businessId: string): Promise<BoostCharge[]> {
  const result = await apiFetch(
    `/api/${businessId}/studio/billing/boost-charges`,
    boostChargeListSchema,
  );
  return result.ok ? result.data.charges : [];
}
