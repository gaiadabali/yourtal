import { eq } from "drizzle-orm";
import { businessSchema } from "@yourtal/contracts/business";
import type { Business } from "@yourtal/contracts/business";
import type { BusinessAccountRepository } from "./business-account.repository";
import type { BusinessDb } from "./drizzle-client";
import { businessAccounts } from "./schema/business-account.table";

/**
 * Verified against a live Postgres — YT-0552.
 * `create-business.use-case.test.ts` reads a row back through `findById`
 * after a real INSERT via `DrizzleBusinessOnboardingUnitOfWork` and asserts
 * it round-trips, using `business-db.test-helper.ts`'s real connection.
 */
export class DrizzleBusinessAccountRepository implements BusinessAccountRepository {
  constructor(private readonly db: BusinessDb) {}

  async findById(businessId: string): Promise<Business | null> {
    const [row] = await this.db
      .select()
      .from(businessAccounts)
      .where(eq(businessAccounts.id, businessId))
      .limit(1);
    if (row === undefined) {
      return null;
    }
    // JSONB column read through Drizzle — parsed at the boundary (13b section 3).
    return businessSchema.parse({
      id: row.id,
      legalName: row.legalName,
      displayName: row.displayName,
      district: row.district,
      roles: row.roles,
      isVerified: row.isVerified,
      logoUrl: row.logoUrl,
      region: row.region,
      currency: row.currency,
      handle: row.handle,
      coverUrl: row.coverUrl,
    });
  }
}
