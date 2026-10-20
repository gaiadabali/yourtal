"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { startPayoutLink } from "./billing-data";

/** 5.2: set up or update the bank account approved statements are paid to, on the processor's own page. */
export async function startPayoutLinkAction(formData: FormData): Promise<void> {
  const businessId = formData.get("businessId");
  if (typeof businessId !== "string") redirect("/studio/billing?payouts=error");
  const back = (outcome: string) =>
    `/studio/billing?business=${encodeURIComponent(businessId)}&${outcome}` as const;

  let url: string;
  try {
    url = (await startPayoutLink(businessId)).url;
  } catch {
    redirect(back("payouts=error"));
  }
  // The processor's own page (outside this app), or straight back here.
  redirect(url as Route);
}
