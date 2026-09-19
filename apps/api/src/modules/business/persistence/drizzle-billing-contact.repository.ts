import { eq } from "drizzle-orm";
import type { BillingContact } from "@yourtal/contracts/business/billing-contact";
import type {
  BillingContactRepository,
  SetBillingContactInput,
} from "./billing-contact.repository";
import type { BusinessDb } from "./drizzle-client";
import { billingContacts } from "./schema/billing-contact.table";

/**
 * Verified against a live Postgres — YT-0552.
 * `set-billing-contact.use-case.test.ts` / `get-billing-contact.use-case.test.ts`
 * exercise `upsert` and `findByBusiness` through `business-db.test-helper.ts`'s
 * real connection; not a fake.
 */
export class DrizzleBillingContactRepository implements BillingContactRepository {
  constructor(private readonly db: BusinessDb) {}

  async upsert(input: SetBillingContactInput): Promise<BillingContact> {
    const [row] = await this.db
      .insert(billingContacts)
      .values({
        businessId: input.businessId,
        name: input.name,
        email: input.email,
        phone: input.phone,
      })
      .onConflictDoUpdate({
        target: billingContacts.businessId,
        set: { name: input.name, email: input.email, phone: input.phone, updatedAt: new Date() },
      })
      .returning();
    if (row === undefined) {
      throw new Error("upsert into billing_contacts returned no row");
    }
    return {
      businessId: row.businessId,
      name: row.name,
      email: row.email,
      phone: row.phone,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async findByBusiness(businessId: string): Promise<BillingContact | null> {
    const [row] = await this.db
      .select()
      .from(billingContacts)
      .where(eq(billingContacts.businessId, businessId))
      .limit(1);
    if (row === undefined) {
      return null;
    }
    return {
      businessId: row.businessId,
      name: row.name,
      email: row.email,
      phone: row.phone,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
