"use server";

import { redirect } from "next/navigation";
import { purchasePack } from "./billing-data";

/**
 * Buys a points pack (task 7.5.a / 7.8.b) through the simulated payments
 * driver — here, that means the mock `purchasePack`, which is idempotent
 * only within one dev process (see `billing-data.ts`). The real
 * `POST /:tenantId/studio/billing/purchases` (7.5.a) replaces this action's
 * body only, once merged; the form and its `businessId`/`packId` hidden
 * inputs stay the same.
 */
export async function purchasePackAction(formData: FormData): Promise<void> {
  const businessId = formData.get("businessId");
  const packId = formData.get("packId");
  const currency = formData.get("currency");
  if (
    typeof businessId !== "string" ||
    typeof packId !== "string" ||
    (currency !== "AUD" && currency !== "IDR")
  ) {
    redirect("/studio/billing?error=invalid_purchase");
  }
  await purchasePack(businessId, packId, currency);
  redirect("/studio/billing?purchased=1");
}
