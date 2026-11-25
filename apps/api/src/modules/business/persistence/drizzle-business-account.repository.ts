import { eq } from "drizzle-orm";
import { businessSchema } from "@yourtal/contracts/business";
import type { Business } from "@yourtal/contracts/business";
import type {
  BusinessAccountRepository,
  UpdateChannelInput,
  UpdateChannelOutcome,
} from "./business-account.repository";
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
    return row === undefined ? null : toBusiness(row);
  }

  async updateChannel(input: UpdateChannelInput): Promise<UpdateChannelOutcome> {
    try {
      const [row] = await this.db
        .update(businessAccounts)
        .set({
          displayName: input.displayName,
          handle: input.handle,
          logoUrl: input.logoUrl,
          coverUrl: input.coverUrl,
          updatedAt: new Date(),
        })
        .where(eq(businessAccounts.id, input.businessId))
        .returning();
      return row === undefined ? null : toBusiness(row);
    } catch (error) {
      // 23505 on `business_accounts_handle_key`: someone else has the handle.
      if (pgErrorCode(error) === "23505") return "handle_taken";
      throw error;
    }
  }
}

/** The SQLSTATE sits on the error or, through Drizzle's wrapper, on its `cause`. */
function pgErrorCode(error: unknown): string | undefined {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    const code = (candidate as { code?: unknown } | null)?.code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

function toBusiness(row: typeof businessAccounts.$inferSelect): Business {
  // JSONB column read through Drizzle — parsed at the boundary (13b section 3).
  return businessSchema.parse({
    id: row.id,
    legalName: row.legalName,
    displayName: row.displayName,
    taxIdKind: row.taxIdKind,
    taxIdValue: row.taxIdValue,
    addressState: row.addressState,
    addressPostcode: row.addressPostcode,
    addressCity: row.addressCity,
    roles: row.roles,
    isVerified: row.isVerified,
    logoUrl: row.logoUrl,
    region: row.region,
    currency: row.currency,
    handle: row.handle,
    coverUrl: row.coverUrl,
  });
}
