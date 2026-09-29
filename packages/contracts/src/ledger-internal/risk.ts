import { z } from "zod";
import { regionSchema } from "../region/region";

/** TASKS.md 10.4/10.5: the real RiskGate's manual-review queue. */

export const riskSignalSchema = z.object({
  kind: z.string().min(1),
  detail: z.string().min(1),
});
export type RiskSignal = z.infer<typeof riskSignalSchema>;

export const riskFlagSeveritySchema = z.enum(["flag", "block"]);
export type RiskFlagSeverity = z.infer<typeof riskFlagSeveritySchema>;

export const riskFlagStatusSchema = z.enum(["pending", "released", "suspended"]);
export type RiskFlagStatus = z.infer<typeof riskFlagStatusSchema>;

export const riskFlagSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  region: regionSchema,
  severity: riskFlagSeveritySchema,
  reason: z.string().min(1),
  signals: z.array(riskSignalSchema),
  escrowId: z.string().min(1).optional(),
  status: riskFlagStatusSchema,
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().optional(),
  resolvedBy: z.string().min(1).optional(),
  resolutionNote: z.string().min(1).optional(),
});
export type RiskFlag = z.infer<typeof riskFlagSchema>;

export const riskQueueListRequestSchema = z.object({
  region: regionSchema,
  limit: z.number().int().min(1).max(200).optional(),
});
export type RiskQueueListRequest = z.infer<typeof riskQueueListRequestSchema>;

export const riskQueueListSchema = z.object({
  flags: z.array(riskFlagSchema),
});
export type RiskQueueList = z.infer<typeof riskQueueListSchema>;

export const riskQueueResolveRequestSchema = z.object({
  id: z.string().min(1),
  resolvedBy: z.string().min(1),
  resolutionNote: z.string().min(1).optional(),
});
export type RiskQueueResolveRequest = z.infer<typeof riskQueueResolveRequestSchema>;
