"use server";

import { redirect } from "next/navigation";
import * as z from "zod";
import {
  pairDeviceResultSchema,
  unlockDeviceResultSchema,
} from "@yourtal/contracts/device/counter-device";
import { apiFetch } from "@/lib/api/api-fetch";
import {
  clearDeviceBinding,
  markLocked,
  markUnlocked,
  readDeviceBinding,
  writeDeviceBinding,
} from "./device-session-cookie";

/**
 * Every mutation in this feature, as Server Actions bound directly to plain
 * `<form action={...}>` elements (`device-pairing-form.tsx`,
 * `pin-unlock-screen.tsx`, `merchant-session-chrome.tsx`) — same
 * zero-client-JS pattern as `apps/web/features/onboarding/commit-region-action.ts`.
 * `lockDeviceAction` is the one exception called imperatively (from
 * `use-auto-lock.ts`).
 *
 * TASKS.md 8.1/8.2 REWRITE: every call here is now a real round trip to
 * `apps/api/src/modules/devices` (`POST /api/devices/pair`,
 * `POST /api/devices/unlock`), through `apiFetch` exactly like every other
 * live feature in this app — the only difference is the `Authorization`
 * header carries this DEVICE's own bearer credential (from the `yt_device`
 * cookie), never a person's session token. No mock branch, no local PIN
 * hashing, no in-process rate-limit counter: the server owns all of that
 * now (argon2id, a real 5-attempts/15-minute lockout, TASKS.md 8.1.a).
 *
 * Every failure path redirects back to `/merchant/pair` (or `/merchant`)
 * with an `?error=<code>` query param rather than throwing, so a mistyped
 * code or PIN degrades to "try again" copy, never a 500 — a Server Action
 * bound to a plain `<form>` (no `useActionState`) has no other channel back
 * to the page.
 */

const pairingFormSchema = z.object({ pairingCode: z.string().min(1) });

export async function submitPairingCode(formData: FormData): Promise<void> {
  const parsed = pairingFormSchema.safeParse({ pairingCode: formData.get("pairingCode") });
  if (!parsed.success) {
    redirect("/merchant/pair?error=invalid_code");
  }

  const result = await apiFetch("/api/devices/pair", pairDeviceResultSchema, {
    method: "POST",
    headers: { "idempotency-key": crypto.randomUUID() },
    body: { pairingCode: parsed.data.pairingCode },
  });
  if (!result.ok) {
    redirect("/merchant/pair?error=invalid_code");
  }

  await writeDeviceBinding({
    deviceId: result.data.deviceId,
    credential: result.data.credential,
    pairedAt: new Date().toISOString(),
  });
  // Pairing this device is also, reasonably, its first unlock — staff who
  // just typed the code should not have to immediately set a PIN too (the
  // PIN itself was already chosen in Studio when the code was generated).
  await markUnlocked();
  redirect("/merchant");
}

const unlockFormSchema = z.object({ pin: z.string().min(1) });

export async function unlockWithPin(formData: FormData): Promise<void> {
  const binding = await readDeviceBinding();
  if (!binding) {
    // Not paired (or the cookie was cleared out from under this request,
    // e.g. by a revocation elsewhere) — nothing to unlock against.
    redirect("/merchant/pair");
  }

  const parsed = unlockFormSchema.safeParse({ pin: formData.get("pin") });
  if (!parsed.success) {
    redirect("/merchant?error=wrong_pin");
  }

  const result = await apiFetch("/api/devices/unlock", unlockDeviceResultSchema, {
    method: "POST",
    headers: { authorization: `Bearer ${binding.credential}` },
    body: { pin: parsed.data.pin },
  });

  if (!result.ok) {
    // `invalid_device_credential` (401) means THIS credential is unknown or
    // revoked — the one case that un-pairs the browser rather than just
    // showing "wrong PIN" (`store-device-principal-resolver.ts`). Every
    // other failure (`pin_incorrect`, `device_locked`, or anything else)
    // stays on the unlock screen.
    if (result.error.kind === "http" && result.error.code === "invalid_device_credential") {
      await clearDeviceBinding();
      redirect("/merchant/pair?error=revoked");
    }
    const errorCode =
      result.error.kind === "http" && result.error.code === "device_locked"
        ? "too_many_attempts"
        : "wrong_pin";
    redirect(`/merchant?error=${errorCode}`);
  }

  // Region closes TASKS.md 8.1's device-info gap (device-binding-schema.ts's
  // own doc comment) — re-write the LONG-LIVED binding, not just the 5-minute
  // unlock cookie, so the chrome's locale stays correct across "Lock now"
  // and auto-lock too, not only until this unlock cookie expires.
  await writeDeviceBinding({ ...binding, region: result.data.region });
  await markUnlocked();
  redirect("/merchant");
}

/**
 * Locks the current shift's session. Called both by the zero-JS "Lock now"
 * form in `merchant-session-chrome.tsx` and imperatively by
 * `use-auto-lock.ts` on inactivity or the tab going hidden. Deliberately
 * does NOT clear the device binding — locking is reversible by any staff
 * member who knows the PIN; only a revoked credential (caught by
 * `unlockWithPin` above, or any counter call 401ing) un-pairs the device.
 */
export async function lockDeviceAction(): Promise<void> {
  await markLocked();
  redirect("/merchant");
}
