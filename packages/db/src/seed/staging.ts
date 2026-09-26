import { randomUUID } from "node:crypto";
import { hash as hashPassword } from "@node-rs/argon2";
import type pg from "pg";
import { businessSchema } from "@yourtal/contracts/business";
import type { Business } from "@yourtal/contracts/business";
import { campaignSchema } from "@yourtal/contracts/campaign";
import type { Campaign } from "@yourtal/contracts/campaign";
import { listingSchema } from "@yourtal/contracts/listing";
import type { Listing } from "@yourtal/contracts/listing";
import { toPoints, toMinorUnits } from "@yourtal/contracts/money";
import {
  SERVICE_SIGNATURE_HEADER,
  signServiceRequest,
} from "@yourtal/contracts/ledger-internal/service-signature";
import { grantActionRequestSchema } from "@yourtal/contracts/ledger-internal/rewards";
import type { GrantActionRequest } from "@yourtal/contracts/ledger-internal/rewards";
import { ledgerErrorSchema } from "@yourtal/contracts/ledger-internal/ledger-error";
import {
  approveBatchRequestSchema,
  batchSchema,
  requestBatchRequestSchema,
} from "@yourtal/contracts/voucher-internal/batches";
import type {
  ApproveBatchRequest,
  RequestBatchRequest,
} from "@yourtal/contracts/voucher-internal/batches";
import { seedLedger } from "./ledger";

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
 * ## Four independently idempotent steps, not one
 *
 * The first staging run left the tier-0 viewer with no pending grant
 * (`plat_AU_marketing_cash` was unfunded — `insufficient_available`), and
 * because the whole seed was ONE all-or-nothing gate on
 * `identity.user_profile` being empty, the next deploy's pre-reload would
 * have skipped everything, forever, with the world already seeded. So this
 * is now four steps, each with its own idempotency, run in order every
 * invocation:
 *
 *   1. `seedWorldIfEmpty` — businesses, campaigns, accounts. Still gated on
 *      `identity.user_profile` having no rows: a database that already has
 *      a real account (or a previous run's world) is left alone. Looks up
 *      the demo viewer's `user_id` either way, because steps 2-4 need it
 *      regardless of whether the world was just created or already
 *      existed.
 *   2. `ensureMarketingFunding` — reuses `seedLedger` (`seed/ledger.ts`)
 *      as-is, unconditionally, every run. `seedLedger` is already
 *      idempotent per region (a fixed funding id, checked before
 *      inserting), so calling it again when already funded is a no-op;
 *      this wrapper only adds before/after balance reads so the result can
 *      report which happened.
 *   3. `ensureTierZeroPendingGrant` — the real ledger call, every run, with
 *      a fixed `idempotencyKey`. The reward engine's own replay rule
 *      (`contractGrant`, `services/ledger/internal/reward/contract.go`)
 *      returns the SAME grant, 200, on a repeat with the same key and
 *      points — so a second deploy that finds the grant already there is
 *      not an error, and a first deploy that finds it MISSING (because the
 *      previous one failed, e.g. on unfunded cash) creates it. Failures
 *      other than a replay are reported and (see `main-staging.ts`) fail
 *      the deploy loudly rather than being swallowed as "the ledger must
 *      be unreachable".
 *   4. `ensureDemoVoucher` — 2.3.c's own dependency: its restore rehearsal
 *      must decrypt a REAL stored voucher code, and staging otherwise has
 *      zero listings and zero vouchers. Own idempotency (a voucher already
 *      existing for the fixed demo listing), because neither voucher-
 *      service route this calls is idempotent itself — see that function's
 *      own header.
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
 * uses only state step 2 above guarantees — `holdback_hours_by_tier` is
 * pre-approved for both regions
 * (`20260925193000_platform_region_setting.sql`) — and pays a `goodwill`
 * grant through the SAME business logic a real one would run, rather than
 * duplicating the reward engine's own posting rules in SQL here.
 *
 * `POST /economy/marketing/fund` (`services/ledger/internal/api/
 * economy_routes.go`) exists too, and was considered for step 2 instead of
 * reusing `seedLedger`'s SQL — it does not fit: the HTTP handler mints a
 * fresh random transfer id on every call (`randomHex()`), so calling it
 * twice funds the budget twice, rather than replaying. `seedLedger`'s own
 * SQL path uses a FIXED id per region and checks for it first, which is
 * the actual idempotency this step needs — reused as-is, not duplicated.
 */

export interface StagingSeedResult {
  readonly world: "seeded" | "already_present";
  readonly businesses: number;
  readonly campaigns: number;
  readonly accounts: number;
  readonly marketingFunding: "funded" | "already_funded";
  /** `"skipped"` only when the world has no demo viewer to grant to at all
   * (identity.user_profile is non-empty from something other than this
   * seed's own accounts) — not a ledger outcome, so not a failure either. */
  readonly pendingGrant: "granted" | "already_present" | "failed" | "skipped";
  /** Present only when `pendingGrant` is `"failed"` — the ledger's own
   * error code (e.g. `insufficient_available`), or a network-error message. */
  readonly pendingGrantDetail?: string;
  /** 2.3.c's restore rehearsal needs a real, decryptable voucher code — see
   * `ensureDemoVoucher`. `"skipped"` for the same reason `pendingGrant` can
   * be: no business this seed created to hang a listing off. */
  readonly demoVoucher: "created" | "already_present" | "failed" | "skipped";
  /** Present only when `demoVoucher` is `"failed"` — the voucher service's
   * own error code, or a network-error message. */
  readonly demoVoucherDetail?: string;
}

export interface StagingLedgerConfig {
  readonly baseUrl: string;
  readonly serviceSecret: string;
}

export interface StagingVoucherConfig {
  readonly baseUrl: string;
  readonly serviceSecret: string;
}

export interface SeedStagingOptions {
  /** Refuses to run without one — see `main()`'s own check for why. */
  readonly demoPassword: string;
  readonly ledger: StagingLedgerConfig;
  readonly voucher: StagingVoucherConfig;
  /** Injectable for tests; defaults to `console`. */
  readonly log?: (message: string) => void;
  /** Injectable for tests only — see `REPLAY_DETECTION_WINDOW_MS`'s own
   * comment. Defaults to that constant; production never overrides it. */
  readonly replayDetectionWindowMs?: number;
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

/** 2.3.c's own listing/voucher — the restore rehearsal needs one real,
 * decryptable voucher code to prove a backup restore against, and
 * `voucher.batch` has an FK to `store.listings`, so both are seeded here. */
const DEMO_LISTING_ID = "00000000-0000-4000-9000-000000000301";
const DEMO_LOCATION_ID = "00000000-0000-4000-9000-000000000302";

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

interface WorldResult {
  readonly status: "seeded" | "already_present";
  readonly businesses: number;
  readonly campaigns: number;
  readonly accounts: number;
  /** `null` only when `identity.user_profile` is non-empty from something
   * other than this seed's own accounts (no `viewer.au@…` credential row
   * to look up) — a world this seed did not create and should not touch
   * further than it already has. */
  readonly viewerUserId: string | null;
}

async function lookupUserId(pool: pg.Pool, email: string): Promise<string | null> {
  const result = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM identity.credential WHERE kind = 'password' AND identifier = $1`,
    [normalizeEmail(email)],
  );
  return result.rows[0]?.user_id ?? null;
}

/** Step 1 — see this file's header. Gated on `identity.user_profile` being
 * empty; looks up the viewer's `user_id` either way, since steps 2 and 3
 * need it whether the world was just created or already existed. */
async function seedWorldIfEmpty(
  pool: pg.Pool,
  demoPassword: string,
  log: (message: string) => void,
): Promise<WorldResult> {
  const existing = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM identity.user_profile",
  );
  if (Number(existing.rows[0]?.count ?? "0") > 0) {
    log("[seed:staging] identity.user_profile is not empty — the world is already seeded.");
    const viewerUserId = await lookupUserId(pool, "viewer.au@demo.yourtal.test");
    return { status: "already_present", businesses: 0, campaigns: 0, accounts: 0, viewerUserId };
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
    const userId = await registerDemoAccount(pool, demoPassword, spec);
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

  return {
    status: "seeded",
    businesses: 2,
    campaigns: campaigns.length,
    accounts: userIdByEmail.size,
    viewerUserId: idOf("viewer.au@demo.yourtal.test"),
  };
}

/** The two accounts `seedLedger`'s own `fundMarketing` posts to — read here
 * only to observe whether step 2 changed anything, never written directly
 * (see this file's header for why the write itself is `seedLedger`'s, not
 * reimplemented here). Same query `seed/ledger.test.ts` already uses. */
async function marketingCashBalance(pool: pg.Pool, region: "AU" | "ID"): Promise<number> {
  const { rows } = await pool.query<{ balance: string }>(
    `SELECT (-COALESCE(SUM(amount_minor), 0))::text AS balance
       FROM ledger.entry WHERE account_id = $1`,
    [`plat_${region}_marketing_cash`],
  );
  return Number(rows[0]?.balance ?? "0");
}

/** Step 2 — see this file's header for why this reuses `seedLedger` rather
 * than the ledger's own `/economy/marketing/fund` HTTP route or a raw SQL
 * copy of its idempotency check. Runs every invocation; the before/after
 * balance read is only for an honest status, never a gate. */
async function ensureMarketingFunding(pool: pg.Pool): Promise<"funded" | "already_funded"> {
  const before = await Promise.all([
    marketingCashBalance(pool, "AU"),
    marketingCashBalance(pool, "ID"),
  ]);
  await seedLedger(pool);
  const after = await Promise.all([
    marketingCashBalance(pool, "AU"),
    marketingCashBalance(pool, "ID"),
  ]);
  return before[0] === after[0] && before[1] === after[1] ? "already_funded" : "funded";
}

interface GrantOutcome {
  readonly status: "granted" | "already_present" | "failed";
  readonly detail?: string;
}

/** A replayed grant (same idempotencyKey, same points) answers with the
 * ORIGINAL `grantedAt`, not now — `contractGrant`'s own replay rule
 * (`services/ledger/internal/reward/contract.go`) returns the stored row,
 * it does not touch it. So a `grantedAt` more than this far in the past
 * means "already there before this call", not "just created" — generous
 * enough that ordinary request latency never crosses it, tight enough that
 * no real gap between deploys ever could either. `SeedStagingOptions.
 * replayDetectionWindowMs` overrides this for a test that cannot wait 30s
 * between two calls to tell them apart; production never sets it. */
const REPLAY_DETECTION_WINDOW_MS = 30_000;

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Step 3 — the one real ledger call this seed makes (see this file's own
 * header for why it is real rather than the 1.2 fake). `kind: "goodwill"`
 * because it needs no evidence and no campaign — a plain marketing-funded
 * credit, the same shape a goodwill case would pay. `idempotencyKey` is
 * fixed, so every run asks the SAME question and the reward engine's own
 * replay rule answers it consistently — see `REPLAY_DETECTION_WINDOW_MS`
 * for how this tells "just created" apart from "already there" given the
 * two look identical on the wire (both a 200 with the grant).
 *
 * Any other outcome — a non-2xx response, or the ledger not answering at
 * all — is `"failed"`, reported with its code or error message and never
 * swallowed: on staging the ledger is always up during pre-reload
 * (`main-staging.ts`'s own header), so a failure here is real and the
 * caller is expected to fail the deploy loudly over it, not tiptoe past a
 * missing demo grant a second time.
 */
async function ensureTierZeroPendingGrant(
  ledger: StagingLedgerConfig,
  userId: string,
  log: (message: string) => void,
  replayDetectionWindowMs: number,
): Promise<GrantOutcome> {
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

  let response: Response;
  try {
    response = await fetch(`${ledger.baseUrl}${path}`, {
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
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    log(`[seed:staging] could not reach the ledger at ${ledger.baseUrl} (${detail}).`);
    return { status: "failed", detail };
  }

  if (!response.ok) {
    const raw = await response.text();
    const parsed = ledgerErrorSchema.safeParse(tryParseJson(raw));
    const detail = parsed.success ? parsed.data.code : `http_${String(response.status)}: ${raw}`;
    log(`[seed:staging] ledger ${path} answered ${String(response.status)}: ${raw}`);
    return { status: "failed", detail };
  }

  const grantView: unknown = await response.json();
  const grantedAtRaw =
    typeof grantView === "object" && grantView !== null && "grantedAt" in grantView
      ? grantView.grantedAt
      : undefined;
  const grantedAtMs = typeof grantedAtRaw === "string" ? Date.parse(grantedAtRaw) : NaN;
  const justCreated =
    Number.isFinite(grantedAtMs) && Date.now() - grantedAtMs < replayDetectionWindowMs;
  return { status: justCreated ? "granted" : "already_present" };
}

/** AUD 45.00 / AUD 30.00 — what snap-app is paid per redemption. Never a
 * points price: 4.9.d is explicit that B (the backing rate) never reaches
 * anything outside the server, and a mock rate is exactly that reached from
 * the wrong place (`eslint-rules/no-mock-backing-rate.mjs` refuses a new
 * use of one for the same reason). `priceDemoListing` below prices this
 * for real, the same way a business's own listing gets priced. */
const DEMO_FACE_VALUE_MINOR = 4_500;
const DEMO_SETTLEMENT_VALUE_MINOR = 3_000;

/**
 * One "quick" listing for snap-app AU, the same 1.1.h rule the campaign
 * seed already follows: region and currency come from the business, never
 * chosen independently. `priceInPoints` is a parameter, never computed
 * in here — see `priceDemoListing`.
 */
function buildDemoListing(priceInPoints: number): Listing {
  return listingSchema.parse({
    id: DEMO_LISTING_ID,
    merchantId: SNAP_APP_AU_ID,
    merchantName: "Snap App",
    title: "Snap App — Demo Voucher",
    description:
      "A demonstration voucher seeded for staging review and the backup restore rehearsal (2.3.c).",
    category: "retail",
    locations: [
      {
        id: DEMO_LOCATION_ID,
        name: "Snap App — Surry Hills",
        address: "12 Crown Street, Surry Hills NSW 2010",
        district: "Surry Hills",
      },
    ],
    currency: "AUD",
    faceValueMinor: toMinorUnits(DEMO_FACE_VALUE_MINOR),
    settlementValueMinor: toMinorUnits(DEMO_SETTLEMENT_VALUE_MINOR),
    priceInPoints,
    stockRemaining: 20,
    stockTotal: 20,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    minimumSpendMinor: null,
    // A year out: this listing is created once and left alone (idempotent),
    // so it has to outlive many deploys' worth of restore rehearsals, not
    // just the one that first creates it.
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    status: "available",
    region: "AU",
    audience: "all_ages",
    contentCategory: "services",
    imageUrl: "http://127.0.0.1:26900/yourtal-media/listings/snap-app-au-demo.jpg",
    channel: "in_store",
    partialRedemption: "single_use",
  });
}

interface ExistingListingFacts {
  readonly faceValueMinor: number;
  readonly currency: string;
  readonly partialRedemptionPolicy: string;
}

async function existingListingFacts(
  pool: pg.Pool,
  listingId: string,
): Promise<ExistingListingFacts | null> {
  const result = await pool.query<{
    face_value_minor: string;
    currency: string;
    partial_redemption_policy: string;
  }>(
    `SELECT face_value_minor, currency, partial_redemption_policy
       FROM store.listings WHERE id = $1`,
    [listingId],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        faceValueMinor: Number(row.face_value_minor),
        currency: row.currency,
        partialRedemptionPolicy: row.partial_redemption_policy,
      };
}

async function insertListing(pool: pg.Pool, listing: Listing): Promise<void> {
  const location = listing.locations[0];
  if (location === undefined) throw new Error(`listing ${listing.id} has no locations`);

  await pool.query(
    `INSERT INTO store.listings
       (id, merchant_id, merchant_name, title, description, category,
        face_value_minor, settlement_value_minor, price_in_points, stock_remaining,
        stock_total, transferable, partial_redemption_policy, minimum_spend_minor,
        expires_at, status, currency, region, audience, content_category, image_url,
        channel, partial_redemption)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
    [
      listing.id,
      listing.merchantId,
      listing.merchantName,
      listing.title,
      listing.description,
      listing.category,
      listing.faceValueMinor,
      listing.settlementValueMinor,
      listing.priceInPoints,
      listing.stockRemaining,
      listing.stockTotal,
      listing.transferable,
      listing.partialRedemptionPolicy,
      listing.minimumSpendMinor,
      listing.expiresAt,
      listing.status,
      listing.currency,
      listing.region,
      listing.audience,
      listing.contentCategory,
      listing.imageUrl,
      listing.channel,
      listing.partialRedemption,
    ],
  );
  await pool.query(
    `INSERT INTO store.merchant_location (id, merchant_id, name, address, district)
     VALUES ($1,$2,$3,$4,$5)`,
    [location.id, listing.merchantId, location.name, location.address, location.district],
  );
  await pool.query(`INSERT INTO store.listing_location (listing_id, location_id) VALUES ($1,$2)`, [
    listing.id,
    location.id,
  ]);
}

interface VoucherOutcome {
  readonly status: "created" | "already_present" | "failed";
  readonly detail?: string;
}

/** Signs and sends one call to either service — the same canonical string
 * `services/ledger/internal/serviceauth` and `services/voucher/internal/
 * serviceauth` both verify (`HttpLedgerClient`/`HttpVoucherClient` build the
 * identical shape on the real request path); reused via `signServiceRequest`
 * rather than copied a third time, because the algorithm — unlike the two
 * Go services themselves — has no reason to differ between them. */
async function postSigned(
  config: { readonly baseUrl: string; readonly serviceSecret: string },
  path: string,
  request: unknown,
): Promise<{ ok: true; body: unknown } | { ok: false; detail: string }> {
  const body = JSON.stringify(request);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [SERVICE_SIGNATURE_HEADER]: signServiceRequest({
          secret: config.serviceSecret,
          caller: "api",
          method: "POST",
          pathAndQuery: path,
          body,
        }),
      },
      body,
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }

  const raw = await response.text();
  if (!response.ok) {
    const parsed = ledgerErrorSchema.safeParse(tryParseJson(raw));
    return {
      ok: false,
      detail: parsed.success ? parsed.data.code : `http_${String(response.status)}: ${raw}`,
    };
  }
  return { ok: true, body: tryParseJson(raw) };
}

/**
 * The real ledger prices the listing — `POST /v1/pricing/listing`
 * (`services/ledger/internal/api/pricing_routes.go`'s `priceListing`,
 * `HttpLedgerClient.priceListing`'s own route) — exactly the way a real
 * business's listing would be priced, rather than a mock backing rate
 * (4.9.d: B never reaches anything outside the server;
 * `eslint-rules/no-mock-backing-rate.mjs` is what caught the first draft of
 * this file reaching for one). `PriceListing`'s own engine
 * (`services/ledger/internal/pricing/quotes.go`) upserts `ledger.
 * listing_price` keyed by `listingId` — safe to call again, though this
 * only ever does once, when the listing does not exist yet (see
 * `ensureDemoVoucher`).
 */
async function priceDemoListing(
  ledger: StagingLedgerConfig,
): Promise<{ ok: true; pricePoints: number } | { ok: false; detail: string }> {
  const request = {
    listingId: DEMO_LISTING_ID,
    region: "AU",
    currency: "AUD",
    settlementMinor: DEMO_SETTLEMENT_VALUE_MINOR,
  };
  const priced = await postSigned(ledger, "/v1/pricing/listing", request);
  if (!priced.ok) return { ok: false, detail: priced.detail };

  const body = priced.body;
  const pricePoints =
    typeof body === "object" && body !== null && "pricePoints" in body
      ? body.pricePoints
      : undefined;
  if (typeof pricePoints !== "number") {
    return {
      ok: false,
      detail: `unexpected /v1/pricing/listing response: ${JSON.stringify(body)}`,
    };
  }
  return { ok: true, pricePoints };
}

/**
 * Step 4 (2.3.c) — one real, decryptable voucher for the restore rehearsal
 * to prove a backup restore against. `voucher.vouchers` seeded any other
 * way (`seed/store.ts`'s own mock vouchers included) has no
 * `voucher.code_custody` row — no envelope-encrypted code to decrypt — so
 * this goes through the real minting flow, the same way the tier-0 grant
 * goes through the real reward engine: `POST /internal/v1/batches` then
 * `POST /internal/v1/batches/approve` (a DIFFERENT approver than requester
 * — `Minter.Approve` matches no row, and answers the same error, for a
 * self-approval as for "not awaiting approval" — `services/voucher/
 * internal/issue/issue.go`). Approval mints synchronously.
 *
 * Neither voucher-service route is idempotent on its own — `requestBatch`'s
 * handler mints a fresh `uuid.New()` batch id server-side on every call, the
 * same "no caller-supplied key" gap `/economy/marketing/fund` has (this
 * file's own header on step 2) — so idempotency is this function's own:
 * skip entirely if a voucher already exists for this listing.
 *
 * Approval can return 200 with the batch merely "approved" rather than
 * "minted" — `approveBatch`'s own handler mints synchronously but only LOGS
 * a mint failure server-side, it does not fail the HTTP response (`services/
 * voucher/internal/api/batches_routes.go`) — so this re-checks
 * `voucher.vouchers` afterward rather than trusting the response shape.
 */
async function ensureDemoVoucher(
  pool: pg.Pool,
  ledger: StagingLedgerConfig,
  voucher: StagingVoucherConfig,
  log: (message: string) => void,
): Promise<VoucherOutcome> {
  const existingVouchers = async (): Promise<number> => {
    const result = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM voucher.vouchers WHERE listing_id = $1",
      [DEMO_LISTING_ID],
    );
    return Number(result.rows[0]?.count ?? "0");
  };

  if ((await existingVouchers()) > 0) {
    return { status: "already_present" };
  }

  let listingFacts = await existingListingFacts(pool, DEMO_LISTING_ID);
  if (listingFacts === null) {
    const priced = await priceDemoListing(ledger);
    if (!priced.ok) {
      log(`[seed:staging] ledger /v1/pricing/listing answered an error: ${priced.detail}`);
      return { status: "failed", detail: priced.detail };
    }
    const listing = buildDemoListing(priced.pricePoints);
    await insertListing(pool, listing);
    listingFacts = {
      faceValueMinor: listing.faceValueMinor,
      currency: listing.currency,
      partialRedemptionPolicy: listing.partialRedemptionPolicy,
    };
  }

  const requestBatchBody: RequestBatchRequest = requestBatchRequestSchema.parse({
    listingId: DEMO_LISTING_ID,
    merchantId: SNAP_APP_AU_ID,
    currency: listingFacts.currency,
    faceValueMinor: listingFacts.faceValueMinor,
    quantity: 1,
    partialRedemptionPolicy: listingFacts.partialRedemptionPolicy,
    requestedBy: "staging-seed-requester",
  });
  const requested = await postSigned(voucher, "/internal/v1/batches", requestBatchBody);
  if (!requested.ok) {
    log(`[seed:staging] voucher /internal/v1/batches answered an error: ${requested.detail}`);
    return { status: "failed", detail: requested.detail };
  }
  const requestedBatch = batchSchema.safeParse(requested.body);
  if (!requestedBatch.success) {
    const detail = `unexpected /internal/v1/batches response: ${requestedBatch.error.message}`;
    log(`[seed:staging] ${detail}`);
    return { status: "failed", detail };
  }

  // A different approver than requester — Minter.Approve rejects self-approval.
  const approveBody: ApproveBatchRequest = approveBatchRequestSchema.parse({
    batchId: requestedBatch.data.batchId,
    approvedBy: "staging-seed-approver",
  });
  const approved = await postSigned(voucher, "/internal/v1/batches/approve", approveBody);
  if (!approved.ok) {
    log(
      `[seed:staging] voucher /internal/v1/batches/approve answered an error: ${approved.detail}`,
    );
    return { status: "failed", detail: approved.detail };
  }

  // Approval can 200 without actually minting (see this function's own
  // header) — the only trustworthy confirmation is a real row.
  if ((await existingVouchers()) === 0) {
    const detail =
      "batches/approve answered 200 but no voucher.vouchers row exists for the listing";
    log(`[seed:staging] ${detail}`);
    return { status: "failed", detail };
  }
  return { status: "created" };
}

export async function seedStaging(
  pool: pg.Pool,
  options: SeedStagingOptions,
): Promise<StagingSeedResult> {
  const log = options.log ?? ((message: string) => console.log(message));

  const world = await seedWorldIfEmpty(pool, options.demoPassword, log);
  const marketingFunding = await ensureMarketingFunding(pool);

  const base = {
    world: world.status,
    businesses: world.businesses,
    campaigns: world.campaigns,
    accounts: world.accounts,
    marketingFunding,
  } as const;

  if (world.viewerUserId === null) {
    log(
      "[seed:staging] no viewer.au@demo.yourtal.test account exists (a non-empty " +
        "identity.user_profile this seed did not create) — skipping the pending grant " +
        "and the demo voucher.",
    );
    return { ...base, pendingGrant: "skipped", demoVoucher: "skipped" };
  }

  const grant = await ensureTierZeroPendingGrant(
    options.ledger,
    world.viewerUserId,
    log,
    options.replayDetectionWindowMs ?? REPLAY_DETECTION_WINDOW_MS,
  );
  const voucher = await ensureDemoVoucher(pool, options.ledger, options.voucher, log);

  return {
    ...base,
    pendingGrant: grant.status,
    ...(grant.detail === undefined ? {} : { pendingGrantDetail: grant.detail }),
    demoVoucher: voucher.status,
    ...(voucher.detail === undefined ? {} : { demoVoucherDetail: voucher.detail }),
  };
}
