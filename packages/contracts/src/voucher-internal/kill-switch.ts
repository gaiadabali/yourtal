import { z } from "zod";

/** TASKS.md 1.2.b: an emergency stop, scoped to whichever level it names. */

export const killSwitchScopeSchema = z.enum(["merchant", "listing", "batch", "global"]);
export type KillSwitchScope = z.infer<typeof killSwitchScopeSchema>;

export const setKillSwitchRequestSchema = z.object({
  scope: killSwitchScopeSchema,
  targetId: z.string().min(1).nullable(),
  reason: z.string().min(1),
  setBy: z.string().min(1),
  active: z.boolean(),
});
export type SetKillSwitchRequest = z.infer<typeof setKillSwitchRequestSchema>;

export const killSwitchSchema = z.object({
  killSwitchId: z.string().min(1),
  scope: killSwitchScopeSchema,
  targetId: z.string().min(1).nullable(),
  reason: z.string().min(1),
  setBy: z.string().min(1),
  active: z.boolean(),
  setAt: z.iso.datetime(),
});
export type KillSwitch = z.infer<typeof killSwitchSchema>;
