import { and, eq, sql } from "drizzle-orm";
import { regionSchema } from "@yourtal/contracts/region";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { counterDevices } from "./schema/counter-device.table";
import type {
  CounterDeviceRepository,
  CounterDeviceRow,
  CreateCounterDeviceInput,
} from "./counter-device.repository";

function toRow(row: typeof counterDevices.$inferSelect): CounterDeviceRow {
  return {
    id: row.id,
    businessId: row.businessId,
    region: regionSchema.parse(row.region),
    locationId: row.locationId,
    label: row.label,
    pinHash: row.pinHash,
    credentialHash: row.credentialHash,
    pairingCodeHash: row.pairingCodeHash,
    pairingExpiresAt: row.pairingExpiresAt,
    pairedAt: row.pairedAt,
    failedPinAttempts: row.failedPinAttempts,
    pinLockedUntil: row.pinLockedUntil,
    revokedAt: row.revokedAt,
    revokedBy: row.revokedBy,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export class DrizzleCounterDeviceRepository implements CounterDeviceRepository {
  constructor(private readonly db: AppDb) {}

  async create(input: CreateCounterDeviceInput): Promise<CounterDeviceRow> {
    const [row] = await this.db
      .insert(counterDevices)
      .values({
        businessId: input.businessId,
        region: input.region,
        locationId: input.locationId,
        label: input.label,
        pinHash: input.pinHash,
        pairingCodeHash: input.pairingCodeHash,
        pairingExpiresAt: input.pairingExpiresAt,
        createdBy: input.createdBy,
      })
      .returning();
    if (row === undefined) {
      throw new Error("insert into store.counter_device returned no row");
    }
    return toRow(row);
  }

  async findById(deviceId: string): Promise<CounterDeviceRow | null> {
    const [row] = await this.db
      .select()
      .from(counterDevices)
      .where(eq(counterDevices.id, deviceId))
      .limit(1);
    return row === undefined ? null : toRow(row);
  }

  async listForBusiness(businessId: string): Promise<readonly CounterDeviceRow[]> {
    const rows = await this.db
      .select()
      .from(counterDevices)
      .where(eq(counterDevices.businessId, businessId));
    return rows.map(toRow);
  }

  async revoke(
    deviceId: string,
    businessId: string,
    revokedBy: string,
  ): Promise<CounterDeviceRow | null> {
    const [row] = await this.db
      .update(counterDevices)
      .set({ revokedAt: new Date(), revokedBy })
      .where(
        and(
          eq(counterDevices.id, deviceId),
          eq(counterDevices.businessId, businessId),
          sql`${counterDevices.revokedAt} IS NULL`,
        ),
      )
      .returning();
    return row === undefined ? null : toRow(row);
  }

  async findByPairingCodeHash(pairingCodeHash: string): Promise<CounterDeviceRow | null> {
    const [row] = await this.db
      .select()
      .from(counterDevices)
      .where(eq(counterDevices.pairingCodeHash, pairingCodeHash))
      .limit(1);
    return row === undefined ? null : toRow(row);
  }

  /** Single statement, single-use: two racing pairing attempts cannot both win (8.1.a). */
  async pair(deviceId: string, credentialHash: string, now: Date): Promise<CounterDeviceRow | null> {
    const [row] = await this.db
      .update(counterDevices)
      .set({ credentialHash, pairedAt: now })
      .where(
        and(
          eq(counterDevices.id, deviceId),
          sql`${counterDevices.pairedAt} IS NULL`,
          sql`${counterDevices.pairingExpiresAt} > ${now.toISOString()}`,
          sql`${counterDevices.revokedAt} IS NULL`,
        ),
      )
      .returning();
    return row === undefined ? null : toRow(row);
  }

  async findActiveByCredentialHash(credentialHash: string): Promise<CounterDeviceRow | null> {
    const [row] = await this.db
      .select()
      .from(counterDevices)
      .where(
        and(
          eq(counterDevices.credentialHash, credentialHash),
          sql`${counterDevices.revokedAt} IS NULL`,
        ),
      )
      .limit(1);
    return row === undefined ? null : toRow(row);
  }

  async recordFailedPin(deviceId: string, lockedUntil: Date | null): Promise<void> {
    await this.db
      .update(counterDevices)
      .set({
        failedPinAttempts: sql`${counterDevices.failedPinAttempts} + 1`,
        pinLockedUntil: lockedUntil,
      })
      .where(eq(counterDevices.id, deviceId));
  }

  async resetFailedPin(deviceId: string): Promise<void> {
    await this.db
      .update(counterDevices)
      .set({ failedPinAttempts: 0, pinLockedUntil: null })
      .where(eq(counterDevices.id, deviceId));
  }
}
