"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  clearDeviceBinding,
  markLocked,
  markUnlocked,
  readDeviceBinding,
  writeDeviceBinding,
} from "./device-session-cookie";
import { generatePinSalt, hashPin, verifyPin } from "./pin-hash";
import { resolveProvisioningCode, revokeDevice } from "./provisioning-data";

/**
 * Every mutation in this feature, as Server Actions bound directly to
 * plain `<form action={...}>` elements in Server Components
 * (`device-provisioning-form.tsx`, `pin-unlock-screen.tsx`,
 * `merchant-session-chrome.tsx`, `app/(merchant)/merchant/devices/page.tsx`)
 * — same zero-client-JS pattern as
 * `apps/web/features/onboarding/commit-region-action.ts` /
 * `region-picker.tsx`. `lockDeviceAction` is the one exception called
 * imperatively (from `use-auto-lock.ts`, a "use client" leaf), which Next
 * Server Actions support identically — see that file's comment.
 *
 * Every failure path redirects back to `/merchant` (or `/merchant/devices`)
 * with an `?error=<code>` query param rather than throwing, so a mistyped
 * code or PIN degrades to "try again" copy, never a 500 — same "use-cases
 * return a Result, controllers never throw for expected failure" discipline
 * docs/13b-typescript-standards.md section 4 asks of `apps/api`, applied
 * here via redirect+query-param since a Server Action bound to a plain
 * `<form>` (no `useActionState`) has no other channel back to the page.
 *
 * `"use server"` files may only export async functions — see
 * `commit-region-action.ts`'s comment on why the cookie-name constants
 * live in a separate file; the same rule is why every export here is a
 * function, never a shared constant.
 */

const provisioningFormSchema = z
  .object({
    code: z.string().min(1),
    pin: z.string().regex(/^\d{4,6}$/),
    confirmPin: z.string(),
  })
  .refine((value) => value.pin === value.confirmPin, { message: "pin_mismatch" });

/**
 * In-process, best-effort failed-PIN counter, keyed by deviceId. This is
 * NOT a real rate limit: it resets on redeploy, is not shared across
 * serverless instances, and has no IP or device-attestation component. It
 * exists only to make "someone standing at the counter trying PINs in a
 * loop" visibly slower in this mock. docs/14-security-engineering.md
 * section 5's real authentication-hardening rules (durable store,
 * per-account AND per-IP throttling, exponential backoff) apply to a real
 * implementation instead.
 */
const failedAttempts = new Map<string, number>();
const MAX_ATTEMPTS_BEFORE_COOLDOWN = 5;

export async function submitProvisioningCode(formData: FormData): Promise<void> {
  const parsed = provisioningFormSchema.safeParse({
    code: formData.get("code"),
    pin: formData.get("pin"),
    confirmPin: formData.get("confirmPin"),
  });

  if (!parsed.success) {
    const reason = parsed.error.issues.some((issue) => issue.message === "pin_mismatch")
      ? "pin_mismatch"
      : "pin_invalid";
    redirect(`/merchant?error=${reason}`);
  }

  const template = await resolveProvisioningCode(parsed.data.code);
  if (!template) {
    redirect("/merchant?error=invalid_code");
  }

  const salt = generatePinSalt();
  const pinHash = await hashPin(parsed.data.pin, salt);
  await writeDeviceBinding({
    // A real deviceId would come from the console's provisioning record
    // itself (docs/17 section 2.1's audit trail needs a stable id minted
    // at generation time, not derived client-side); this mock derives one
    // from the code plus a timestamp, which is unique enough to demonstrate
    // the flow but is NOT how a real implementation should mint device ids.
    deviceId: `device-${parsed.data.code.toLowerCase()}-${Date.now()}`,
    merchantId: template.merchantId,
    merchantName: template.merchantName,
    label: template.label,
    locale: template.locale,
    currency: template.currency,
    countryName: template.countryName,
    pinHash,
    pinSalt: salt,
    provisionedAt: new Date().toISOString(),
  });
  // Pairing this device is also, reasonably, its first unlock — staff who
  // just set a PIN should not have to immediately re-enter it.
  await markUnlocked();
  redirect("/merchant");
}

const unlockFormSchema = z.object({ pin: z.string().min(1) });

export async function unlockWithPin(formData: FormData): Promise<void> {
  const binding = await readDeviceBinding();
  if (!binding) {
    // Not paired (or the cookie was cleared out from under this request,
    // e.g. by a revocation elsewhere) — nothing to unlock against.
    redirect("/merchant");
  }

  const attempts = failedAttempts.get(binding.deviceId) ?? 0;
  if (attempts >= MAX_ATTEMPTS_BEFORE_COOLDOWN) {
    redirect("/merchant?error=too_many_attempts");
  }

  const parsed = unlockFormSchema.safeParse({ pin: formData.get("pin") });
  const isCorrect =
    parsed.success && (await verifyPin(parsed.data.pin, binding.pinSalt, binding.pinHash));

  if (!isCorrect) {
    failedAttempts.set(binding.deviceId, attempts + 1);
    redirect("/merchant?error=wrong_pin");
  }

  failedAttempts.delete(binding.deviceId);
  await markUnlocked();
  redirect("/merchant");
}

/**
 * Locks the current shift's session. Called both by the zero-JS "Lock now"
 * form in `merchant-session-chrome.tsx` and imperatively by
 * `use-auto-lock.ts` on inactivity or the tab going hidden — the actual
 * threat this ticket cares most about per docs/17 section 2.2 ("a device
 * being left unlocked on a counter... a phone that walks out of the
 * shop"). Deliberately does NOT clear the device binding — locking is
 * reversible by any staff member who knows the PIN; only revocation
 * (below) un-pairs the device.
 */
export async function lockDeviceAction(): Promise<void> {
  await markLocked();
  redirect("/merchant");
}

const revokeFormSchema = z.object({ deviceId: z.string().min(1) });

/**
 * The device-side half of "revoke flow visible and immediate"
 * (docs/tasks/phase-u-ui.md YT-0446). `/merchant/devices` is a mock
 * stand-in for the real Team-zone revoke control (docs/17 section 2.1),
 * which belongs to the business console and is out of this ticket's
 * ownership — see `provisioning-data.ts`'s file comment for exactly what a
 * real implementation needs instead of this in-process registry.
 *
 * When the device being revoked happens to be THIS browser's own paired
 * device, this also clears its binding immediately — the closest this
 * mock can get to "instant," since there is no push channel from a real
 * console to a real device here. A device revoked from elsewhere (a
 * different browser, a different physical device) is only caught the next
 * time IT calls `getMerchantDevice()` (on its next request, or its next
 * unlock) — see `merchant-data.ts`'s comment on that gap.
 */
export async function revokeDeviceAction(formData: FormData): Promise<void> {
  const parsed = revokeFormSchema.safeParse({ deviceId: formData.get("deviceId") });
  if (!parsed.success) {
    redirect("/merchant/devices");
  }

  await revokeDevice(parsed.data.deviceId);
  const binding = await readDeviceBinding();
  if (binding?.deviceId === parsed.data.deviceId) {
    await clearDeviceBinding();
  }
  redirect("/merchant/devices");
}
