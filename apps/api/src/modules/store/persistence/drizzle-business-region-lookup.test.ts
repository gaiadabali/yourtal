import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { businessAccounts } from "../../business/persistence/schema/business-account.table";
import { testStoreDb } from "./store-db.test-helper";
import { DrizzleBusinessRegionLookup } from "./drizzle-business-region-lookup";

/**
 * Against real Postgres — TASKS.md 1.1.h. `store` and `business` are
 * separate Nest modules, but `business.business_accounts` is the same
 * physical database `yourtal_app` already has SELECT on
 * (`infra/postgres/init/01-schemas.sql`), so this is a genuine cross-schema
 * round trip rather than a mock proving the lookup calls a method.
 */
const db = testStoreDb();
const lookup = new DrizzleBusinessRegionLookup(db);

const AU_BUSINESS_ID = randomUUID();

beforeAll(async () => {
  await db.delete(businessAccounts).where(eq(businessAccounts.id, AU_BUSINESS_ID));
  await db.insert(businessAccounts).values({
    id: AU_BUSINESS_ID,
    legalName: "Wharf Espresso Pty Ltd",
    displayName: "Wharf Espresso",
    district: "Manly",
    roles: ["advertiser", "supplier"],
    region: "AU",
    currency: "AUD",
    handle: `wharf-espresso-${AU_BUSINESS_ID.slice(0, 8)}`,
  });
});

describe("DrizzleBusinessRegionLookup", () => {
  it("reads a business's own region and currency", async () => {
    expect(await lookup.findRegionAndCurrency(AU_BUSINESS_ID)).toEqual({
      region: "AU",
      currency: "AUD",
    });
  });

  it("returns null for a business that does not exist", async () => {
    expect(await lookup.findRegionAndCurrency(randomUUID())).toBeNull();
  });
});
