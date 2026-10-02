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
 * 13.12.d Check, store half: `GET /api/store/listings` filters by tags,
 * brand and category, sorts, pages and counts on the server, in AU and ID,
 * never crossing a region or an audience. Asserts only over this file's own
 * merchants, passed as `brand`, since the database is shared.
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

interface ListingSeed {
  readonly merchantId: string;
  readonly region: "AU" | "ID";
  readonly category: "food_beverage" | "retail";
  readonly tags: string[];
  readonly settlementMinor: number;
  readonly expiresAt: string;
  readonly audience?: "all_ages" | "adult";
  readonly channel?: "in_store" | "online" | "both";
}

async function seedListing(options: ListingSeed): Promise<string> {
  const listings = app.get<ListingRepository>(LISTING_REPOSITORY);
  const [location] = await db
    .insert(merchantLocations)
    .values({
      id: randomUUID(),
      merchantId: options.merchantId,
      name: "Browse Outlet",
      address: "1 Browse St",
      district: "Browseville",
    })
    .returning();
  if (location === undefined) throw new Error("no location");
  const au = options.region === "AU";
  const listing = await listings.create(options.merchantId, {
    merchantName: `Brand ${options.merchantId.slice(0, 4)}`,
    title: `Browse probe ${randomUUID()}`,
    description: "Exercises 13.12.d.",
    category: options.category,
    locationIds: [location.id],
    currency: au ? "AUD" : "IDR",
    faceValueMinor: options.settlementMinor * 2,
    settlementValueMinor: options.settlementMinor,
    stockTotal: 5,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    region: options.region,
    audience: options.audience ?? "all_ages",
    contentCategory: "food-and-drink",
    tags: options.tags,
    imageUrl: "https://cdn.example.com/listing.jpg",
    channel: options.channel ?? "in_store",
    partialRedemption: "single_use",
    minimumSpendMinor: null,
    expiresAt: options.expiresAt,
    status: "available",
    perUserLimit: undefined,
  });
  return listing.id;
}

interface Page {
  data: { id: string; priceInPoints: number }[];
  has_more: boolean;
  total_count: number;
  facets: { categories: { value: string }[]; brands: { value: string; count: number }[] };
}

async function browse(query: string, cookie?: string): Promise<Page> {
  const response = await app.inject({
    method: "GET",
    url: `/api/store/listings?${query}`,
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });
  expect(response.statusCode).toBe(200);
  return response.json<Page>();
}

describe("13.12.d: GET /api/store/listings filters, sorts and facets", () => {
  const brandA: string = randomUUID();
  const brandB: string = randomUUID();
  const brandId: string = randomUUID();
  let cheap: string, mid: string, dear: string, adultOnly: string, idListing: string;

  beforeAll(async () => {
    cheap = await seedListing({
      ...{ merchantId: brandA, region: "AU", category: "food_beverage", tags: ["coffee"] },
      ...{ settlementMinor: 300, expiresAt: "2027-03-01T00:00:00.000Z" },
    });
    mid = await seedListing({
      ...{ merchantId: brandA, region: "AU", category: "retail", tags: ["fashion", "coffee"] },
      ...{ settlementMinor: 900, expiresAt: "2027-01-01T00:00:00.000Z" },
    });
    dear = await seedListing({
      ...{ merchantId: brandB, region: "AU", category: "food_beverage", tags: ["bakery"] },
      ...{ settlementMinor: 2_000, expiresAt: "2027-02-01T00:00:00.000Z" },
    });
    adultOnly = await seedListing({
      ...{ merchantId: brandB, region: "AU", category: "food_beverage", tags: ["coffee"] },
      ...{ settlementMinor: 500, expiresAt: "2027-02-01T00:00:00.000Z", audience: "adult" },
    });
    idListing = await seedListing({
      ...{ merchantId: brandId, region: "ID", category: "food_beverage", tags: ["coffee"] },
      ...{ settlementMinor: 30_000, expiresAt: "2027-02-01T00:00:00.000Z" },
    });
  });

  const brands = () => `brand=${brandA},${brandB},${brandId}`;
  const ids = (page: Page) => page.data.map((row) => row.id);

  it("filters by tags and brand, and counts every match", async () => {
    const coffee = await browse(`region=AU&${brands()}&tags=coffee&sort=newest`);
    expect(ids(coffee)).toEqual([mid, cheap]); // adult-only stays out for anonymous
    expect(coffee.total_count).toBe(2);
    expect(ids(await browse(`region=AU&brand=${brandB}`))).toEqual([dear]);
    expect(ids(await browse(`region=AU&${brands()}&category=retail`))).toEqual([mid]);
  });

  it("sorts by points both ways, newest and ending soon", async () => {
    const q = `region=AU&${brands()}`;
    expect(ids(await browse(`${q}&sort=points_asc`))).toEqual([cheap, mid, dear]);
    expect(ids(await browse(`${q}&sort=points_desc`))).toEqual([dear, mid, cheap]);
    expect(ids(await browse(`${q}&sort=newest`))).toEqual([dear, mid, cheap]);
    expect(ids(await browse(`${q}&sort=ending_soon`))).toEqual([mid, dear, cheap]);
    const prices = (await browse(`${q}&sort=points_asc`)).data.map((row) => row.priceInPoints);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it("pages with a cursor in the chosen sort", async () => {
    const q = `region=AU&${brands()}&sort=points_asc&limit=2`;
    const first = await browse(q);
    expect(ids(first)).toEqual([cheap, mid]);
    expect(first.has_more).toBe(true);
    expect(first.total_count).toBe(3);
    const second = await browse(`${q}&startingAfter=${mid}`);
    expect(ids(second)).toEqual([dear]);
    expect(second.has_more).toBe(false);
  });

  it("brand and category facets ignore their own filter", async () => {
    const page = await browse(`region=AU&brand=${brandA}&category=retail`);
    expect(page.facets.categories.map((facet) => facet.value)).toContain("food_beverage");
    const mine = page.facets.brands.filter((facet) => [brandA, brandB].includes(facet.value));
    expect(mine).toEqual([{ value: brandA, count: 1, label: expect.any(String) }]);
  });

  it("13.12.e: channel matches its own kind and `both`, counted and paged on the server", async () => {
    const brand: string = randomUUID();
    const seed = (channel: "in_store" | "online" | "both", settlementMinor: number) =>
      seedListing({
        ...{ merchantId: brand, region: "AU", category: "food_beverage", tags: ["coffee"] },
        ...{ settlementMinor, expiresAt: "2027-03-01T00:00:00.000Z", channel },
      });
    const shop = await seed("in_store", 100);
    const web = await seed("online", 200);
    const both = await seed("both", 300);
    const q = `region=AU&brand=${brand}&sort=points_asc`;
    const inStore = await browse(`${q}&channel=in_store`);
    expect(ids(inStore)).toEqual([shop, both]);
    expect(inStore.total_count).toBe(2);
    expect(ids(await browse(`${q}&channel=online`))).toEqual([web, both]);
    const firstPage = await browse(`${q}&channel=online&limit=1`);
    expect(ids(firstPage)).toEqual([web]);
    expect(firstPage.has_more).toBe(true);
    expect(ids(await browse(`${q}&channel=online&limit=1&startingAfter=${web}`))).toEqual([both]);
    expect(ids(await browse(q))).toEqual([shop, web, both]);
    const bad = await app.inject({ method: "GET", url: `/api/store/listings?${q}&channel=both` });
    expect(bad.statusCode).toBe(400);
  });

  it("never crosses a region or an audience", async () => {
    expect(ids(await browse(`region=ID&${brands()}&tags=coffee`))).toEqual([idListing]);
    const idViewer = await sessionFor(app, { jurisdiction: "ID" });
    expect(ids(await browse(`${brands()}&tags=coffee`, idViewer.cookie))).toEqual([idListing]);
    // Asking for the other region shows nothing, never an override.
    expect(ids(await browse(`region=AU&${brands()}`, idViewer.cookie))).toEqual([]);
    const adult = await sessionFor(app, { jurisdiction: "AU" });
    expect(new Set(ids(await browse(`${brands()}&tags=coffee`, adult.cookie)))).toEqual(
      new Set([cheap, mid, adultOnly]),
    );
  });
});
