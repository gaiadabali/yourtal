import { and, eq } from "drizzle-orm";
import { merchantLocations } from "../../store/persistence/schema/listing.table";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { MerchantLocationLookup } from "./merchant-location-lookup";

export class DrizzleMerchantLocationLookup implements MerchantLocationLookup {
  constructor(private readonly db: AppDb) {}

  async belongsToBusiness(locationId: string, businessId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: merchantLocations.id })
      .from(merchantLocations)
      .where(and(eq(merchantLocations.id, locationId), eq(merchantLocations.merchantId, businessId)))
      .limit(1);
    return row !== undefined;
  }
}
