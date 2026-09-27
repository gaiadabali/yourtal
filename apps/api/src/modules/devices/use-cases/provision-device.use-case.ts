import { errAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import { hash as argon2Hash } from "@node-rs/argon2";
import type { Region } from "@yourtal/contracts/region";
import type { ProvisionDeviceError } from "../devices.errors";
import type {
  CounterDeviceRepository,
  CounterDeviceRow,
} from "../persistence/counter-device.repository";
import type { MerchantLocationLookup } from "../persistence/merchant-location-lookup";
import { issuePairingCode } from "../crypto/device-token";
import { wrapPersistence } from "../wrap-persistence";

const PAIRING_TTL_MS = 15 * 60 * 1000; // TASKS.md 8.1.a.

export interface ProvisionDeviceInput {
  readonly businessId: string;
  readonly region: Region;
  readonly locationId: string;
  readonly label: string;
  readonly pin: string;
  readonly createdBy: string;
}

export interface ProvisionDeviceOutcome {
  readonly device: CounterDeviceRow;
  readonly pairingCode: string;
  readonly pairingExpiresAt: Date;
}

export function provisionDevice(
  devices: CounterDeviceRepository,
  locations: MerchantLocationLookup,
  input: ProvisionDeviceInput,
): ResultAsync<ProvisionDeviceOutcome, ProvisionDeviceError> {
  return wrapPersistence(locations.belongsToBusiness(input.locationId, input.businessId)).andThen(
    (owned) => {
      if (!owned) {
        return errAsync<ProvisionDeviceOutcome, ProvisionDeviceError>({
          type: "location_not_found",
          locationId: input.locationId,
        });
      }
      return wrapPersistence(
        (async () => {
          const pinHash = await argon2Hash(input.pin);
          const pairing = issuePairingCode();
          const pairingExpiresAt = new Date(Date.now() + PAIRING_TTL_MS);
          const device = await devices.create({
            businessId: input.businessId,
            region: input.region,
            locationId: input.locationId,
            label: input.label,
            pinHash,
            pairingCodeHash: pairing.hash,
            pairingExpiresAt,
            createdBy: input.createdBy,
          });
          return { device, pairingCode: pairing.secret, pairingExpiresAt };
        })(),
      );
    },
  );
}
