import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { LISTING_REPOSITORY } from "./persistence/listing.repository";
import type { ListingRepository } from "./persistence/listing.repository";
import { merchantLocations } from "./persistence/schema/listing.table";

/**
 * 7.4.d/7.4.e, reopened: the catalogue must use a SIGNED-IN caller's own
 * region and age band, never a query param it also happened to send. Real
 * sessions (`session-for.ts`), real Postgres, real HTTP.
 */
let app: NestFastifyApplication;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
// 12.2.b's teen-catalogue confirmation registers a 13-17 account -- forced
// on for this suite's OWN moduleRef only, same isolated-container reasoning
// `guardian-consent.e2e.test.ts` documents, restored in `afterAll`.
const originalTeenAccounts = process.env["TEEN_ACCOUNTS"];

beforeAll(async () => {
  process.env["TEEN_ACCOUNTS"] = "true";
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  if (originalTeenAccounts === undefined) {
    delete process.env["TEEN_ACCOUNTS"];
  } else {
    process.env["TEEN_ACCOUNTS"] = originalTeenAccounts;
  }
});

/**
 * One merchant per run, and every list read is narrowed to it with `brand`:
 * other suites leave listings in the shared test database, and a malformed
 * one on the first page would fail this file for reasons it does not test.
 */
const RUN_MERCHANT: string = randomUUID();

async function seedListing(region: "AU" | "ID", audience: "all_ages" | "adult" | "teen") {
  const listings = app.get<ListingRepository>(LISTING_REPOSITORY);
  const merchantId = RUN_MERCHANT;
  const [location] = await db
    .insert(merchantLocations)
    .values({
      id: randomUUID(),
      merchantId,
      name: "Catalogue Scope Test Outlet",
      address: "1 Test St",
      district: "Testville",
    })
    .returning();
  if (location === undefined) throw new Error("failed to seed a merchant_location row");

  return listings.create(merchantId, {
    merchantName: "Catalogue Scope Test Merchant",
    title: `Catalogue scope probe ${region}/${audience}/${randomUUID()}`,
    description: "Exercises the 7.4.d region/audience wall.",
    category: "retail",
    locationIds: [location.id],
    currency: region === "AU" ? "AUD" : "IDR",
    faceValueMinor: 10_000,
    settlementValueMinor: 3_000,
    stockTotal: 5,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    region,
    audience,
    contentCategory: "food-and-drink",
    imageUrl: "https://cdn.example.com/listing.jpg",
    channel: "in_store",
    partialRedemption: "single_use",
    minimumSpendMinor: null,
    expiresAt: "2027-01-01T00:00:00.000Z",
    status: "available",
    perUserLimit: undefined,
  });
}

describe("the public catalogue reads a signed-in caller's own region and audience", () => {
  it("an ID user sees nothing AU through list or get, even asking for ?region=AU", async () => {
    const auAdultListing = await seedListing("AU", "all_ages");
    const idUser = await sessionFor(app, { jurisdiction: "ID" });

    const list = await app.inject({
      method: "GET",
      url: `/api/store/listings?region=AU&brand=${RUN_MERCHANT}`,
      headers: { cookie: idUser.cookie },
    });
    expect(list.statusCode).toBe(200);
    const ids = list.json<{ data: { id: string }[] }>().data.map((row) => row.id);
    expect(ids).not.toContain(auAdultListing.id);

    const get = await app.inject({
      method: "GET",
      url: `/api/store/listings/${auAdultListing.id}?region=AU`,
      headers: { cookie: idUser.cookie },
    });
    expect(get.statusCode).toBe(404);
  });

  it("an AU adult sees an adult listing that an anonymous visitor (region=AU) does not", async () => {
    const auAdultOnlyListing = await seedListing("AU", "adult");
    const auAdult = await sessionFor(app, { jurisdiction: "AU" });

    const signedInList = await app.inject({
      method: "GET",
      url: `/api/store/listings?brand=${RUN_MERCHANT}`,
      headers: { cookie: auAdult.cookie },
    });
    expect(signedInList.statusCode).toBe(200);
    const signedInIds = signedInList.json<{ data: { id: string }[] }>().data.map((row) => row.id);
    expect(signedInIds).toContain(auAdultOnlyListing.id);

    const signedInGet = await app.inject({
      method: "GET",
      url: `/api/store/listings/${auAdultOnlyListing.id}`,
      headers: { cookie: auAdult.cookie },
    });
    expect(signedInGet.statusCode).toBe(200);

    const anonymousList = await app.inject({
      method: "GET",
      url: `/api/store/listings?region=AU&brand=${RUN_MERCHANT}`,
    });
    expect(anonymousList.statusCode).toBe(200);
    const anonymousIds = anonymousList.json<{ data: { id: string }[] }>().data.map((row) => row.id);
    expect(anonymousIds).not.toContain(auAdultOnlyListing.id);

    const anonymousGet = await app.inject({
      method: "GET",
      url: `/api/store/listings/${auAdultOnlyListing.id}?region=AU`,
    });
    expect(anonymousGet.statusCode).toBe(404);
  });

  it("an anonymous request with no region at all is a 400, not a silent default", async () => {
    const response = await app.inject({ method: "GET", url: "/api/store/listings" });
    expect(response.statusCode).toBe(400);
  });

  // 12.2.b: "teen-appropriate vouchers only is already enforced by the
  // audience wall. Confirm it with a test; don't rebuild it." -- the same
  // 7.4.d wall this describe block already proves for region/adult, now
  // proved for a teen principal specifically.
  it("a teen sees a teen and an all_ages voucher, never an adult-only one", async () => {
    const teenListing = await seedListing("AU", "teen");
    const allAgesListing = await seedListing("AU", "all_ages");
    const adultOnlyListing = await seedListing("AU", "adult");
    const teen = await sessionFor(app, {
      jurisdiction: "AU",
      dateOfBirth: fifteenYearsAgo(),
      guardianEmail: `guardian+${randomUUID()}@example.test`,
    });

    const list = await app.inject({
      method: "GET",
      url: `/api/store/listings?brand=${RUN_MERCHANT}`,
      headers: { cookie: teen.cookie },
    });
    expect(list.statusCode).toBe(200);
    const ids = list.json<{ data: { id: string }[] }>().data.map((row) => row.id);
    expect(ids).toContain(teenListing.id);
    expect(ids).toContain(allAgesListing.id);
    expect(ids).not.toContain(adultOnlyListing.id);

    const get = await app.inject({
      method: "GET",
      url: `/api/store/listings/${adultOnlyListing.id}`,
      headers: { cookie: teen.cookie },
    });
    expect(get.statusCode).toBe(404);
  });
});

/** ISO date (`YYYY-MM-DD`) for someone who turned 15 sometime in the last year -- 1.4.b's teen band. */
function fifteenYearsAgo(): string {
  const now = new Date();
  const dob = new Date(Date.UTC(now.getUTCFullYear() - 15, now.getUTCMonth(), now.getUTCDate()));
  const iso = dob.toISOString().split("T")[0];
  if (iso === undefined) throw new Error("unreachable: toISOString always has a date part");
  return iso;
}
