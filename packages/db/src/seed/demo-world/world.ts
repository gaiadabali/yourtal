import type pg from "pg";
import { listingSchema } from "@yourtal/contracts/listing";
import { toMinorUnits } from "@yourtal/contracts/money";
import { questionsAskedFor } from "@yourtal/contracts/question/bank";
import { ensureDemoCaptions, renderDemoVideo, stableId } from "@yourtal/media/demo-media";
import type { DemoVideo } from "@yourtal/media/demo-media";
import { publicMediaUrl } from "@yourtal/media/hls-origin";
import { hlsAssetObjectKey, posterObjectKey, teaserObjectKey } from "@yourtal/media/studio-media";
import { existingListingFacts, insertListing, priceListing } from "../staging";
import type { StagingLedgerConfig, StagingVoucherConfig } from "../staging";
import { DEMO_BRANDS, DEMO_FACTS, DEMO_LENGTHS } from "./catalogue";
import type {
  DemoBrandSpec,
  DemoCampaignSpec,
  DemoLength,
  DemoListingSpec,
  Region,
} from "./catalogue";
import { mintVouchers } from "./vouchers";

/**
 * 13.1.a: makes `catalogue.ts` real. Every row has a stable id, so a reset
 * re-run only fills what is missing; nothing here touches the ledger except
 * pricing a listing, and funding is `runDemoCampaignFunding`'s (after this).
 */
export const businessIdFor = (slug: string): string => stableId(`demo-world:business:${slug}`);
export const campaignIdFor = (slug: string, key: string): string =>
  stableId(`demo-world:campaign:${slug}:${key}`);
export const listingIdFor = (slug: string, key: string): string =>
  stableId(`demo-world:listing:${slug}:${key}`);

const QUICK_MAX_SECONDS = 60;
const VOUCHERS_PER_LISTING = 6;

/** AU addresses carry a state and postcode, ID ones a city (business_accounts_address_matches_region). */
const AU_STATE: Readonly<Record<string, readonly [string, string]>> = {
  Sydney: ["NSW", "2000"],
  Melbourne: ["VIC", "3000"],
  Brisbane: ["QLD", "4000"],
  Perth: ["WA", "6000"],
  Adelaide: ["SA", "5000"],
  Canberra: ["ACT", "2600"],
};

async function ensureBusiness(pool: pg.Pool, brand: DemoBrandSpec): Promise<void> {
  const au = brand.region === "AU";
  const [state, postcode] = AU_STATE[brand.city] ?? ["NSW", "2000"];
  await pool.query(
    `INSERT INTO business.business_accounts
       (id, legal_name, display_name, roles, is_verified, region, currency, handle,
        tax_id_kind, tax_id_value, address_state, address_postcode, address_city)
     VALUES ($1, $2, $2, '["advertiser","redeemer"]'::jsonb, true, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (id) DO NOTHING`,
    [
      businessIdFor(brand.slug),
      brand.name,
      brand.region,
      au ? "AUD" : "IDR",
      brand.slug.replace(/^(au|id)-/, ""),
      au ? "ABN" : "NPWP",
      au ? "51824753556" : "012345678901234",
      au ? state : null,
      au ? postcode : null,
      au ? null : brand.city,
    ],
  );
}

/** The shared video for one region and length: rendered once, then read back from any campaign using it. */
async function ensureVideo(
  pool: pg.Pool,
  region: Region,
  seconds: DemoLength,
  log: (message: string) => void,
): Promise<DemoVideo & { readonly captionsUrl: string }> {
  const assetId = stableId(`demo-world:video:${region}:${String(seconds)}`);
  const hlsUrl = publicMediaUrl(hlsAssetObjectKey(assetId, "index.m3u8"));
  const known = await pool.query<{ aspect: string; estimated_bytes: string }>(
    "SELECT aspect, estimated_bytes::text FROM campaign.campaigns WHERE hls_url = $1 LIMIT 1",
    [hlsUrl],
  );
  const row = known.rows[0];
  const facts = DEMO_FACTS[region];
  const timed = facts.map((text, index) => ({ at: (index + 1) / (facts.length + 1), text }));
  const captionsUrl = await ensureDemoCaptions({ assetId, durationSeconds: seconds, facts: timed });
  if (row !== undefined) {
    return {
      hlsUrl,
      posterUrl: publicMediaUrl(posterObjectKey(assetId)),
      teaserUrl: publicMediaUrl(teaserObjectKey(assetId)),
      aspect: row.aspect,
      estimatedBytes: Number(row.estimated_bytes),
      captionsUrl,
    };
  }
  log(`[demo:world] rendering the ${region} ${String(seconds)} s video`);
  const rendered = await renderDemoVideo({
    clip: DEMO_LENGTHS.indexOf(seconds) % 2 === 0 ? "bigBuckBunny" : "sintel",
    durationSeconds: seconds,
    facts: timed,
    assetId,
    teaserStartSeconds: Math.min(10, Math.floor(seconds / 4)),
  });
  return { ...rendered, captionsUrl };
}

async function ensureCampaign(
  pool: pg.Pool,
  brand: DemoBrandSpec,
  spec: DemoCampaignSpec,
  video: DemoVideo & { readonly captionsUrl: string },
): Promise<void> {
  const id = campaignIdFor(brand.slug, spec.key);
  const quick = spec.seconds <= QUICK_MAX_SECONDS;
  const questionCount = quick ? 0 : questionsAskedFor(spec.seconds);
  const now = Date.now();
  const publishedAt = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const endsAt = new Date(now + 120 * 24 * 60 * 60 * 1000).toISOString();
  const inserted = await pool.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds, estimated_data_mb,
        reward_points, question_count, scoring_rule, lifecycle_state, published_at, business_id,
        region, audience, content_category, poster_url, teaser_url, hls_url, aspect,
        estimated_bytes, starts_at, ends_at, open_viewing, teaser_start_seconds)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,10,$9,'base_only','live',$10,$4,$11,$12,$13,$14,$15,$16,$17,
             $18,$10,$19,$20,0)
     ON CONFLICT (id) DO NOTHING`,
    [
      id,
      quick ? "quick" : "long_form",
      spec.title,
      businessIdFor(brand.slug),
      brand.name,
      spec.synopsis,
      spec.seconds,
      (video.estimatedBytes / (1024 * 1024)).toFixed(2),
      questionCount,
      publishedAt,
      brand.region,
      spec.audience,
      brand.contentCategory,
      video.posterUrl,
      video.teaserUrl,
      video.hlsUrl,
      video.aspect,
      video.estimatedBytes,
      endsAt,
      // Open Viewing needs all_ages (F8); every other audience needs a sign-in.
      spec.audience === "all_ages",
    ],
  );
  // Captions arrived after some campaigns were made; fill them in either way.
  await pool.query(
    "UPDATE campaign.campaigns SET captions_url = $2 WHERE id = $1 AND captions_url IS NULL",
    [id, video.captionsUrl],
  );
  if ((inserted.rowCount ?? 0) === 0) return;

  await pool.query(
    `INSERT INTO campaign.terms_version
       (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds,
        accuracy_bonus_points, effective_from)
     VALUES ($1, 1, 10, $2, 'base_only', $3, 0, $4) ON CONFLICT DO NOTHING`,
    [id, questionCount, spec.seconds, publishedAt],
  );
  await pool.query(
    `INSERT INTO campaign.video_source (campaign_id, kind, manifest_url) VALUES ($1,'hls',$2)
     ON CONFLICT (campaign_id) DO NOTHING`,
    [id, video.hlsUrl],
  );
  if (quick) return;
  await pool.query(
    `INSERT INTO campaign.chapter (campaign_id, ordinal, title, start_seconds, reward_weight)
     VALUES ($1, 0, $2, 0, 1) ON CONFLICT DO NOTHING`,
    [id, spec.title],
  );
  await ensureQuestions(pool, id, brand.region, spec.seconds);
}

/** A bank three times the questions asked, each about a fact already shown on screen. */
async function ensureQuestions(
  pool: pg.Pool,
  campaignId: string,
  region: Region,
  seconds: number,
): Promise<void> {
  const facts = DEMO_FACTS[region];
  const prompt = region === "AU" ? "What did the video say?" : "Apa yang dikatakan video tadi?";
  const bank = Math.max(facts.length, 3 * questionsAskedFor(seconds));
  for (let index = 0; index < bank; index += 1) {
    const factIndex = index % facts.length;
    const fact = facts[factIndex] ?? "";
    const questionId = stableId(`demo-world:question:${campaignId}:${String(index)}`);
    const answerableAfter = Math.round(((factIndex + 1) / (facts.length + 1)) * seconds);
    const added = await pool.query(
      `INSERT INTO campaign.question
         (id, campaign_id, type, prompt, timer_seconds, status, pii_screen, answerable_after_seconds)
       VALUES ($1,$2,'multiple_choice',$3,30,'approved','clear',$4) ON CONFLICT (id) DO NOTHING`,
      [questionId, campaignId, prompt, answerableAfter],
    );
    if ((added.rowCount ?? 0) === 0) continue;
    // The fact plus two others, in a rotating order so the answer is not always first.
    const options = [fact, ...facts.filter((other) => other !== fact)].slice(0, 3);
    const ordered = options.map((_, i) => options[(i + index) % options.length] ?? fact);
    for (const [ordinal, label] of ordered.entries()) {
      const optionId = stableId(`demo-world:option:${questionId}:${String(ordinal)}`);
      await pool.query(
        "INSERT INTO campaign.question_option (id, question_id, label, ordinal) VALUES ($1,$2,$3,$4)",
        [optionId, questionId, label, ordinal],
      );
      if (label === fact) {
        await pool.query(
          "INSERT INTO campaign.question_answer_key (question_id, correct_option_id) VALUES ($1,$2)",
          [questionId, optionId],
        );
      }
    }
  }
}

async function ensureListing(
  pool: pg.Pool,
  ledger: StagingLedgerConfig,
  brand: DemoBrandSpec,
  spec: DemoListingSpec,
  imageUrl: string,
): Promise<string> {
  const id = listingIdFor(brand.slug, spec.key);
  if ((await existingListingFacts(pool, id)) !== null) return id;
  const currency = brand.region === "AU" ? "AUD" : "IDR";
  const settlementMinor = Math.round(spec.faceValueMinor * 0.7);
  const priced = await priceListing(ledger, {
    listingId: id,
    region: brand.region,
    currency,
    settlementMinor,
  });
  if (!priced.ok) throw new Error(`pricing ${brand.slug}/${spec.key}: ${priced.detail}`);
  const businessId = businessIdFor(brand.slug);
  await insertListing(
    pool,
    listingSchema.parse({
      id,
      merchantId: businessId,
      merchantName: brand.name,
      title: spec.title,
      description: spec.description,
      category: brand.listingCategory,
      locations: [
        {
          id: stableId(`demo-world:location:${brand.slug}:${spec.key}`),
          name: brand.name,
          address: `${brand.name}, ${brand.city}`,
          district: brand.city,
        },
      ],
      currency,
      faceValueMinor: toMinorUnits(spec.faceValueMinor),
      settlementValueMinor: toMinorUnits(settlementMinor),
      priceInPoints: priced.pricePoints,
      stockRemaining: VOUCHERS_PER_LISTING,
      stockTotal: VOUCHERS_PER_LISTING,
      transferable: true,
      partialRedemptionPolicy: "single_use_forfeit",
      minimumSpendMinor: null,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      status: "available",
      region: brand.region,
      audience: spec.audience,
      contentCategory: brand.contentCategory,
      imageUrl,
      channel: "in_store",
      partialRedemption: "single_use",
    }),
  );
  return id;
}

export interface DemoWorldCounts {
  readonly brands: number;
  readonly campaigns: number;
  readonly listings: number;
}

/** Every brand, campaign and listing in the catalogue, plus six vouchers per listing. */
export async function ensureDemoWorld(
  pool: pg.Pool,
  ledger: StagingLedgerConfig,
  voucher: StagingVoucherConfig,
  log: (message: string) => void,
): Promise<DemoWorldCounts> {
  const videos = new Map<string, DemoVideo & { readonly captionsUrl: string }>();
  let campaigns = 0;
  let listings = 0;
  for (const brand of DEMO_BRANDS) {
    await ensureBusiness(pool, brand);
    let poster = "";
    for (const spec of brand.campaigns) {
      const key = `${brand.region}:${String(spec.seconds)}`;
      let video = videos.get(key);
      if (video === undefined) {
        video = await ensureVideo(pool, brand.region, spec.seconds, log);
        videos.set(key, video);
      }
      await ensureCampaign(pool, brand, spec, video);
      if (poster === "") poster = video.posterUrl;
      campaigns += 1;
    }
    for (const spec of brand.listings) {
      const listingId = await ensureListing(pool, ledger, brand, spec, poster);
      await mintVouchers(pool, voucher, {
        listingId,
        merchantId: businessIdFor(brand.slug),
        want: VOUCHERS_PER_LISTING,
      });
      listings += 1;
    }
  }
  log(
    `[demo:world] ${String(DEMO_BRANDS.length)} brands, ${String(campaigns)} campaigns, ${String(listings)} listings`,
  );
  return { brands: DEMO_BRANDS.length, campaigns, listings };
}
