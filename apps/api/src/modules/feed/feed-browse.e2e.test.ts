import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";

/**
 * 13.12.d Check, feed and search half: each filter and sort over HTTP, in AU
 * and ID, returns only matching rows in order, never another region's row
 * or a wrong audience's. Seeds by SQL like feed.controller.e2e.test.ts, and
 * asserts only over this file's own campaigns (the database is shared).
 */
let app: NestFastifyApplication;
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
const seeded: string[] = [];
const RUN = randomUUID().slice(0, 8);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
  if (seeded.length === 0) return;
  for (const table of ["reward_config", "terms_version", "video_source", "chapter"]) {
    await owner.execute(
      sql`DELETE FROM ${sql.raw(`campaign.${table}`)} WHERE campaign_id IN ${seeded}`,
    );
  }
  await owner.execute(sql`DELETE FROM campaign.campaigns WHERE id IN ${seeded}`);
});

interface Seed {
  readonly region: "AU" | "ID";
  readonly kind: "long_form" | "quick";
  readonly category: string;
  readonly tags: readonly string[];
  readonly audience?: "all_ages" | "adult";
  readonly publishedMinutesAgo: number;
  readonly endsInDays: number;
  readonly reward: number;
}

async function seed(options: Seed): Promise<string> {
  const id = randomUUID();
  const businessId = randomUUID();
  const duration = options.kind === "quick" ? 30 : 600;
  await db.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule, lifecycle_state,
       published_at, business_id, region, audience, content_category, poster_url,
       teaser_url, hls_url, aspect, estimated_bytes, starts_at, ends_at, open_viewing,
       teaser_start_seconds, declared_interests)
    VALUES
      (${id}, ${options.kind}, ${`Browse ${RUN} ${id}`}, ${businessId}, 'Browse e2e Merchant',
       'Exercises 13.12.d.', ${duration}, 10, ${options.reward}, 0, 'base_only', 'live',
       now() - interval '400 days' - make_interval(mins => ${options.publishedMinutesAgo}),
       ${businessId},
       ${options.region}, ${options.audience ?? "all_ages"}, ${options.category},
       'https://cdn.example.com/poster.jpg', 'https://cdn.example.com/teaser.mp4',
       'https://cdn.example.com/manifest.m3u8', '9:16', 1000000, now() - interval '1 day',
       now() + make_interval(days => ${options.endsInDays}),
       ${(options.audience ?? "all_ages") === "all_ages"}, 0,
       ${JSON.stringify(options.tags)}::jsonb)
  `);
  await db.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${id}, 'hls', 'https://cdn.example.com/manifest.m3u8')
  `);
  if (options.kind === "long_form") {
    await db.execute(sql`
      INSERT INTO campaign.chapter (campaign_id, ordinal, title, start_seconds, reward_weight)
      VALUES (${id}, 0, 'Intro', 0, 1)
    `);
  }
  await db.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule,
       duration_seconds, accuracy_bonus_points, effective_from)
    VALUES (${id}, 1, ${options.reward}, 0, 'base_only', ${duration}, 0, now())
  `);
  const allocationId = randomUUID();
  await db.execute(sql`
    INSERT INTO platform.ledger_fake_allocation
      (id, business_id, region, funder_type, currency, total_points, remaining_points)
    VALUES (${allocationId}, ${businessId}, ${options.region}, 'marketing',
            ${options.region === "AU" ? "AUD" : "IDR"}, 100000, 100000)
  `);
  await db.execute(sql`
    INSERT INTO campaign.reward_config
      (campaign_id, allocation_id, funder_type, max_points_for_campaign,
       reward_points_per_completion, accuracy_bonus_points)
    VALUES (${id}, ${allocationId}, 'marketing', 100000, ${options.reward}, 0)
  `);
  seeded.push(id);
  return id;
}

interface FeedBody {
  items: { campaignId: string }[];
  facets: { categories: { value: string; count: number }[]; tags: { value: string }[] };
}

async function feed(query: string, cookie?: string): Promise<{ ids: string[]; body: FeedBody }> {
  const response = await app.inject({
    method: "GET",
    url: `/api/feed?${query}`,
    ...(cookie === undefined ? {} : { headers: { cookie } }),
  });
  expect(response.statusCode).toBe(200);
  const body = response.json<FeedBody>();
  const mine = new Set(seeded);
  return { ids: body.items.map((i) => i.campaignId).filter((id) => mine.has(id)), body };
}

describe("13.12.d: GET /api/feed filters and sorts", () => {
  let longBooks: string, longTravel: string, quickLaundry: string, adultBooks: string;
  let idBooks: string, idQuick: string;

  beforeAll(async () => {
    longBooks = await seed({
      ...{ region: "AU", kind: "long_form", category: "books", tags: ["books", "cinema"] },
      ...{ publishedMinutesAgo: 30, endsInDays: 20, reward: 40 },
    });
    longTravel = await seed({
      ...{ region: "AU", kind: "long_form", category: "travel", tags: ["flights", "laundry"] },
      ...{ publishedMinutesAgo: 10, endsInDays: 2, reward: 20 },
    });
    quickLaundry = await seed({
      ...{ region: "AU", kind: "quick", category: "services", tags: ["laundry"] },
      ...{ publishedMinutesAgo: 20, endsInDays: 10, reward: 3 },
    });
    adultBooks = await seed({
      ...{ region: "AU", kind: "long_form", category: "books", tags: ["books"] },
      ...{ audience: "adult", publishedMinutesAgo: 5, endsInDays: 5, reward: 30 },
    });
    idBooks = await seed({
      ...{ region: "ID", kind: "long_form", category: "books", tags: ["books"] },
      ...{ publishedMinutesAgo: 15, endsInDays: 5, reward: 50 },
    });
    idQuick = await seed({
      ...{ region: "ID", kind: "quick", category: "services", tags: ["laundry"] },
      ...{ publishedMinutesAgo: 25, endsInDays: 5, reward: 4 },
    });
  });

  it("kind, category and tags filter on the server, inside the region and audience walls", async () => {
    expect((await feed("region=AU&kind=quick")).ids).toEqual([quickLaundry]);
    const long = (await feed("region=AU&kind=long_form&sort=newest")).ids;
    expect(long).toEqual([longTravel, longBooks]); // the adult-only one never reaches anonymous
    expect((await feed("region=AU&category=books")).ids).toEqual([longBooks]);
    expect(new Set((await feed("region=AU&tags=laundry,cinema")).ids)).toEqual(
      new Set([longBooks, longTravel, quickLaundry]),
    );
    expect((await feed("region=ID&tags=books")).ids).toEqual([idBooks]);
    expect((await feed("region=ID&kind=quick")).ids).toEqual([idQuick]);
  });

  it("a signed-in adult sees the adult campaign; its region still wins over the query", async () => {
    const adult = await sessionFor(app, { jurisdiction: "AU" });
    const books = (await feed("category=books&sort=newest", adult.cookie)).ids;
    expect(books).toEqual([adultBooks, longBooks]);
    expect((await feed("region=ID&tags=books", adult.cookie)).ids).toEqual([]);
    const idViewer = await sessionFor(app, { jurisdiction: "ID" });
    expect((await feed("tags=books,laundry&sort=most_points", idViewer.cookie)).ids).toEqual([
      idBooks,
      idQuick,
    ]);
  });

  it("sorts newest, most points and ending soon", async () => {
    const q = "region=AU&tags=books,laundry,cinema";
    expect((await feed(`${q}&sort=newest`)).ids).toEqual([longTravel, quickLaundry, longBooks]);
    expect((await feed(`${q}&sort=most_points`)).ids).toEqual([
      longBooks,
      longTravel,
      quickLaundry,
    ]);
    expect((await feed(`${q}&sort=ending_soon`)).ids).toEqual([
      longTravel,
      quickLaundry,
      longBooks,
    ]);
  });

  it("returns facets where each ignores its own filter", async () => {
    const { body } = await feed("region=AU&kind=long_form&category=books");
    const categories = body.facets.categories.map((facet) => facet.value);
    expect(categories).toContain("books");
    expect(categories).toContain("travel");
    expect(body.facets.tags.map((facet) => facet.value)).toContain("cinema");
    expect(body.facets.tags.map((facet) => facet.value)).not.toContain("flights");
  });

  it("refuses a free-text tag or an unknown sort", async () => {
    const bad = await app.inject({ method: "GET", url: "/api/feed?region=AU&tags=my%20words" });
    expect(bad.statusCode).toBe(400);
    const sort = await app.inject({ method: "GET", url: "/api/feed?region=AU&sort=random" });
    expect(sort.statusCode).toBe(400);
  });

  it("search narrows by kind and category, in region", async () => {
    const search = async (query: string) =>
      (await app.inject({ method: "GET", url: `/api/search?q=${RUN}&${query}` }))
        .json<{ campaigns: { campaignId: string }[] }>()
        .campaigns.map((campaign) => campaign.campaignId);
    expect(await search("region=AU&kind=quick")).toEqual([quickLaundry]);
    expect(await search("region=AU&category=books")).toEqual([longBooks]);
    expect(await search("region=ID&category=books")).toEqual([idBooks]);
  });
});
