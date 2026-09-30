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
 * `region` closes TASKS.md 8.1's device-info gap (`(requested by B)`):
 * `POST /api/devices/unlock` now returns the device's own `region`
 * alongside `{label, locationId, locationName}` (it already loaded that
 * row to check the PIN). `region` is `undefined` from pairing until the
 * FIRST real unlock-with-PIN call succeeds — `submitPairingCode` marks a
 * freshly-paired device unlocked WITHOUT calling the unlock endpoint (no
 * PIN was ever entered to pair, only the code), so region genuinely isn't
 * known yet at that moment. `unlockWithPin` re-writes this binding with
 * the learned region on every real unlock, both filling the gap the first
 * time and keeping it correct if the device is ever re-provisioned to a
 * different region. Until it is known, the portal's chrome falls back to
 * `en-AU` (`merchant-data.ts`'s `getMerchantDevice()`) — never affects a
 * redemption's currency, which always comes fresh off that voucher's own
 * lookup response.
 */
export const deviceBindingSchema = z.object({
  deviceId: z.string().min(1),
  /** The bearer secret itself — sent as `Authorization: Bearer <credential>` on every device-authenticated call. Never logged, never rendered. */
  credential: z.string().min(1),
  pairedAt: z.iso.datetime(),
  region: regionSchema.optional(),
});

export type DeviceBinding = z.infer<typeof deviceBindingSchema>;
