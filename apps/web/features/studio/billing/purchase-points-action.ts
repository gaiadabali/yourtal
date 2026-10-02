"use server";

import { redirect } from "next/navigation";
import { purchasePoints } from "./billing-data";

/**
 * Buys points at a preset amount (task 7.5.a / 7.8.b) — a plain
 * `<form action={purchasePointsAction}>`. `idempotencyKey` is a hidden field
 * BillingScreen embeds once per render (not minted here): the real
 * `POST .../purchases` requires an `Idempotency-Key` header, and the key
 * must stay stable across a double-click of the same rendered button —
 * minting a fresh one inside this action would defeat that on every retry.
 */
export async function purchasePointsAction(formData: FormData): Promise<void> {
  const businessId = formData.get("businessId");
  const points = formData.get("points");
  const currency = formData.get("currency");
  const idempotencyKey = formData.get("idempotencyKey");
  if (
    typeof businessId !== "string" ||
    typeof points !== "string" ||
    typeof idempotencyKey !== "string" ||
    (currency !== "AUD" && currency !== "IDR")
  ) {
    redirect("/studio/billing?error=invalid_purchase");
  }
  // Keep the business in view: a person may hold several.
  const back = (outcome: string) =>
    `/studio/billing?business=${encodeURIComponent(businessId)}&${outcome}` as const;
  const pointsValue = Number(points);
  if (!Number.isFinite(pointsValue) || pointsValue <= 0) {
    redirect(back("error=invalid_purchase"));
  }

  try {
    await purchasePoints(businessId, pointsValue, currency, idempotencyKey);
  } catch {
    redirect(back("error=purchase_failed"));
  }
  redirect(back("purchased=1"));
}
