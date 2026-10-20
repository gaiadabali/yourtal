"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import type { PurchaseResult } from "@yourtal/contracts/billing";
import { packageTierKeySchema } from "@yourtal/contracts/billing/package-tiers";
import { purchasePoints, startCardSetup } from "./billing-data";

/**
 * Buys the chosen point package (task 14.13 / 5.1.a) — a plain
 * `<form action={purchasePointsAction}>` whose radio group is `tierKey`.
 * `idempotencyKey` is a hidden field BillingScreen embeds once per render (not
 * minted here): the real `POST .../purchases` requires an `Idempotency-Key`
 * header, and the key must stay stable across a double-click of the same
 * rendered button — minting a fresh one inside this action would defeat that
 * on every retry. The chosen tier is appended to it, because the page cannot
 * know which package will be picked and one key must never cover two bodies.
 *
 * Stripe answers with a checkout page: the browser goes there, and comes back
 * to `/studio/billing?purchase=<id>`, which waits for the webhook. A processor
 * that settles at once (Indonesia) comes straight back to the same page.
 */
export async function purchasePointsAction(formData: FormData): Promise<void> {
  const businessId = formData.get("businessId");
  const tier = packageTierKeySchema.safeParse(formData.get("tierKey"));
  const currency = formData.get("currency");
  const idempotencyKey = formData.get("idempotencyKey");
  if (
    typeof businessId !== "string" ||
    !tier.success ||
    typeof idempotencyKey !== "string" ||
    (currency !== "AUD" && currency !== "IDR")
  ) {
    redirect("/studio/billing?error=invalid_purchase");
  }
  // Keep the business in view: a person may hold several.
  const back = (outcome: string) =>
    `/studio/billing?business=${encodeURIComponent(businessId)}&${outcome}` as const;
  const tierKey = tier.data;

  let result: PurchaseResult;
  try {
    result = await purchasePoints(businessId, tierKey, currency, `${idempotencyKey}:${tierKey}`);
  } catch {
    redirect(back("error=purchase_failed"));
  }
  if (result.status === "awaiting_payment" && result.checkoutUrl !== null) {
    // The processor's own page, outside this app.
    redirect(result.checkoutUrl as Route);
  }
  redirect(
    back(
      result.status === "paid"
        ? "purchased=1"
        : `purchase=${encodeURIComponent(result.purchaseId)}`,
    ),
  );
}

/** 5.1.a: add or replace the card boosts are charged to, on the processor's own page. */
export async function startCardSetupAction(formData: FormData): Promise<void> {
  const businessId = formData.get("businessId");
  if (typeof businessId !== "string") redirect("/studio/billing?error=card_failed");
  const back = (outcome: string) =>
    `/studio/billing?business=${encodeURIComponent(businessId)}&${outcome}` as const;

  let checkoutUrl: string | null;
  try {
    checkoutUrl = (await startCardSetup(businessId)).checkoutUrl;
  } catch {
    redirect(back("card=failed"));
  }
  redirect((checkoutUrl ?? back("card=saved")) as Route);
}
