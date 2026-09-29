import "server-only";
import { forbidden } from "next/navigation";
import { staffRiskQueueSchema, type StaffRiskQueue } from "@yourtal/contracts/staff/risk-queue";
import type { Region } from "@yourtal/contracts/region";
import { apiFetch } from "@/lib/api/api-fetch";

/**
 * TASKS.md 10.5.a: the real RiskGate's manual-review queue (10.4.b), staff
 * console reads. `region` is required by the API (each region is its own
 * economy, F2) -- the page always passes one, defaulting to AU. `risk_flag`
 * is `risk_analyst`-only (risk_flag.yaml); a working staff role without it
 * gets a real 403 here, the same `forbidden()` boundary 9.1 wired up (F53).
 */
export async function listRiskQueue(region: Region): Promise<StaffRiskQueue> {
  const result = await apiFetch(`/api/staff/risk/queue?region=${region}`, staffRiskQueueSchema);
  if (result.ok) return result.data;
  if (result.error.kind === "http" && result.error.status === 403) forbidden();
  throw new Error(`Could not load the risk queue: ${result.error.message}`);
}
