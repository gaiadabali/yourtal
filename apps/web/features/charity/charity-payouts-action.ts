"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import * as z from "zod";
import { startCharityPayoutLink } from "./charity-data";

/** 5.2: set up or update the account auction proceeds are paid to, on the processor's own page. */
export async function startCharityPayoutLinkAction(formData: FormData): Promise<void> {
  const parsed = z.uuid().safeParse(formData.get("charityId"));
  if (!parsed.success) redirect("/");
  const charityId = parsed.data;

  let url: string;
  try {
    url = (await startCharityPayoutLink(charityId)).url;
  } catch {
    redirect(`/charity/${charityId}?payouts=error` as Route);
  }
  redirect(url as Route);
}
