import * as z from "zod";
import { regionSchema } from "../region/region";

/**
 * TASKS.md 8.1.a: a counter device is its own principal (`store_device`,
 * docs/17 section 2.2), never a person's account. This file is the client
 * (Studio) view of one — never the credential secret or the PIN hash, which
 * never leave `apps/api/src/modules/devices`.
 */

export const counterDeviceStateSchema = z.enum(["pending", "paired", "revoked"]);
export type CounterDeviceState = z.infer<typeof counterDeviceStateSchema>;

export const counterDeviceSchema = z.object({
  id: z.uuid(),
  businessId: z.uuid(),
  region: regionSchema,
  locationId: z.uuid(),
  label: z.string().min(1),
  state: counterDeviceStateSchema,
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
  pairedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});
export type CounterDevice = z.infer<typeof counterDeviceSchema>;

/** Studio -> Team -> Devices: `POST /api/:tenantId/studio/devices`. */
export const provisionDeviceRequestSchema = z.object({
  locationId: z.uuid(),
  label: z.string().min(1).max(80),
  /** Plaintext, once — the use-case hashes it with argon2id before it is stored. */
  pin: z.string().regex(/^\d{4,8}$/u, "a PIN is 4 to 8 digits"),
});
export type ProvisionDeviceRequest = z.infer<typeof provisionDeviceRequestSchema>;

/**
 * The one-time pairing code is returned ONLY from provisioning, shown to
 * whoever is standing at the till entering it into the device — never
 * stored anywhere but as `pairing_code_hash`, and never returned again by
 * any later read.
 */
export const provisionDeviceResultSchema = z.object({
  device: counterDeviceSchema,
  pairingCode: z.string().min(1),
  pairingExpiresAt: z.iso.datetime(),
});
export type ProvisionDeviceResult = z.infer<typeof provisionDeviceResultSchema>;

/** The public, rate-limited, single-use pairing call: `POST /api/devices/pair`. */
export const pairDeviceRequestSchema = z.object({ pairingCode: z.string().min(1) });
export type PairDeviceRequest = z.infer<typeof pairDeviceRequestSchema>;

/**
 * Returned exactly once. `credential` is the bearer secret the device must
 * store itself (only its sha256 is kept server-side); there is no later
 * endpoint that can hand it out again — a lost credential means re-pairing
 * through a fresh code, not a recovery flow.
 */
export const pairDeviceResultSchema = z.object({
  deviceId: z.uuid(),
  credential: z.string().min(1),
});
export type PairDeviceResult = z.infer<typeof pairDeviceResultSchema>;

/**
 * `POST /api/devices/unlock` — the device already authenticated itself with
 * its credential (`Authorization: Bearer`); this just proves the human
 * standing at it knows the shared PIN. 5 wrong attempts locks it for 15
 * minutes (TASKS.md 8.1.a), the same shape `identity`'s login throttling
 * uses for a password.
 */
export const unlockDeviceRequestSchema = z.object({ pin: z.string().min(1) });
export type UnlockDeviceRequest = z.infer<typeof unlockDeviceRequestSchema>;

/**
 * `region`/`label`/`locationName` (requested by B, 8.1.a): the counter has
 * no other source for its own locale/currency display or which physical
 * store it is at — nothing about the caller's own session names either,
 * since there is no session (`store_device`, not a person).
 */
export const unlockDeviceResultSchema = z.object({
  unlocked: z.literal(true),
  region: regionSchema,
  label: z.string().min(1),
  locationId: z.uuid(),
  locationName: z.string().min(1),
});
export type UnlockDeviceResult = z.infer<typeof unlockDeviceResultSchema>;
