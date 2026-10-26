import * as z from "zod";
import { regionSchema } from "@yourtal/contracts/region";

/**
 * What "this browser has been paired as a counter device" means, persisted
 * server-side in an httpOnly cookie (`device-session-cookie.ts`).
 *
 * TASKS.md 8.1/8.2 REWRITE: this used to carry a whole mock device profile
 * (merchant name, location, locale, currency, a client-computed PIN hash and
 * salt) because there was no real backend to ask. There is now
 * (`apps/api/src/modules/devices`, `packages/contracts/src/device/
 * counter-device.ts`): `POST /api/devices/pair` returns only `{deviceId,
 * credential}` — a bearer secret, never anything to display — and PIN
 * verification happens server-side (`POST /api/devices/unlock`, argon2id),
 * so no PIN material of any kind belongs on this side any more. `deviceId`
 * is kept for two purposes: readable log messages, and so revocation
 * (Studio-side) doesn't require decoding the credential to know which
 * device just failed to unlock.
 *
 * `region`, `label` and `locationName` are what the counter shows and speaks
 * from: `POST /api/devices/pair` returns them with the credential (so a
 * freshly paired Indonesian counter is Indonesian from its first screen),
 * and `POST /api/devices/unlock` returns them again, which keeps them
 * correct if the device is ever re-provisioned. They are optional only for
 * a binding saved before they were kept: that one falls back to AU chrome
 * and the device id until its next PIN unlock. None of them ever decides a
 * redemption's currency, which always comes off that voucher's own lookup.
 */
export const deviceBindingSchema = z.object({
  deviceId: z.string().min(1),
  /** The bearer secret itself — sent as `Authorization: Bearer <credential>` on every device-authenticated call. Never logged, never rendered. */
  credential: z.string().min(1),
  pairedAt: z.iso.datetime(),
  region: regionSchema.optional(),
  /** The owner's name for this counter and the shop it is at, shown instead of the id. Optional: absent from a binding saved before they were kept. */
  label: z.string().min(1).optional(),
  locationName: z.string().min(1).optional(),
});

export type DeviceBinding = z.infer<typeof deviceBindingSchema>;
