import { describeProblem, resolveDriverMode } from "@yourtal/drivers/driver-mode";
import { createModerationDriver } from "@yourtal/drivers/moderation";
import type { ModerationDriver } from "@yourtal/drivers/moderation";

/** 13.3.b: the automated content screen a campaign passes before a human moderator. */
export const MODERATION_DRIVER = Symbol("MODERATION_DRIVER");

export function buildModerationDriver(): ModerationDriver {
  const mode = resolveDriverMode("moderation", process.env);
  if (mode.isErr()) throw new Error(describeProblem(mode.error));
  return createModerationDriver(mode.value, process.env);
}
