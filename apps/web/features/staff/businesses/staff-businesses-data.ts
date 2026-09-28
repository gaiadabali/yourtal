import "server-only";

import {
  listStaffBusinessesResponseSchema,
  staffBusinessDetailSchema,
  type ListStaffBusinessesResponse,
  type StaffBusinessDetail,
} from "@yourtal/contracts/staff/businesses";
import { apiFetch } from "@/lib/api/api-fetch";

/** TASKS.md 9.3.a: the staff console's Businesses zone, reading the real API -- no mock seam, staff tools only ever show real data. */

export interface ListStaffBusinessesParams {
  readonly search?: string;
  readonly region?: "AU" | "ID";
}

export async function listStaffBusinesses(
  params: ListStaffBusinessesParams,
): Promise<ListStaffBusinessesResponse> {
  const query = new URLSearchParams();
  if (params.search !== undefined && params.search.trim() !== "") {
    query.set("search", params.search.trim());
  }
  if (params.region !== undefined) query.set("region", params.region);
  const qs = query.toString();
  const result = await apiFetch(
    `/api/staff/businesses${qs === "" ? "" : `?${qs}`}`,
    listStaffBusinessesResponseSchema,
  );
  if (!result.ok) throw new Error(`Could not load businesses: ${result.error.message}`);
  return result.data;
}

/** `null` on a 404 -- the caller decides whether that means `notFound()`. */
export async function getStaffBusiness(businessId: string): Promise<StaffBusinessDetail | null> {
  const result = await apiFetch(`/api/staff/businesses/${businessId}`, staffBusinessDetailSchema);
  if (result.ok) return result.data;
  if (result.error.kind === "http" && result.error.status === 404) return null;
  throw new Error(`Could not load business ${businessId}: ${result.error.message}`);
}
