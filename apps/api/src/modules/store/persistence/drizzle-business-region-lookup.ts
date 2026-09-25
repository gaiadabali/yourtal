import { eq } from "drizzle-orm";
import { currencySchema } from "@yourtal/contracts/money/value";
import { regionSchema } from "@yourtal/contracts/region";
import { businessAccounts } from "../../business/persistence/schema/business-account.table";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { BusinessRegionAndCurrency, BusinessRegionLookup } from "./business-region-lookup";

/**
 * A plain cross-schema SELECT, not a call into the business module's own
 * repository — see `business-region-lookup.ts`'s header for why a port
 * exists at all. `businessAccounts` is imported only for its column
 * definitions; nothing here writes to it.
 */
export class DrizzleBusinessRegionLookup implements BusinessRegionLookup {
  constructor(private readonly db: AppDb) {}

  async findRegionAndCurrency(businessId: string): Promise<BusinessRegionAndCurrency | null> {
    const [row] = await this.db
      .select({ region: businessAccounts.region, currency: businessAccounts.currency })
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessId))
      .limit(1);
    if (row === undefined) return null;
    // Columns are plain `text` at the DB layer (TASKS.md 1.1.a); parsed here
    // rather than trusted, the same boundary-parse discipline every other
    // row assembler in this codebase follows.
    return { region: regionSchema.parse(row.region), currency: currencySchema.parse(row.currency) };
  }
}
