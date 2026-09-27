import { eq } from "drizzle-orm";
import { currencySchema } from "@yourtal/contracts/money/value";
import { regionSchema } from "@yourtal/contracts/region";
import { businessAccounts } from "../../business/persistence/schema/business-account.table";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type {
  BusinessRegionAndCurrency,
  BusinessRegionLookup,
} from "../../store/persistence/business-region-lookup";

/**
 * A standalone copy of `store/persistence/drizzle-business-region-lookup.ts`
 * — same reasoning as `business/crypto/opaque-token.ts`'s own duplication
 * comment: importing `StoreModule` here (for its `BUSINESS_REGION_LOOKUP`
 * export) would close a module-import cycle, since `StoreModule` imports
 * `AuthzModule`, which imports THIS module for 8.1.b's real device
 * credential verifier. The interface (`BusinessRegionLookup`, a plain type)
 * is shared; only the NestJS module boundary is not.
 */
export class DevicesBusinessRegionLookup implements BusinessRegionLookup {
  constructor(private readonly db: AppDb) {}

  async findRegionAndCurrency(businessId: string): Promise<BusinessRegionAndCurrency | null> {
    const [row] = await this.db
      .select({ region: businessAccounts.region, currency: businessAccounts.currency })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessId))
      .limit(1);
    if (row === undefined) return null;
    return { region: regionSchema.parse(row.region), currency: currencySchema.parse(row.currency) };
  }
}
