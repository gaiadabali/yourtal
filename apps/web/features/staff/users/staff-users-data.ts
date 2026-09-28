import "server-only";
import {
  staffUserDetailSchema,
  staffUserLedgerHistorySchema,
  staffUserSearchResultSchema,
  type StaffUserDetail,
  type StaffUserLedgerHistory,
  type StaffUserSearchResult,
} from "@yourtal/contracts/staff/users";
import { apiFetch } from "@/lib/api/api-fetch";

/** TASKS.md 9.4.a: the staff console's own users search and detail reads. */

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
  if (!result.ok) throw new Error(`Could not search users: ${result.error.message}`);
  return result.data;
}

/** `null` for a 404 -- an unknown user id -- rather than throwing. */
export async function getStaffUser(userId: string): Promise<StaffUserDetail | null> {
  const result = await apiFetch(`/api/staff/users/${userId}`, staffUserDetailSchema);
  if (result.ok) return result.data;
  if (result.error.kind === "http" && result.error.status === 404) return null;
  throw new Error(`Could not load user: ${result.error.message}`);
}

export async function getStaffUserLedger(userId: string): Promise<StaffUserLedgerHistory> {
  const result = await apiFetch(
    `/api/staff/users/${userId}/ledger`,
    staffUserLedgerHistorySchema,
  );
  if (!result.ok) throw new Error(`Could not load ledger: ${result.error.message}`);
  return result.data;
}
