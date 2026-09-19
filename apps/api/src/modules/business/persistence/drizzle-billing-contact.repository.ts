import { eq } from "drizzle-orm";
import type { BillingContact } from "@yourtal/contracts/business/billing-contact";
import type {
  BillingContactRepository,
  SetBillingContactInput,
} from "./billing-contact.repository";
import type { BusinessDb } from "./drizzle-client";
import { billingContacts } from "./schema/billing-contact.table";

/** UNTESTED against a live Postgres — see `drizzle-client.ts`. */
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
