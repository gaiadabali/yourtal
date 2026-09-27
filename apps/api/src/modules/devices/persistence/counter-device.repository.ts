import type { Region } from "@yourtal/contracts/region";

/** The full row, including secrets — never returned across the HTTP boundary as-is. */
export interface CounterDeviceRow {
  readonly id: string;
  readonly businessId: string;
  readonly region: Region;
  readonly locationId: string;
  readonly label: string;
  readonly pinHash: string;
  readonly credentialHash: string | null;
  readonly pairingCodeHash: string;
  readonly pairingExpiresAt: Date;
  readonly pairedAt: Date | null;
  readonly failedPinAttempts: number;
  readonly pinLockedUntil: Date | null;
  readonly revokedAt: Date | null;
  readonly revokedBy: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
}

export interface CreateCounterDeviceInput {
  readonly businessId: string;
  readonly region: Region;
  readonly locationId: string;
  readonly label: string;
  readonly pinHash: string;
  readonly pairingCodeHash: string;
  readonly pairingExpiresAt: Date;
  readonly createdBy: string;
}

export interface CounterDeviceRepository {
  create(input: CreateCounterDeviceInput): Promise<CounterDeviceRow>;
  findById(deviceId: string): Promise<CounterDeviceRow | null>;
  listForBusiness(businessId: string): Promise<readonly CounterDeviceRow[]>;

  /** `null` if no unrevoked device exists with this id at this business — a conditional UPDATE. */
  revoke(deviceId: string, businessId: string, revokedBy: string): Promise<CounterDeviceRow | null>;

  findByPairingCodeHash(pairingCodeHash: string): Promise<CounterDeviceRow | null>;

  /**
   * Single-use, race-safe: only succeeds `WHERE paired_at IS NULL AND
   * pairing_expires_at > now()`, so two concurrent pairing attempts against
   * the same code cannot both succeed (TASKS.md 8.1.a).
   */
  pair(deviceId: string, credentialHash: string, now: Date): Promise<CounterDeviceRow | null>;

  /** `null` for a revoked or unknown credential — the 401 path (8.1.c). */
  findActiveByCredentialHash(credentialHash: string): Promise<CounterDeviceRow | null>;

  recordFailedPin(deviceId: string, lockedUntil: Date | null): Promise<void>;
  resetFailedPin(deviceId: string): Promise<void>;
}

export const COUNTER_DEVICE_REPOSITORY = Symbol("COUNTER_DEVICE_REPOSITORY");
