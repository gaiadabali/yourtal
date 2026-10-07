"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import { apiFetch } from "@/lib/api/api-fetch";

const JOIN_PATH = "/studio/join";

/** 13.3.b: an invitee joins the business with the code from their invitation email. */
export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const rawToken = formData.get("token");
  const token = typeof rawToken === "string" ? rawToken.trim() : "";
  if (token === "") redirect(`${JOIN_PATH}?error=invalid`);
  const result = await apiFetch(
    "/api/me/businesses/invitations/accept",
    z.object({ businessId: z.uuid() }),
    { method: "POST", body: { token } },
  );
  if (!result.ok) redirect(`${JOIN_PATH}?error=invalid`);
  redirect(`/studio?business=${result.data.businessId}`);
}
