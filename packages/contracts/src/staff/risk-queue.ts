import * as z from "zod";
import { regionSchema } from "../region/region";

/**
 * `/api/staff/risk/queue`, TASKS.md 10.5.a: the real RiskGate's
 * manual-review queue (10.4.b, `ledger.risk_flag`), proxied straight
 * through from the ledger-internal shape (`ledger-internal/risk.ts`) — this
 * file exists as its own so the staff screen's own contract does not import
 * across the module boundary CLAUDE.md draws between `apps/api`'s BFF
 * contracts and the ledger-internal ones.
 */
export const staffRiskSignalSchema = z.object({
  kind: z.string().min(1),
  detail: z.string().min(1),
});
export type StaffRiskSignal = z.infer<typeof staffRiskSignalSchema>;

export const staffRiskFlagSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  region: regionSchema,
  severity: z.enum(["flag", "block"]),
  reason: z.string().min(1),
  signals: z.array(staffRiskSignalSchema),
  escrowId: z.string().min(1).optional(),
  status: z.enum(["pending", "released", "suspended"]),
  createdAt: z.iso.datetime(),
});
export type StaffRiskFlag = z.infer<typeof staffRiskFlagSchema>;

export const staffRiskQueueSchema = z.array(staffRiskFlagSchema);
export type StaffRiskQueue = z.infer<typeof staffRiskQueueSchema>;

export const staffRiskResolveRequestSchema = z.object({
  resolutionNote: z.string().min(1).max(2000).optional(),
});
export type StaffRiskResolveRequest = z.infer<typeof staffRiskResolveRequestSchema>;

export const staffRiskResolveResultSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["released", "suspended"]),
});
export type StaffRiskResolveResult = z.infer<typeof staffRiskResolveResultSchema>;
