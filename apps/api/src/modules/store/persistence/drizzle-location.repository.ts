import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { MerchantLocation } from "@yourtal/contracts/listing/merchant-location";
import { merchantLocationSchema } from "@yourtal/contracts/listing/merchant-location";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { listingLocations, merchantLocations } from "./schema/listing.table";
import type {
  CreateLocationInput,
  EditLocationInput,
  LocationRepository,
} from "./location.repository";

export class MalformedLocationRowError extends Error {
  constructor(readonly locationId: string | undefined) {
    super(`store.merchant_location row ${String(locationId)} does not match merchantLocationSchema`);
    this.name = "MalformedLocationRowError";
  }
}

function assemble(row: typeof merchantLocations.$inferSelect): MerchantLocation {
  const parsed = merchantLocationSchema.safeParse({
    id: row.id,
    name: row.name,
    address: row.address,
    district: row.district,
  });
  if (!parsed.success) throw new MalformedLocationRowError(row.id);
  return parsed.data;
}

export class DrizzleLocationRepository implements LocationRepository {
  constructor(private readonly db: AppDb) {}

  async listOwned(merchantId: string): Promise<MerchantLocation[]> {
    const rows = await this.db
      .select()
      .from(merchantLocations)
      .where(eq(merchantLocations.merchantId, merchantId))
      .orderBy(merchantLocations.createdAt);
    return rows.map(assemble);
  }

  async findOwnedById(merchantId: string, locationId: string): Promise<MerchantLocation | null> {
    const [row] = await this.db
      .select()
      .from(merchantLocations)
      .where(and(eq(merchantLocations.id, locationId), eq(merchantLocations.merchantId, merchantId)))
      .limit(1);
    return row === undefined ? null : assemble(row);
  }

  async create(merchantId: string, input: CreateLocationInput): Promise<MerchantLocation> {
    const [row] = await this.db
      .insert(merchantLocations)
      .values({ id: randomUUID(), merchantId, name: input.name, address: input.address, district: input.district })
      .returning();
    if (row === undefined) throw new Error("insert into store.merchant_location returned no row");
    return assemble(row);
  }

  async updateFields(
    merchantId: string,
    locationId: string,
    patch: EditLocationInput,
  ): Promise<MerchantLocation | null> {
    const values: Partial<typeof merchantLocations.$inferInsert> = {};
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.address !== undefined) values.address = patch.address;
    if (patch.district !== undefined) values.district = patch.district;

    if (Object.keys(values).length === 0) {
      return this.findOwnedById(merchantId, locationId);
    }

    const [row] = await this.db
      .update(merchantLocations)
      .set(values)
      .where(and(eq(merchantLocations.id, locationId), eq(merchantLocations.merchantId, merchantId)))
      .returning();
    return row === undefined ? null : assemble(row);
  }

  async archive(merchantId: string, locationId: string): Promise<"ok" | "not_found" | "in_use"> {
    const owned = await this.findOwnedById(merchantId, locationId);
    if (owned === null) return "not_found";

    const [inUse] = await this.db
      .select({ listingId: listingLocations.listingId })
      .from(listingLocations)
      .where(eq(listingLocations.locationId, locationId))
      .limit(1);
    if (inUse !== undefined) return "in_use";

    await this.db
      .delete(merchantLocations)
      .where(and(eq(merchantLocations.id, locationId), eq(merchantLocations.merchantId, merchantId)));
    return "ok";
  }
}
