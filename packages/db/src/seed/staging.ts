import { randomUUID } from "node:crypto";
import { hash as hashPassword } from "@node-rs/argon2";
import type pg from "pg";
import { businessSchema } from "@yourtal/contracts/business";
import type { Business } from "@yourtal/contracts/business";
import { campaignSchema } from "@yourtal/contracts/campaign";
import type { Campaign } from "@yourtal/contracts/campaign";
import { toPoints } from "@yourtal/contracts/money";
import {
  SERVICE_SIGNATURE_HEADER,
  signServiceRequest,
} from "@yourtal/contracts/ledger-internal/service-signature";
import { grantActionRequestSchema } from "@yourtal/contracts/ledger-internal/rewards";
import type { GrantActionRequest } from "@yourtal/contracts/ledger-internal/rewards";

/**
 * TASKS.md 2.3.e — the minimal world a reviewer needs on a fresh staging
 * database: snap-app in AU and in ID, two campaigns each on the 30s
 * fixture video, one demo login per role, and one tier-0 viewer with a
 * pending grant. The full demo world is 13.1's, much later — this is only
 * enough for `2.3.f`'s Check: log in, see the banner, release a pending
 * grant from `/dev/clock`.
 *
 * ## Why this is its own file, not `identity.ts`/`studio.ts`/etc.
 *
 * Those are per-DOMAIN files another phase's own module owns (1.3.b).
 * This is a per-ENVIRONMENT file: every table it touches is already
 * someone else's domain, but "the staging posture's own minimal seed" is
 * Area A's (2.3), so it gets one file that crosses domains on purpose
 * rather than five small edits to five owners' files.
 *
 * ## Runs once, ever, per database
 *
 * `identity.user_profile` having ANY row is "not empty" — this refuses to
 * run at all rather than trying to be idempotent column by column. A
 * database that already has a real account (or a previous run of this
 * seed) is left alone. That is also what makes a mid-run crash safe to
 * retry: nothing committed yet, so `identity.user_profile` is still empty,
 * and the next run starts clean.
 *
 * ## Real credential hashing, not a shortcut
 *
 * `hashPassword` below is the exact library `apps/api/src/modules/auth/
 * crypto/password-hash.ts` calls (`@node-rs/argon2`'s `hash()`, its own
 * OWASP-recommended defaults) — the same algorithm, deliberately not an
 * import of that file: `packages/db` cannot depend on `apps/api` (apps
 * depend on packages, never the reverse), so this seed calls the same
 * library apps/api's own module wraps, rather than reinventing a weaker
 * hash for "just a seed".
 *
 * ## The tier-0 pending grant is REAL, not the 1.2 fake
 *
 * TASKS.md 2.3.e's own text expected this to go through
 * `platform.ledger_fake_*` (1.2's fake semantics) and asked whoever built
 * it to check the real ledger and flag a mismatch if the fake path turned
 * out to be the only option. It is not: staging runs `LEDGER_MODE=live`
 * (2.1.f), so `apps/api`'s own `DATABASE_URL` role has no grant on the
 * `ledger` schema at all (docs/14 §8) — a fake-table row would sit in a
 * table the running app never reads in live mode, invisible to anyone.
 * The real ledger's `POST /v1/actions/grants` (`grantAction`,
 * `services/ledger/internal/api/earning_routes.go`) is reachable instead,
 * uses only state this same migration set already seeds unconditionally —
 * `holdback_hours_by_tier` is pre-approved for both regions
 * (`20260925193000_platform_region_setting.sql`) and the region's
 * marketing cash is funded by `seedLedger` (`seed/ledger.ts`) — and pays a
 * `goodwill` grant through the SAME business logic a real one would run,
 * rather than duplicating the reward engine's own posting rules in SQL
 * here. See `seedTierZeroPendingGrant` below for what happens when the
 * ledger is not reachable.
 */

export interface StagingSeedResult {
  readonly skipped: boolean;
  readonly businesses: number;
  readonly campaigns: number;
  readonly accounts: number;
  readonly pendingGrant: "granted" | "unreachable" | "skipped";
}

export interface StagingLedgerConfig {
  readonly baseUrl: string;
  readonly serviceSecret: string;
}

export interface SeedStagingOptions {
  /** Refuses to run without one — see `main()`'s own check for why. */
  readonly demoPassword: string;
  readonly ledger: StagingLedgerConfig;
  /** Injectable for tests; defaults to `console`. */
  readonly log?: (message: string) => void;
}

/**
 * The 30s fixture video (`packages/media/fixtures/attention-30s`), spelled
 * out here rather than imported from `@yourtal/contracts/campaign/mock` —
 * that module also defines `generateCampaign`, whose faker-seeded helpers
 * pull in `@faker-js/faker` at module scope. `@yourtal/contracts` lists it
 * as a real (non-dev) dependency, but nothing in `apps/api`'s own runtime
 * has ever needed it, so it is not necessarily present in `apps/api/
 * node_modules` on Helios (2.3.e's own build target ships this seed
 * bundled alongside `apps/api`, resolving external deps from exactly that
 * directory — see `scripts/build-service.mjs`'s header). Confirmed the
 * hard way: `node apps/api/dist/seed-staging.js` threw `ERR_MODULE_NOT_
 * FOUND '@faker-js/faker'` before this literal replaced the import.
 * `campaign.mock.ts`'s own header gives the identical reasoning for why IT
 * hardcodes this same URL instead of importing `packages/media` — this is
 * that argument applied one import further out.
 */
const MOCK_HLS_MANIFEST_URL = "http://127.0.0.1:26900/yourtal-media/hls/attention-30s/index.m3u8";

const TIMEZONE_AU = "Australia/Sydney";
const TIMEZONE_ID = "Asia/Jakarta";
/** Comfortably 18+ in either region — these are staff/demo fixtures, not an age-policy test. */
const ADULT_DOB = "1990-01-01";

const SNAP_APP_AU_ID = "00000000-0000-4000-9000-000000000001";
const SNAP_APP_ID_ID = "00000000-0000-4000-9000-000000000002";

const CAMPAIGN_IDS = {
  auOne: "00000000-0000-4000-9000-000000000101",
  auTwo: "00000000-0000-4000-9000-000000000102",
  idOne: "00000000-0000-4000-9000-000000000201",
  idTwo: "00000000-0000-4000-9000-000000000202",
} as const;

interface DemoAccountSpec {
  readonly email: string;
  readonly region: "AU" | "ID";
  readonly displayName: string;
  readonly timezone: string;
}

/** Every demo login this seed creates, one per role TASKS.md 2.3.e names. */
function demoAccounts(): readonly DemoAccountSpec[] {
  return [
    // The tier-0 viewer (default trust_tier, identity.user_profile's own
    // DEFAULT 0) that also serves as "one demo login for the viewer role" —
    // TASKS.md 2.3.e names both a plain viewer and a tier-0 pending-grant
    // viewer; a fresh account already IS tier 0, so one account is both.
    {
      email: "viewer.au@demo.yourtal.test",
      region: "AU",
      displayName: "Viewer Demo",
      timezone: TIMEZONE_AU,
    },
    {
      email: "owner.au@demo.yourtal.test",
      region: "AU",
      displayName: "Owner Demo (AU)",
      timezone: TIMEZONE_AU,
    },
    {
      email: "member.au@demo.yourtal.test",
      region: "AU",
      displayName: "Marketer Demo (AU)",
      timezone: TIMEZONE_AU,
    },
    // A business a region wall forbids the AU owner from touching needs its
    // OWN owner — an ID business with no owner would be an impossible state
    // no reviewer could actually use (seed.ts's own header names this class
    // of bug).
    {
      email: "owner.id@demo.yourtal.test",
      region: "ID",
      displayName: "Owner Demo (ID)",
      timezone: TIMEZONE_ID,
    },
    // Staff have no region of their own in this schema (identity.staff_role
    // carries none) — AU is an arbitrary, documented pick, never read for a
    // staff principal.
    {
      email: "support@demo.yourtal.test",
      region: "AU",
      displayName: "Support Demo",
      timezone: TIMEZONE_AU,
    },
    {
      email: "moderator@demo.yourtal.test",
      region: "AU",
      displayName: "Moderator Demo",
      timezone: TIMEZONE_AU,
    },
    {
      email: "risk-analyst@demo.yourtal.test",
      region: "AU",
      displayName: "Risk Analyst Demo",
      timezone: TIMEZONE_AU,
    },
    {
      email: "finance@demo.yourtal.test",
      region: "AU",
      displayName: "Finance Demo",
      timezone: TIMEZONE_AU,
    },
    {
      email: "ops@demo.yourtal.test",
      region: "AU",
      displayName: "Ops Demo",
      timezone: TIMEZONE_AU,
    },
    {
      email: "admin@demo.yourtal.test",
      region: "AU",
      displayName: "Admin Demo",
      timezone: TIMEZONE_AU,
    },
  ];
}

/** `identity.staff_role`'s own CHECK — 1.5.b/`packages/authz/src/roles.ts`'s INTERNAL_ROLES. */
const STAFF_ROLE_BY_EMAIL: Readonly<Record<string, string>> = {
  "support@demo.yourtal.test": "support",
  "moderator@demo.yourtal.test": "moderator",
  "risk-analyst@demo.yourtal.test": "risk_analyst",
  "finance@demo.yourtal.test": "finance",
  "ops@demo.yourtal.test": "ops",
  "admin@demo.yourtal.test": "admin",
};

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Registers one account exactly the way `AuthService.register` does: a
 * credential row, then a profile row, nothing else (no verification email —
 * 1.4.c's own register() sends none itself; that is a separate, explicit
 * call this seed has no reason to make for a fixture account). */
async function registerDemoAccount(
  pool: pg.Pool,
  password: string,
  spec: DemoAccountSpec,
): Promise<string> {
  const userId = randomUUID();
  const identifier = normalizeEmail(spec.email);
  const secretHash = await hashPassword(password);

  await pool.query(
    `INSERT INTO identity.credential (user_id, kind, identifier, secret_hash, verified_at)
     VALUES ($1, 'password', $2, $3, now())`,
    [userId, identifier, secretHash],
  );
  await pool.query(
    `INSERT INTO identity.user_profile
       (user_id, region, display_locale, display_name, date_of_birth, timezone)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      userId,
      spec.region,
      spec.region === "AU" ? "en-AU" : "id-ID",
      spec.displayName,
      ADULT_DOB,
      spec.timezone,
    ],
  );
  return userId;
}

function snapApp(region: "AU" | "ID"): Business {
  return region === "AU"
    ? businessSchema.parse({
        id: SNAP_APP_AU_ID,
        legalName: "Snap App Pty Ltd",
        displayName: "Snap App",
        district: "Surry Hills",
        roles: ["advertiser", "redeemer"],
        isVerified: true,
        logoUrl: null,
        region: "AU",
        currency: "AUD",
        handle: "snap-app-au",
        coverUrl: null,
      })
    : businessSchema.parse({
        id: SNAP_APP_ID_ID,
        legalName: "PT Snap App Indonesia",
        displayName: "Snap App",
        district: "Kebayoran Baru",
        roles: ["advertiser", "redeemer"],
        isVerified: true,
        logoUrl: null,
        region: "ID",
        currency: "IDR",
        handle: "snap-app-id",
        coverUrl: null,
      });
}

async function insertBusiness(pool: pg.Pool, business: Business): Promise<void> {
  await pool.query(
    `INSERT INTO business.business_accounts
       (id, legal_name, display_name, district, roles, is_verified, logo_url,
        region, currency, handle, cover_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      business.id,
      business.legalName,
      business.displayName,
      business.district,
      JSON.stringify(business.roles),
      business.isVerified,
      business.logoUrl,
      business.region,
      business.currency,
      business.handle,
      business.coverUrl,
    ],
  );
}

async function insertBusinessMember(
  pool: pg.Pool,
  businessId: string,
  userId: string,
  role: string,
  invitedByUserId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO business.business_members
       (business_id, user_id, role, invited_by_user_id, joined_at)
     VALUES ($1,$2,$3,$4, now())`,
    [businessId, userId, role, invitedByUserId],
  );
}

/** One 30s "quick" campaign on the shared fixture video (`packages/media/fixtures/attention-30s`),
 * for the given business. Zero questions, zero chapters — `campaign.mock.ts`'s
 * own generator gives a "quick" campaign no chapters either, and a minimal
 * staging catalogue has no reason to ask a reviewer to build a question bank
 * just to prove a campaign plays end to end. */
function stagingCampaign(params: {
  id: string;
  title: string;
  business: Business;
  now: Date;
}): Campaign {
  const { id, title, business, now } = params;
  const publishedAt = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const endsAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
  return campaignSchema.parse({
    id,
    kind: "quick",
    title,
    merchantId: business.id,
    merchantName: business.displayName,
    synopsis: `A 30-second look at ${business.displayName}, seeded for staging review (2.3.e).`,
    durationSeconds: 30,
    estimatedDataMb: 10.5,
    rewardPoints: toPoints(50),
    questionCount: 0,
    scoringRule: "base_only",
    status: "active",
    publishedAt,
    chapters: [],
    videoSource: { kind: "hls", manifestUrl: MOCK_HLS_MANIFEST_URL },
    businessId: business.id,
    region: business.region,
    audience: "all_ages",
    contentCategory: "entertainment",
    posterUrl: "http://127.0.0.1:26900/yourtal-media/posters/attention-30s.jpg",
    teaserUrl: "http://127.0.0.1:26900/yourtal-media/teasers/attention-30s.mp4",
    hlsUrl: MOCK_HLS_MANIFEST_URL,
    captionsUrl: null,
    aspect: "9:16",
    estimatedBytes: Math.round(10.5 * 1024 * 1024),
    startsAt: publishedAt,
    endsAt,
    openViewing: false,
    teaserStartSeconds: 0,
  });
}

async function insertCampaign(pool: pg.Pool, campaign: Campaign): Promise<void> {
  await pool.query(
    `INSERT INTO campaign.campaigns
       (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
        estimated_data_mb, reward_points, question_count, scoring_rule,
        lifecycle_state, published_at, business_id, region, audience, content_category,
        poster_url, teaser_url, hls_url, captions_url, aspect, estimated_bytes,
        starts_at, ends_at, open_viewing, teaser_start_seconds)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'live',$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
    [
      campaign.id,
      campaign.kind,
      campaign.title,
      campaign.merchantId,
      campaign.merchantName,
      campaign.synopsis,
      campaign.durationSeconds,
      campaign.estimatedDataMb,
      campaign.rewardPoints,
      campaign.questionCount,
      campaign.scoringRule,
      campaign.publishedAt,
      campaign.businessId,
      campaign.region,
      campaign.audience,
      campaign.contentCategory,
      campaign.posterUrl,
      campaign.teaserUrl,
      campaign.hlsUrl,
      campaign.captionsUrl,
      campaign.aspect,
      campaign.estimatedBytes,
      campaign.startsAt,
      campaign.endsAt,
      campaign.openViewing,
      campaign.teaserStartSeconds,
    ],
  );
  await pool.query(
    `INSERT INTO campaign.terms_version
       (campaign_id, version, reward_points, question_count, scoring_rule,
        duration_seconds, accuracy_bonus_points, effective_from)
     VALUES ($1, 1, $2, $3, $4, $5, 0, $6)`,
    [
      campaign.id,
      campaign.rewardPoints,
      campaign.questionCount,
      campaign.scoringRule,
      campaign.durationSeconds,
      campaign.publishedAt,
    ],
  );
  await pool.query(
    `INSERT INTO campaign.video_source (campaign_id, kind, manifest_url) VALUES ($1,$2,$3)`,
    [campaign.id, campaign.videoSource.kind, campaign.videoSource.manifestUrl],
  );
}

/**
 * The one real ledger call this seed makes (see this file's own header for
 * why it is real rather than the 1.2 fake). `kind: "goodwill"` because it
 * needs no evidence and no campaign — a plain marketing-funded credit, the
 * same shape a goodwill case would pay. `idempotencyKey` is fixed, so a
 * retry of this seed (were the emptiness guard ever bypassed) cannot double
 * -grant.
 *
 * If the ledger cannot be reached (not yet started, wrong URL/secret), this
 * logs a clear warning and returns rather than throwing — a staging
 * database that seeded businesses and accounts but not one pending grant is
 * still useful; one that seeded nothing because a sidecar was slow to start
 * is not.
 */
async function seedTierZeroPendingGrant(
  ledger: StagingLedgerConfig,
  userId: string,
  log: (message: string) => void,
): Promise<"granted" | "unreachable"> {
  const request: GrantActionRequest = grantActionRequestSchema.parse({
    kind: "goodwill",
    userId,
    region: "AU",
    points: toPoints(500),
    trustTier: 0,
    idempotencyKey: "staging-seed-tier0-viewer-pending-grant",
  });
  const path = "/v1/actions/grants";
  const body = JSON.stringify(request);
  try {
    const response = await fetch(`${ledger.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SERVICE_SIGNATURE_HEADER]: signServiceRequest({
          secret: ledger.serviceSecret,
          caller: "api",
          method: "POST",
          pathAndQuery: path,
          body,
        }),
      },
      body,
    });
    if (!response.ok) {
      log(
        `[seed:staging] ledger ${path} answered ${String(response.status)}: ` +
          `${await response.text()} — skipping the tier-0 pending grant.`,
      );
      return "unreachable";
    }
    return "granted";
  } catch (error) {
    log(
      `[seed:staging] could not reach the ledger at ${ledger.baseUrl} (${String(error)}) — ` +
        "skipping the tier-0 pending grant. Everything else this seed writes is unaffected.",
    );
    return "unreachable";
  }
}

export async function seedStaging(
  pool: pg.Pool,
  options: SeedStagingOptions,
): Promise<StagingSeedResult> {
  const log = options.log ?? ((message: string) => console.log(message));

  const existing = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM identity.user_profile",
  );
  if (Number(existing.rows[0]?.count ?? "0") > 0) {
    log("[seed:staging] identity.user_profile is not empty — skipping (already seeded).");
    return { skipped: true, businesses: 0, campaigns: 0, accounts: 0, pendingGrant: "skipped" };
  }

  const now = new Date();

  const snapAppAu = snapApp("AU");
  const snapAppId = snapApp("ID");
  await insertBusiness(pool, snapAppAu);
  await insertBusiness(pool, snapAppId);

  const campaigns = [
    stagingCampaign({
      id: CAMPAIGN_IDS.auOne,
      title: "Snap App — Weekend Special",
      business: snapAppAu,
      now,
    }),
    stagingCampaign({
      id: CAMPAIGN_IDS.auTwo,
      title: "Snap App — New Arrivals",
      business: snapAppAu,
      now,
    }),
    stagingCampaign({
      id: CAMPAIGN_IDS.idOne,
      title: "Snap App — Promo Akhir Pekan",
      business: snapAppId,
      now,
    }),
    stagingCampaign({
      id: CAMPAIGN_IDS.idTwo,
      title: "Snap App — Koleksi Baru",
      business: snapAppId,
      now,
    }),
  ];
  for (const campaign of campaigns) await insertCampaign(pool, campaign);

  const userIdByEmail = new Map<string, string>();
  for (const spec of demoAccounts()) {
    const userId = await registerDemoAccount(pool, options.demoPassword, spec);
    userIdByEmail.set(spec.email, userId);
  }
  const idOf = (email: string): string => {
    const id = userIdByEmail.get(email);
    if (id === undefined) throw new Error(`seed:staging — no account was created for ${email}`);
    return id;
  };

  const ownerAu = idOf("owner.au@demo.yourtal.test");
  const memberAu = idOf("member.au@demo.yourtal.test");
  const ownerId = idOf("owner.id@demo.yourtal.test");
  await insertBusinessMember(pool, SNAP_APP_AU_ID, ownerAu, "owner", ownerAu);
  await insertBusinessMember(pool, SNAP_APP_AU_ID, memberAu, "marketer", ownerAu);
  await insertBusinessMember(pool, SNAP_APP_ID_ID, ownerId, "owner", ownerId);

  for (const [email, role] of Object.entries(STAFF_ROLE_BY_EMAIL)) {
    await pool.query(
      `INSERT INTO identity.staff_role (user_id, role, granted_by) VALUES ($1, $2, 'staging-seed')`,
      [idOf(email), role],
    );
  }

  const pendingGrant = await seedTierZeroPendingGrant(
    options.ledger,
    idOf("viewer.au@demo.yourtal.test"),
    log,
  );

  return {
    skipped: false,
    businesses: 2,
    campaigns: campaigns.length,
    accounts: userIdByEmail.size,
    pendingGrant,
  };
}
