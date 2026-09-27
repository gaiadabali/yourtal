import { z } from "zod";

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
 * There is currently no endpoint for a paired device to fetch its own
 * label/location/currency/locale (see `merchant-i18n.ts`'s doc comment) —
 * `(requested by B)` on TASKS.md 8.1 asks for one. Until it exists, the
 * portal's chrome copy defaults to `en-AU` (never affects a redemption's
 * currency, which always comes fresh off that voucher's own lookup
 * response).
 */
export const deviceBindingSchema = z.object({
  deviceId: z.string().min(1),
  /** The bearer secret itself — sent as `Authorization: Bearer <credential>` on every device-authenticated call. Never logged, never rendered. */
  credential: z.string().min(1),
  pairedAt: z.iso.datetime(),
});

export type DeviceBinding = z.infer<typeof deviceBindingSchema>;
