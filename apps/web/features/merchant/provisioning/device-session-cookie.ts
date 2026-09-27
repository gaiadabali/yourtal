import "server-only";
// YT-0589: importing this file from a client graph is a build failure, not
// a review catch. See apps/web/features/README-server-only.md.

import { cookies } from "next/headers";
import { deviceBindingSchema, type DeviceBinding } from "./device-binding-schema";

/**
 * The counter device's real session, backed by `POST /api/devices/pair`'s
 * bearer credential (TASKS.md 8.1.a/8.2.b). `DEVICE_COOKIE` is named
 * `yt_device` to match `apps/web/proxy.ts`'s own coarse presence check
 * (Area A's edge redirect to `/merchant/pair`) — same name, same cookie,
 * never two sources of truth about whether this browser is paired.
 *
 * Two separate cookies, two separate lifetimes, same reasoning this file
 * has always used:
 *  - `DEVICE_COOKIE` — "has this browser been paired at all?" Long-lived
 *    (1 year, docs/17 §2.2's "long-lived refresh credential").
 *  - `UNLOCK_COOKIE` — "is this shift's PIN unlock still in effect?" A short
 *    ceiling (5 minutes) as a hard backstop even if `use-auto-lock.ts`'s
 *    client-side listener fails to fire — the real, fast lock path is still
 *    that listener calling `lockDeviceAction` immediately on inactivity or
 *    the tab going hidden.
 *
 * Unlocking is a CLIENT-SIDE UX lock only — it never substitutes for the
 * bearer credential, which is presented on every single device-authenticated
 * call (`counter-redemption-data.ts`) regardless of whether this shift
 * happens to be "unlocked". A revoked credential is caught the moment ANY
 * such call 401s, not by anything read here.
 *
 * SERVER-ONLY: value-imports `next/headers` (throws in the browser) and the
 * full `zod` (via `device-binding-schema.ts`). No "use client" file may
 * import this module — only `provisioning-actions.ts` (`"use server"`) and
 * Server Components (`page.tsx`, `pin-unlock-screen.tsx`,
 * `merchant-session-chrome.tsx`, and `app/(merchant)/layout.tsx`, which
 * reads `locale` for `lang`).
 */
const DEVICE_COOKIE = "yt_device";
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
 * paired": show the pairing form again rather than crash the page. This is
 * also the enforcement half of D16 (8.2.f): a hand-made or unsigned cookie
 * value fails `safeParse` (it is not valid base64url JSON matching the
 * schema) exactly like a missing one, and the real credential inside a
 * genuine cookie is verified again, for real, by the API on every call —
 * this function alone grants nothing.
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

/**
 * Writes the device binding cookie — the one moment a device is "paired."
 * Only `submitPairingCode` calls this. `secure` follows
 * `session-cookies.ts`'s own convention: skipped outside production,
 * where every dev/staging server this actually needs to run against is
 * still plain HTTP.
 */
export async function writeDeviceBinding(binding: DeviceBinding): Promise<void> {
  const store = await cookies();
  store.set(DEVICE_COOKIE, encodeBinding(binding), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/merchant",
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
  });
}

/** Un-pairs this browser entirely — used when a device-authenticated call 401s (revoked or unknown credential). Also clears the unlock cookie: an un-paired device is never "unlocked." */
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
    secure: process.env.NODE_ENV === "production",
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
