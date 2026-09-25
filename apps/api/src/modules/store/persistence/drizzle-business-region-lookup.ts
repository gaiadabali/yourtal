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
// `business_accounts.id` is `uuid` at the DB layer; a non-UUID string is
// unambiguously "no such business", never a query worth sending. 1.5.b
// started calling this from PdpGuard for EVERY tenant-scoped request,
// before any route's own body/param validation has run — unlike this
// port's original 1.1.h call site, a caller here cannot promise the id
// shape has already been checked, and Postgres's own `invalid input syntax
// for type uuid` for a bad one is a 500, not the clean "not found" this
// method's own contract already promises.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export class DrizzleBusinessRegionLookup implements BusinessRegionLookup {
  constructor(private readonly db: AppDb) {}

  async findRegionAndCurrency(businessId: string): Promise<BusinessRegionAndCurrency | null> {
    if (!UUID_PATTERN.test(businessId)) return null;

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
