import "server-only";
import { forbidden } from "next/navigation";
import { staffDisputeQueueSchema, type StaffDisputeQueue } from "@yourtal/contracts/staff/disputes";
import { apiFetch } from "@/lib/api/api-fetch";

/**
 * TASKS.md 9.4.d, K13: the captured-voucher dispute queue. List-only --
 * resolving one is 10.5. `voucher_dispute.view` is support+finance only
 * (voucher_dispute.yaml) -- a working staff role without it (risk_analyst,
 * ops) gets a real 403 here, the same `forbidden()` boundary 9.1 wired up
 * (F53), rather than an uncaught throw turning into a 500.
 */
export async function listStaffDisputes(region?: "AU" | "ID"): Promise<StaffDisputeQueue> {
  const params = region === undefined ? "" : `?region=${region}`;
  const result = await apiFetch(`/api/staff/disputes${params}`, staffDisputeQueueSchema);
  if (result.ok) return result.data;
  if (result.error.kind === "http" && result.error.status === 403) forbidden();
  throw new Error(`Could not load the dispute queue: ${result.error.message}`);
}
