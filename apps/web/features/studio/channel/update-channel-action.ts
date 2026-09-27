"use server";

import { redirect } from "next/navigation";
import { businessHandleSchema } from "@yourtal/contracts/business";
import { z } from "zod";
import { updateChannelSettings } from "../studio-data";

const channelSettingsFormSchema = z.object({
  businessId: z.uuid(),
  displayName: z.string().min(1).max(120),
  handle: businessHandleSchema,
  logoUrl: z.union([z.url(), z.literal("")]),
  coverUrl: z.union([z.url(), z.literal("")]),
});

/**
 * Saves channel settings (task 7.8.b) — a plain form action, same
 * zero-client-JS convention as `create-business-action.ts`. `logoUrl`
 * and `coverUrl` are plain URL fields for now: the real upload (a
 * presigned MinIO PUT, matching 7.2's media pipeline) is future work once
 * this screen needs images uploaded rather than linked.
 */
export async function updateChannelAction(formData: FormData): Promise<void> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = channelSettingsFormSchema.safeParse(raw);
  if (!parsed.success) {
    redirect("/studio/channel?error=invalid_input");
  }

  const { businessId, displayName, handle, logoUrl, coverUrl } = parsed.data;
  try {
    await updateChannelSettings(businessId, {
      displayName,
      handle,
      logoUrl: logoUrl === "" ? null : logoUrl,
      coverUrl: coverUrl === "" ? null : coverUrl,
    });
  } catch {
    redirect("/studio/channel?error=save_failed");
  }

  redirect("/studio/channel?saved=1");
}
