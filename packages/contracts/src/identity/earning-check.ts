import * as z from "zod";
import { isDisposableEmail } from "./disposable-email-domains";

/**
 * The identity check before earning (F126, docs/16 N-5): an account earns
 * points only once its sign-in email is verified and the address is a
 * permanent one, not a disposable-email domain. Production always requires
 * it; elsewhere the region setting below turns it on, so the demo world
 * keeps working until someone tries it. This file is the rule; the API and
 * the worker each read the facts and ask it. A passkey requirement (F102)
 * joins later as one more step and one more fact, behind its own switch.
 */
export const POINTS_IDENTITY_CHECK_SETTING_KEY = "points_identity_check";

export const pointsIdentityCheckSettingSchema = z.strictObject({ enabled: z.boolean() });
export type PointsIdentityCheckSetting = z.infer<typeof pointsIdentityCheckSettingSchema>;

/** The stable code a refused earning carries: a watch session's `nonEarningReason`, a partner's error code. */
export const IDENTITY_CHECK_REQUIRED = "identity_check_required";

export const identityCheckStepSchema = z.enum(["verify_email", "use_permanent_email"]);
export type IdentityCheckStep = z.infer<typeof identityCheckStepSchema>;

/** What a refused viewer still has to do, in the order the player asks. */
export const identityCheckSchema = z.strictObject({
  missing: z.array(identityCheckStepSchema).min(1),
});
export type IdentityCheck = z.infer<typeof identityCheckSchema>;

export interface IdentityFacts {
  readonly emailVerified: boolean;
  /** The sign-in email, or `null` when the account has no password credential. */
  readonly email: string | null;
}

export type EarningVerdict =
  | { readonly mayEarn: true }
  | { readonly mayEarn: false; readonly missing: readonly IdentityCheckStep[] };

/**
 * Whether the check applies. `production` always; anywhere else only when
 * the region's approved setting says `{"enabled": true}`. A missing or
 * malformed setting outside production reads as off.
 */
export function identityCheckApplies(appEnv: string, setting: unknown): boolean {
  if (appEnv === "production") return true;
  const parsed = pointsIdentityCheckSettingSchema.safeParse(setting);
  return parsed.success && parsed.data.enabled;
}

/** The rule itself. `applies` comes from `identityCheckApplies`. */
export function judgeEarningIdentity(applies: boolean, facts: IdentityFacts): EarningVerdict {
  if (!applies) return { mayEarn: true };
  const missing: IdentityCheckStep[] = [];
  if (!facts.emailVerified) missing.push("verify_email");
  if (facts.email !== null && isDisposableEmail(facts.email)) missing.push("use_permanent_email");
  return missing.length === 0 ? { mayEarn: true } : { mayEarn: false, missing };
}
