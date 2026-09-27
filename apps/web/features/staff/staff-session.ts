import { cache } from "react";
import { forbidden, redirect } from "next/navigation";
import { staffSessionSchema, type StaffSession } from "@yourtal/contracts/staff/session";
import { apiFetch } from "@/lib/api/api-fetch";

/**
 * The staff console's gate (TASKS.md 9.1). Called by the `/staff` layout AND
 * by every page, because a layout alone does not re-run on client navigation.
 * `cache` makes that one API call per request. The API's own Cerbos check is
 * the real boundary; this turns its answer into a sign-in redirect or a 403.
 */
export const requireStaffSession = cache(async (): Promise<StaffSession> => {
  const result = await apiFetch("/api/staff/me", staffSessionSchema);
  if (result.ok) return result.data;
  if (result.error.kind === "http" && result.error.status === 401) {
    redirect("/login?returnTo=%2Fstaff");
  }
  if (result.error.kind === "http" && result.error.status === 403) {
    forbidden();
  }
  throw new Error(`staff console unavailable: ${result.error.message}`);
});
