import { z } from "zod";

/** Short-lived, httpOnly cookie that `registerAction` sets on a failed sign-up and only `/register` reads. */
export const REGISTER_DRAFT_COOKIE = "yt_register_draft";

const draftSchema = z.object({
  email: z.string().optional(),
  displayName: z.string().optional(),
  dateOfBirth: z.string().optional(),
  guardianEmail: z.string().optional(),
  region: z.enum(["AU", "ID"]).optional(),
  locale: z.enum(["en-AU", "id-ID"]).optional(),
});

export type RegisterDraft = z.infer<typeof draftSchema>;

export function parseRegisterDraft(raw: string | undefined): RegisterDraft {
  try {
    return raw === undefined ? {} : draftSchema.parse(JSON.parse(raw));
  } catch {
    return {};
  }
}
