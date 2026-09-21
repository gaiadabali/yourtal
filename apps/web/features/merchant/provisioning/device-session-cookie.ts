import "server-only";
// YT-0589: the enforcement this module's doc comment says does not exist.
// Importing this file from a client graph is now a BUILD FAILURE rather
// than a review catch. See apps/web/features/README-server-only.md.

import { cookies } from "next/headers";
import { deviceBindingSchema, type DeviceBinding } from "./device-binding-schema";

/**
 * The counter device's actual "session", per docs/17-surfaces-and-roles.md
 * section 2.2: "Device sessions, not personal accounts... a long-lived
 * refresh credential on that device only." A cookie is a much closer model
 * of that than `localStorage` would be: it is httpOnly (client JS,
 * including a compromised third-party script in the page, can never read
 * it), it is sent automatically on every request so a Server Component can
 * make the provisioned/locked/unlocked decision before rendering anything,
 * and it is the one storage mechanism `apps/web/features/region/get-region.ts`
 * and `apps/web/features/onboarding/commit-region-action.ts` already use for
 * exactly this "server-resolved, client-opaque" shape — this file mirrors
 * their pattern deliberately rather than inventing a second one.
 *
 * Two separate cookies, two separate lifetimes, because they answer two
 * different questions:
 *  - `DEVICE_COOKIE` — "has this browser been paired to a merchant at all?"
 *    Long-lived (1 year), matching "long-lived refresh credential."
 *  - `UNLOCK_COOKIE` — "is this shift's PIN unlock still in effect?" Short
 *    ceiling (5 minutes) as a hard backstop even if a client-side auto-lock
 *    listener fails to fire (`use-auto-lock.ts`) — the real, fast lock path
 *    is still that client-side listener calling `lockDeviceAction`
 *    immediately on inactivity or the tab going hidden, not this cookie's
 *    expiry.
 *
 * SERVER-ONLY: value-imports `next/headers` (throws in the browser) and
 * `device-binding-schema.ts` (full `zod`). No "use client" file may import
 * this module — only `provisioning-actions.ts` (`"use server"`) and Server
 * Components (`page.tsx`, `device-provisioning-form.tsx`,
 * `pin-unlock-screen.tsx`, `merchant-session-chrome.tsx`,
 * `app/(merchant)/merchant/devices/page.tsx`). The repo has no `server-only`
 * package installed to enforce this at build time (same gap
 * `get-region.ts` notes); this comment is the only guard until one is
 * added.
 */
const DEVICE_COOKIE = "yourtal-merchant-device";
const UNLOCK_COOKIE = "yourtal-merchant-unlocked";

const DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
const UNLOCK_COOKIE_MAX_AGE_SECONDS = 60 * 5;

function encodeBinding(binding: DeviceBinding): string {
  return Buffer.from(JSON.stringify(binding), "utf8").toString("base64url");
}

function decodeBinding(raw: string): unknown {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
}

/**
 * Reads and validates the device binding cookie. Never throws — a missing,
 * corrupt, truncated or schema-invalid cookie all resolve to `null`, which
 * `merchant-data.ts`'s `getMerchantDevice()` treats identically to "never
 * provisioned": show the provisioning form again rather than crash the
 * page.
 */
export async function readDeviceBinding(): Promise<DeviceBinding | null> {
  try {
    const store = await cookies();
    const raw = store.get(DEVICE_COOKIE)?.value;
    if (!raw) {
      return null;
    }
    const parsed = deviceBindingSchema.safeParse(decodeBinding(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Writes the device binding cookie — the one moment a device is "paired." Only `submitProvisioningCode` calls this. */
export async function writeDeviceBinding(binding: DeviceBinding): Promise<void> {
  const store = await cookies();
  store.set(DEVICE_COOKIE, encodeBinding(binding), {
    httpOnly: true,
    sameSite: "lax",
    path: "/merchant",
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
  });
}

/**
 * Un-pairs this browser entirely — used when a device is found to be
 * revoked (`getMerchantDevice()`) and by `revokeDeviceAction` when the
 * device being revoked from `/merchant/devices` is this same browser.
 * Also clears the unlock cookie: an un-paired device is never "unlocked."
 */
export async function clearDeviceBinding(): Promise<void> {
  const store = await cookies();
  store.delete(DEVICE_COOKIE);
  store.delete(UNLOCK_COOKIE);
}

/** Whether this shift's PIN unlock is still in effect. */
export async function isDeviceUnlocked(): Promise<boolean> {
  const store = await cookies();
  return store.get(UNLOCK_COOKIE)?.value === "1";
}

/** Set by `unlockWithPin` on a correct PIN. */
export async function markUnlocked(): Promise<void> {
  const store = await cookies();
  store.set(UNLOCK_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/merchant",
    maxAge: UNLOCK_COOKIE_MAX_AGE_SECONDS,
  });
}

/** Set by `lockDeviceAction` — manual "Lock now", auto-lock on inactivity, or auto-lock on the tab going hidden. Immediate: the very next request sees the device as locked. */
export async function markLocked(): Promise<void> {
  const store = await cookies();
  store.delete(UNLOCK_COOKIE);
}
