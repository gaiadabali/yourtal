import * as z from "zod";
import { isDisposableEmail } from "./disposable-email-domains";

/**
 * The identity check before earning (F126, docs/16 N-5): an account earns
 * points only once its sign-in email is verified and the address is a
 * permanent one, not a disposable-email domain. Production always requires
 * it; elsewhere the region setting below turns it on, so the demo world
 * keeps working until someone tries it. This file is the rule; the API and
 * the worker each read the facts and ask it. A passkey requirement (F102) is
 * one more step behind its own switch, `requirePasskey`: off until finance
 * turns it on (two-person), in production too.
 */
export const POINTS_IDENTITY_CHECK_SETTING_KEY = "points_identity_check";

export const pointsIdentityCheckSettingSchema = z.strictObject({
  enabled: z.boolean(),
  /** Also needs a registered passkey (F102). Absent reads as off, so rows from before the switch still parse. */
  requirePasskey: z.boolean().default(false),
});
export type PointsIdentityCheckSetting = z.infer<typeof pointsIdentityCheckSettingSchema>;

export { IDENTITY_CHECK_REQUIRED } from "./identity-check-code";

export const identityCheckStepSchema = z.enum([
  "verify_email",
  "use_permanent_email",
  "add_passkey",
]);
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
  /** Registered passkeys; only read while the passkey switch is on. */
  readonly passkeyCount: number;
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

/**
 * Whether the passkey step is on: the check applies and the setting says
 * `requirePasskey`. Production does not force it; it follows the setting.
 */
export function passkeyRequired(appEnv: string, setting: unknown): boolean {
  const parsed = pointsIdentityCheckSettingSchema.safeParse(setting);
  return identityCheckApplies(appEnv, setting) && parsed.success && parsed.data.requirePasskey;
}

/** The rule itself. `applies` comes from `identityCheckApplies`, `needsPasskey` from `passkeyRequired`. */
export function judgeEarningIdentity(
  applies: boolean,
  facts: IdentityFacts,
  needsPasskey = false,
): EarningVerdict {
  if (!applies) return { mayEarn: true };
  const missing: IdentityCheckStep[] = [];
  if (!facts.emailVerified) missing.push("verify_email");
  if (facts.email !== null && isDisposableEmail(facts.email)) missing.push("use_permanent_email");
  if (needsPasskey && facts.passkeyCount < 1) missing.push("add_passkey");
  return missing.length === 0 ? { mayEarn: true } : { mayEarn: false, missing };
}
