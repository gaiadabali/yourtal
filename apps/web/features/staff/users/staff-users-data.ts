import "server-only";
import { forbidden } from "next/navigation";
import {
  staffUserDetailSchema,
  staffUserLedgerHistorySchema,
  staffUserSearchResultSchema,
  type StaffUserDetail,
  type StaffUserLedgerHistory,
  type StaffUserSearchResult,
} from "@yourtal/contracts/staff/users";
import type { ApiError } from "@/lib/api/api-fetch";
import { apiFetch } from "@/lib/api/api-fetch";

/**
 * TASKS.md 9.4.a: the staff console's own users search and detail reads.
 *
 * `requireStaffSession()` (9.1) only gates the console SHELL -- it proves a
 * working staff role, not that THIS role may reach `user_account`. A
 * risk_analyst with no `goodwill_credit`/etc. still opens `/staff/users`
 * fine; a role Cerbos refuses outright on `view` gets a real 403 here, the
 * same `forbidden()` boundary 9.1 wired up (F53), rather than an uncaught
 * throw turning into a 500.
 */
function throwOrForbid(action: string, error: ApiError): never {
  if (error.kind === "http" && error.status === 403) forbidden();
  throw new Error(`Could not ${action}: ${error.message}`);
}

export interface StaffUserSearchInput {
  readonly email?: string;
  readonly userId?: string;
  readonly region?: "AU" | "ID";
}

export async function searchStaffUsers(query: StaffUserSearchInput): Promise<StaffUserSearchResult> {
  const params = new URLSearchParams();
  if (query.email !== undefined && query.email.length > 0) params.set("email", query.email);
  if (query.userId !== undefined && query.userId.length > 0) params.set("userId", query.userId);
  if (query.region !== undefined) params.set("region", query.region);
  const result = await apiFetch(
    `/api/staff/users?${params.toString()}`,
    staffUserSearchResultSchema,
  );
  if (!result.ok) throwOrForbid("search users", result.error);
  return result.data;
}

/** `null` for a 404 -- an unknown user id -- rather than throwing. */
export async function getStaffUser(userId: string): Promise<StaffUserDetail | null> {
  const result = await apiFetch(`/api/staff/users/${userId}`, staffUserDetailSchema);
  if (result.ok) return result.data;
  if (result.error.kind === "http" && result.error.status === 404) return null;
  throwOrForbid("load user", result.error);
}

export async function getStaffUserLedger(userId: string): Promise<StaffUserLedgerHistory> {
  const result = await apiFetch(
    `/api/staff/users/${userId}/ledger`,
    staffUserLedgerHistorySchema,
  );
  if (!result.ok) throwOrForbid("load ledger", result.error);
  return result.data;
}
