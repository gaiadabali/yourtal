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

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

async function seedListing(region: "AU" | "ID", audience: "all_ages" | "adult") {
  const listings = app.get<ListingRepository>(LISTING_REPOSITORY);
  const merchantId = randomUUID();
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
      url: "/api/store/listings?region=AU",
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
      url: "/api/store/listings",
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
      url: "/api/store/listings?region=AU",
    });
    expect(anonymousList.statusCode).toBe(200);
    const anonymousIds = anonymousList
      .json<{ data: { id: string }[] }>()
      .data.map((row) => row.id);
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
});
