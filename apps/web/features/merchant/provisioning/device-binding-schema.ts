import { z } from "zod";
import type { MerchantCurrency, MerchantLocale } from "../merchant-device";

/**
 * What "this browser has been provisioned as a counter device" actually
 * means, persisted server-side in an httpOnly cookie
 * (`device-session-cookie.ts`) rather than in `localStorage` — see that
 * file's doc comment for why a cookie is the more honest model of
 * docs/17-surfaces-and-roles.md section 2.2's "long-lived refresh
 * credential on that device only."
 *
 * SERVER-ONLY: this value-imports `zod` (the full package, not `zod/mini`)
 * deliberately — unlike `merchant-today-log.ts`, nothing here is ever read
 * from a "use client" leaf. Only `device-session-cookie.ts` (itself
 * server-only, `next/headers`) and `provisioning-actions.ts` (`"use
 * server"`) import this module, so the ~96 KB gz full-Zod runtime this
 * pulls in never reaches the client bundle — same reasoning as
 * `merchant-region-source.ts`.
 *
 * `pinHash`/`pinSalt` are the ONLY trace of the PIN that exists anywhere:
 * never the plaintext PIN itself. Even so, this record never reaches
 * client JS at all (the cookie is httpOnly — see `device-session-cookie.ts`),
 * which is a stronger guarantee than "hashed" alone: a client-side hash
 * check (comparing a computed hash in the browser) would still let anyone
 * with devtools read the stored hash and brute-force it offline at their
 * leisure, since a 4-6 digit PIN's keyspace is tiny. Keeping the hash
 * server-side and only ever comparing it in `provisioning-actions.ts`
 * closes that hole; see `pin-hash.ts` for what is and is not defended by
 * the comparison itself.
 */
const merchantLocaleValues = ["en-AU", "id-ID"] as const satisfies readonly MerchantLocale[];
const merchantCurrencyValues = ["AUD", "IDR"] as const satisfies readonly MerchantCurrency[];

export const deviceBindingSchema = z.object({
  /** Stable id for this physical device — becomes `MerchantDevice.id`, and scopes the local today-log and the mock revocation registry. */
  deviceId: z.string().min(1),
  merchantId: z.string().min(1),
  merchantName: z.string().min(1),
  /** Staff-facing name set by the Admin who generated the provisioning code, e.g. "Kemang counter 2" — never chosen by the staff member pairing the device. */
  label: z.string().min(1),
  locale: z.enum(merchantLocaleValues),
  currency: z.enum(merchantCurrencyValues),
  countryName: z.string().min(1),
  pinHash: z.string().min(1),
  pinSalt: z.string().min(1),
  provisionedAt: z.iso.datetime(),
});

export type DeviceBinding = z.infer<typeof deviceBindingSchema>;
