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
import { quoteRequestSchema } from "@yourtal/contracts/ledger-internal/pricing";
import type { QuoteRequest } from "@yourtal/contracts/ledger-internal/pricing";
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
  /** `capped_for_today`: F12's daily cap refused it; expected, retried on a later run. */
  readonly pendingGrant: "granted" | "already_present" | "capped_for_today" | "failed" | "skipped";
  /** Present only when `pendingGrant` is `"failed"` — the ledger's own
   * error code (e.g. `insufficient_available`), or a network-error message. */
  readonly pendingGrantDetail?: string;
  /** 2.3.c's restore rehearsal needs a real, decryptable voucher code — see
   * `ensureDemoVoucher`. `"skipped"` for the same reason `pendingGrant` can
   * be: no business this seed created to hang a listing off. `"created"`
   * covers both a first mint AND a later top-up (F74/8.2.i) — see
   * `demoVoucherDetail` for which. */
  readonly demoVoucher: "created" | "already_present" | "failed" | "skipped";
  /** The voucher service's own error code (or a network-error message) when
   * `demoVoucher` is `"failed"`; a short "had N, minted M more" summary when
   * it is `"created"` (F74/8.2.i) — undefined only for `"already_present"`/`"skipped"`. */
  readonly demoVoucherDetail?: string;
  /**
   * F74/8.2.i: each region's demo viewer topped up, in one safely-sized
   * idempotent grant attempt per run, to afford several of that region's
   * OWN cheap demo listing (`affordableListings` below) at today's LIVE
   * quote — see `ensureDemoRedemptionBalance`. Empty when the world has no
   * demo viewers to grant to (the same case `pendingGrant`/`demoVoucher`
   * report `"skipped"` for).
   */
  readonly redemptionBalance: readonly DemoBalanceResult[];
  /**
   * F74/8.2.i (reopened) — the two listings this seed derives a LOW price
   * for at creation, so the loop is actually affordable rather than merely
   * funded: AU's second listing (`AU_AFFORDABLE_LISTING_ID`, the original
   * `DEMO_LISTING_ID` is never repriced — see its own doc) and ID's first
   * one (`ID_LISTING_ID` — no Snap App ID listing existed before this).
   * `"failed"` here (a real pricing/voucher error) fails the deploy;
   * `"created"`/`"already_present"` do not. Same "skipped means empty" rule
   * as `redemptionBalance` — no demo viewer to serve means no reason to
   * create or reprice these listings either.
   */
  readonly affordableListings: readonly AffordableListingResult[];
}

export interface AffordableListingResult {
  readonly region: "AU" | "ID";
  readonly listingId: string;
  readonly locationId: string;
  readonly status: "created" | "already_present" | "failed";
  /** The ledger's/voucher service's own error code, or a network-error
   * message, when `status` is `"failed"`; a short "had N, minted M more"
   * summary when it is `"created"` — undefined only for `"already_present"`. */
  readonly detail?: string;
  /** Present only when this run actually derived a NEW price (a fresh
   * listing) — the live quote it landed at. */
  readonly pricePoints?: number;
}

export interface DemoBalanceResult {
  readonly region: "AU" | "ID";
  /** `"capped_for_today"` is F12's OWN daily earn cap refusing a grant
   * (`velocity_capped`) — expected, not a bug: this run made no progress,
   * but the NEXT real day's deploy gets a fresh daily allowance and tries
   * again with the same idempotencyKey (never stored, since the ledger
   * refused it before writing anything) — see `ensureDemoRedemptionBalance`'s
   * own header. Never fails the deploy, unlike `"failed"`. */
  readonly status: "topped_up" | "already_sufficient" | "capped_for_today" | "failed";
  /** The ledger's own error code, or a network-error message, when `status`
   * is `"failed"` or `"capped_for_today"`. */
  readonly detail?: string;
  readonly availablePoints?: number;
  readonly targetPoints?: number;
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
 * `voucher.batch` has an FK to `store.listings`, so both are seeded here.
 * Its settlement value is FIXED forever (`DEMO_SETTLEMENT_VALUE_MINOR`) —
 * see F74/8.2.i's reopened note on why a redemption-loop-affordable listing
 * is a SEPARATE one (`AU_AFFORDABLE_LISTING_ID` below), never an edit to
 * this one. */
const DEMO_LISTING_ID = "00000000-0000-4000-9000-000000000301";
const DEMO_LOCATION_ID = "00000000-0000-4000-9000-000000000302";

/**
 * F74/8.2.i (reopened 2026-09-29) — a SECOND AU listing and the first ID
 * one, both priced LOW on purpose so the redemption loop actually works,
 * not just eventually. Not the same listing as `DEMO_LISTING_ID`/2.3.c's:
 * lowering an EXISTING listing's settlement value is a real business rule
 * (`store.listing_price_revision`/YT-0575), enforced at the API layer —
 * `DrizzleListingRepository.updateSettlementValue` takes a decrease only
 * through `DrizzleSettlementDecreaseRequestRepository`'s two-person
 * approval (`apps/api/src/modules/store/persistence/apply-settlement-
 * value-change.ts`'s own header). This seed writes directly to Postgres
 * and could technically bypass that, but bypassing a control that exists
 * specifically to stop someone from unilaterally re-pricing a listing
 * downward is exactly the wrong instinct for a fixture that is meant to
 * model the real thing — so `DEMO_LISTING_ID` is never touched after
 * creation, and this is a brand-new listing this seed owns outright
 * instead, cheap from the moment it is created.
 */
const AU_AFFORDABLE_LISTING_ID = "00000000-0000-4000-9000-000000000303";
const AU_AFFORDABLE_LOCATION_ID = "00000000-0000-4000-9000-000000000304";
const ID_LISTING_ID = "00000000-0000-4000-9000-000000000305";
const ID_LOCATION_ID = "00000000-0000-4000-9000-000000000306";

/** The LIVE quote (points) each region's cheap listing is derived to land
 * at, at creation time — see `deriveAffordableSettlementMinor`. Small on
 * purpose: AU's is sized against `viewer.au`'s own EXISTING ~600-point
 * balance (the exact number the reopened 8.2.e Check reported), so the
 * loop works on the very next deploy, not after days of top-ups; ID's
 * matches the same ratio against its own daily-cap-affordable target
 * (`ID_TOPUP_CHUNK_POINTS`). Both leave room for `REDEMPTION_HEADROOM_
 * VOUCHERS` several times over. */
const AU_AFFORDABLE_QUOTE_TARGET_POINTS = 150;
const ID_AFFORDABLE_QUOTE_TARGET_POINTS = 250;

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
    // F74/8.2.i: the redemption-loop Check needs a viewer in EACH region,
    // not only AU — same tier-0-by-default reasoning as viewer.au above.
    {
      email: "viewer.id@demo.yourtal.test",
      region: "ID",
      displayName: "Viewer Demo (ID)",
      timezone: TIMEZONE_ID,
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
  // TASKS.md 7.1.a: snap-app.md names it a sister company (not arm's-length),
  // but its business row still needs a real-shaped tax ID and address like
  // any other advertiser — snap-app-first-merchant.md.
  return region === "AU"
    ? businessSchema.parse({
        id: SNAP_APP_AU_ID,
        legalName: "Snap App Pty Ltd",
        displayName: "Snap App",
        taxIdKind: "ABN",
        taxIdValue: "51824753556",
        addressState: "NSW",
        addressPostcode: "2010",
        addressCity: null,
        roles: ["advertiser", "supplier", "redeemer"],
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
        taxIdKind: "NPWP",
        taxIdValue: "0123456789012345",
        addressState: null,
        addressPostcode: null,
        addressCity: "Kebayoran Baru",
        roles: ["advertiser", "supplier", "redeemer"],
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
       (id, legal_name, display_name, tax_id_kind, tax_id_value,
        address_state, address_postcode, address_city, roles, is_verified, logo_url,
        region, currency, handle, cover_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      business.id,
      business.legalName,
      business.displayName,
      business.taxIdKind,
      business.taxIdValue,
      business.addressState,
      business.addressPostcode,
      business.addressCity,
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
  /** F74/8.2.i: the ID region's own demo viewer, same nullability reasoning as `viewerUserId`. */
  readonly viewerIdUserId: string | null;
}

async function lookupUserId(pool: pg.Pool, email: string): Promise<string | null> {
  const result = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM identity.credential WHERE kind = 'password' AND identifier = $1`,
    [normalizeEmail(email)],
  );
  return result.rows[0]?.user_id ?? null;
}

async function businessExists(pool: pg.Pool, businessId: string): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM business.business_accounts WHERE id = $1`, [
    businessId,
  ]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * F74/8.2.i (reopened a second time) — the real staging incident this
 * guards against: `viewer.id@demo.yourtal.test` was added to
 * `demoAccounts()` well after staging's `identity.user_profile` was first
 * populated, so the ORIGINAL "world already exists, do nothing further"
 * early return skipped creating it forever — not because the seed was
 * broken, but because it never asked the question "does THIS account
 * exist yet" at all, only "does ANY account exist". The login-throttle 429
 * the lead saw was real: an account that never existed, tried enough
 * times.
 *
 * So this runs on EVERY invocation, world-already-seeded or not, and for
 * each `demoAccounts()` entry checks by EMAIL, not by a world-wide count:
 * missing -> `registerDemoAccount` (a fresh row); already there -> touched
 * NOT AT ALL, never a password reset, never a profile overwrite. Business
 * membership / staff-role linkage is applied the same way, gated on the
 * account being new here (a pre-existing account's own linkage, however it
 * got there, is left alone) and on the owning business actually existing
 * (defends the same "identity.user_profile non-empty from something this
 * seed did not create" case `WorldResult`'s own doc names — a foreign DB
 * with no Snap App business at all must not FK-violate trying to add one).
 */
async function ensureAllDemoAccountsExist(
  pool: pg.Pool,
  demoPassword: string,
  log: (message: string) => void,
): Promise<{ viewerUserId: string | null; viewerIdUserId: string | null }> {
  const idByEmail = new Map<string, string>();
  const justCreated = new Set<string>();
  for (const spec of demoAccounts()) {
    const existingId = await lookupUserId(pool, spec.email);
    if (existingId !== null) {
      idByEmail.set(spec.email, existingId);
      continue;
    }
    const userId = await registerDemoAccount(pool, demoPassword, spec);
    idByEmail.set(spec.email, userId);
    justCreated.add(spec.email);
    log(`[seed:staging] ${spec.email} did not exist yet — created it now.`);
  }

  const ownerAu = idByEmail.get("owner.au@demo.yourtal.test");
  const memberAu = idByEmail.get("member.au@demo.yourtal.test");
  const ownerId = idByEmail.get("owner.id@demo.yourtal.test");
  if (justCreated.has("owner.au@demo.yourtal.test") && ownerAu !== undefined) {
    if (await businessExists(pool, SNAP_APP_AU_ID)) {
      await insertBusinessMember(pool, SNAP_APP_AU_ID, ownerAu, "owner", ownerAu);
    } else {
      log(
        `[seed:staging] owner.au created but ${SNAP_APP_AU_ID} does not exist — no membership row.`,
      );
    }
  }
  if (
    justCreated.has("member.au@demo.yourtal.test") &&
    memberAu !== undefined &&
    ownerAu !== undefined
  ) {
    if (await businessExists(pool, SNAP_APP_AU_ID)) {
      await insertBusinessMember(pool, SNAP_APP_AU_ID, memberAu, "marketer", ownerAu);
    } else {
      log(
        `[seed:staging] member.au created but ${SNAP_APP_AU_ID} does not exist — no membership row.`,
      );
    }
  }
  if (justCreated.has("owner.id@demo.yourtal.test") && ownerId !== undefined) {
    if (await businessExists(pool, SNAP_APP_ID_ID)) {
      await insertBusinessMember(pool, SNAP_APP_ID_ID, ownerId, "owner", ownerId);
    } else {
      log(
        `[seed:staging] owner.id created but ${SNAP_APP_ID_ID} does not exist — no membership row.`,
      );
    }
  }
  for (const [email, role] of Object.entries(STAFF_ROLE_BY_EMAIL)) {
    if (!justCreated.has(email)) continue;
    const userId = idByEmail.get(email);
    if (userId === undefined) continue;
    await pool.query(
      `INSERT INTO identity.staff_role (user_id, role, granted_by) VALUES ($1, $2, 'staging-seed')`,
      [userId, role],
    );
  }

  return {
    viewerUserId: idByEmail.get("viewer.au@demo.yourtal.test") ?? null,
    viewerIdUserId: idByEmail.get("viewer.id@demo.yourtal.test") ?? null,
  };
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
    const { viewerUserId, viewerIdUserId } = await ensureAllDemoAccountsExist(
      pool,
      demoPassword,
      log,
    );
    return {
      status: "already_present",
      businesses: 0,
      campaigns: 0,
      accounts: 0,
      viewerUserId,
      viewerIdUserId,
    };
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
    viewerIdUserId: idOf("viewer.id@demo.yourtal.test"),
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
  readonly status: "granted" | "already_present" | "capped_for_today" | "failed";
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
    // Demo viewers are adults; the ledger refuses a grant without an age band (12.1.c).
    ageBand: "adult",
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
    // F12's own daily cap is the system working, not a broken deploy (same as the top-up).
    if (detail === "velocity_capped") return { status: "capped_for_today", detail };
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

/** F74/8.2.i — keeps the demo listing's live, minted-and-unallocated stock
 * (`voucher.vouchers WHERE state='minted'` — 7.4.c made `store.listings.
 * stock_remaining` vestigial) topped up so repeated staging Checks don't run
 * it dry the way 2.3.c's original "mint one, ever" idempotency did. */
const DEMO_VOUCHER_STOCK_TARGET = 20;

/** How many demo vouchers, at today's LIVE quote, the AU viewer's balance
 * should afford — see `ensureDemoRedemptionBalance`'s own header for why
 * more than one, and for why this is 2, not something larger: F12's own
 * daily earn cap (`platform.ledger_setting`'s `daily_earn_cap`, currently
 * AU 500 / ID 5000 — `packages/db/migrations/20260925193000_platform_
 * region_setting.sql`) bounds how much of any target is reachable per
 * calendar day, discovered the hard way by running this seed against a
 * REAL ledger (F74/8.2.i's own verification, not the fake): an AU live
 * quote of ~858-1000 needs several real days to reach at 2x headroom
 * already; 5x would take twice as long for no correctness gain. */
const REDEMPTION_HEADROOM_VOUCHERS = 2;
/** One grant attempt per region per run — NOT several small chunks. F12's
 * `checkCaps` (`services/ledger/internal/reward/caps.go`) enforces TWO
 * limits per user per DAY, across every action and funding source alike
 * (confirmed against the real ledger, not assumed): a POINTS sum
 * (`daily_earn_cap`) and, for `kind: "goodwill"` specifically, a COUNT of
 * 3 grants. Many small chunks in one run waste count-cap slots for no
 * benefit — the points cap alone already bounds one day's progress — so
 * this attempts ONE grant per run, sized safely under each region's known
 * daily cap, and lets consecutive DEPLOYS (real days apart) make further
 * progress, the same way `viewer.au`'s own balance organically reached 600
 * over staging's real history before this fix ever ran. A grant that lands
 * on `insufficient_available` (marketing cash) is a real failure; one that
 * lands on `velocity_capped` (F12's own cap, working as designed) is not —
 * see `ensureDemoRedemptionBalance`'s `"capped_for_today"` outcome. */
const AU_TOPUP_CHUNK_POINTS = 450;
/** ID's daily cap (5000) comfortably covers this, and the ID affordable
 * listing's own target quote (`ID_AFFORDABLE_QUOTE_TARGET_POINTS`) times
 * `REDEMPTION_HEADROOM_VOUCHERS`, so ID reaches its target in one grant. */
const ID_TOPUP_CHUNK_POINTS = 1_000;

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
    title: "Snap App voucher",
    description: "Redeem at Snap App. Show the code at the counter.",
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

export interface ExistingListingFacts {
  readonly faceValueMinor: number;
  /** F74/8.2.i (reopened) — read back so `ensureDemoRedemptionBalance`'s
   * target can be re-quoted at TODAY's live rate on every run, without this
   * seed ever storing or guessing a price itself. */
  readonly settlementValueMinor: number;
  readonly currency: string;
  readonly partialRedemptionPolicy: string;
}

export async function existingListingFacts(
  pool: pg.Pool,
  listingId: string,
): Promise<ExistingListingFacts | null> {
  const result = await pool.query<{
    face_value_minor: string;
    settlement_value_minor: string;
    currency: string;
    partial_redemption_policy: string;
  }>(
    `SELECT face_value_minor, settlement_value_minor, currency, partial_redemption_policy
       FROM store.listings WHERE id = $1`,
    [listingId],
  );
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        faceValueMinor: Number(row.face_value_minor),
        settlementValueMinor: Number(row.settlement_value_minor),
        currency: row.currency,
        partialRedemptionPolicy: row.partial_redemption_policy,
      };
}

export async function insertListing(pool: pg.Pool, listing: Listing): Promise<void> {
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
export async function postSigned(
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
export interface PriceListingRequest {
  readonly listingId: string;
  readonly region: "AU" | "ID";
  readonly currency: string;
  readonly settlementMinor: number;
}

/** Generalized so 7.2.e's own demo-media listings (`demo-media-vouchers.ts`)
 * price through the exact same real ledger call as this file's own demo
 * listing, rather than a second copy of this request/response handling. */
export async function priceListing(
  ledger: StagingLedgerConfig,
  request: PriceListingRequest,
): Promise<{ ok: true; pricePoints: number } | { ok: false; detail: string }> {
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

async function priceDemoListing(
  ledger: StagingLedgerConfig,
): Promise<{ ok: true; pricePoints: number } | { ok: false; detail: string }> {
  return priceListing(ledger, {
    listingId: DEMO_LISTING_ID,
    region: "AU",
    currency: "AUD",
    settlementMinor: DEMO_SETTLEMENT_VALUE_MINOR,
  });
}

/** Re-quotes an EXISTING listing's OWN stored settlement value at TODAY's
 * live rate — never a second guess at the price, and never the (possibly
 * stale) stored `priceInPoints` column (F74/8.2.i's reopened note: exactly
 * this staleness is why the original Check failed — 858 quoted live for a
 * listing whose price had drifted since it was first created). Used to
 * size `ensureDemoRedemptionBalance`'s target, every run. */
async function quoteExistingListing(
  pool: pg.Pool,
  ledger: StagingLedgerConfig,
  listingId: string,
  region: "AU" | "ID",
): Promise<{ ok: true; pricePoints: number } | { ok: false; detail: string }> {
  const facts = await existingListingFacts(pool, listingId);
  if (facts === null) {
    return { ok: false, detail: `listing ${listingId} does not exist yet` };
  }
  return priceListing(ledger, {
    listingId,
    region,
    currency: facts.currency,
    settlementMinor: facts.settlementValueMinor,
  });
}

/** `POST /v1/pricing/quote` — the SAME real quote route a viewer's own
 * checkout uses (`quoteCheckout`'s `deps.ledger.quote`,
 * `apps/api/src/modules/checkout/use-cases/quote-checkout.ts`), unlike
 * `/v1/pricing/listing` above: it takes no listing id and upserts nothing
 * keyed to one, so it is safe to call with a SETTLEMENT VALUE THAT HAS NO
 * LISTING YET — exactly what probing a price to create one needs. Quotes
 * are stored but expire in 15 minutes and are never locked here, so probing
 * costs nothing durable. */
async function quoteSettlement(
  ledger: StagingLedgerConfig,
  region: "AU" | "ID",
  currency: string,
  settlementMinor: number,
): Promise<{ ok: true; pricePoints: number } | { ok: false; detail: string }> {
  const request: QuoteRequest = quoteRequestSchema.parse({ region, currency, settlementMinor });
  const quoted = await postSigned(ledger, "/v1/pricing/quote", request);
  if (!quoted.ok) return { ok: false, detail: quoted.detail };
  const body = quoted.body;
  const pricePoints =
    typeof body === "object" && body !== null && "pricePoints" in body
      ? body.pricePoints
      : undefined;
  if (typeof pricePoints !== "number") {
    return { ok: false, detail: `unexpected /v1/pricing/quote response: ${JSON.stringify(body)}` };
  }
  return { ok: true, pricePoints };
}

/** F74/8.2.i (reopened) — picks a settlement value S whose LIVE quote lands
 * at or under `targetPoints`, TODAY, by probing the real checkout-quote
 * route (never the stored `priceInPoints` column, never a mock backing
 * rate — `eslint-rules/no-mock-backing-rate.mjs` refuses a new one for the
 * same reason this doesn't reach for one).
 *
 * `PriceInPoints` (`services/ledger/internal/pricing/price.go`) is an EXACT
 * proportion in S for a fixed backing rate and the neutral 1.00x demand
 * multiplier docs/09 §11 launches with (`points = ceil(S × 1e6 / B)`), so
 * one probe at a large reference S gives the current ratio; a second real
 * quote at the derived S confirms the actual price (rounding is always UP,
 * per that formula's own doc comment, so the derived S can land a touch
 * over target) — and a third, smaller attempt backs off once more in that
 * case. Never more than three real ledger calls. */
async function deriveAffordableSettlementMinor(
  ledger: StagingLedgerConfig,
  region: "AU" | "ID",
  currency: string,
  targetPoints: number,
  log: (message: string) => void,
): Promise<
  { ok: true; settlementMinor: number; pricePoints: number } | { ok: false; detail: string }
> {
  const PROBE_SETTLEMENT_MINOR = 1_000_000;
  const probe = await quoteSettlement(ledger, region, currency, PROBE_SETTLEMENT_MINOR);
  if (!probe.ok) {
    log(
      `[seed:staging] ledger /v1/pricing/quote (${region} probe) answered an error: ${probe.detail}`,
    );
    return { ok: false, detail: probe.detail };
  }

  let settlementMinor = Math.max(
    1,
    Math.floor((targetPoints * PROBE_SETTLEMENT_MINOR) / probe.pricePoints),
  );
  let final = await quoteSettlement(ledger, region, currency, settlementMinor);
  if (!final.ok) {
    log(
      `[seed:staging] ledger /v1/pricing/quote (${region} derived) answered an error: ${final.detail}`,
    );
    return { ok: false, detail: final.detail };
  }

  if (final.pricePoints > targetPoints && settlementMinor > 1) {
    settlementMinor = Math.max(1, Math.floor(settlementMinor * (targetPoints / final.pricePoints)));
    const retried = await quoteSettlement(ledger, region, currency, settlementMinor);
    if (retried.ok) final = retried;
  }
  return { ok: true, settlementMinor, pricePoints: final.pricePoints };
}

interface EnsureListingStockParams {
  readonly listingId: string;
  readonly merchantId: string;
  readonly stockTarget: number;
  /** Called only when the listing does not exist yet — builds and inserts
   * it (deriving or fixing its price however the caller needs to), and
   * returns the facts `requestBatch` needs to mint against it. */
  readonly createIfMissing: () => Promise<
    { ok: true; facts: ExistingListingFacts } | { ok: false; detail: string }
  >;
}

/**
 * The shared "keep this listing's real, minted-and-unallocated stock
 * (`voucher.vouchers WHERE state='minted'` — 7.4.c made `store.listings.
 * stock_remaining` vestigial) topped up to a target" step, factored out of
 * the original 2.3.c voucher (`ensureDemoVoucher`) so F74/8.2.i's two new
 * listings (`ensureAffordableDemoListing`) reuse the exact same real
 * batch/approve mechanics rather than a second copy of them — only WHICH
 * listing, whose business, and how a missing one gets created differ.
 *
 * One real, decryptable voucher per mint (`POST /internal/v1/batches` then
 * `POST /internal/v1/batches/approve`, a DIFFERENT approver than requester
 * — `Minter.Approve` matches no row, and answers the same error, for a
 * self-approval as for "not awaiting approval" — `services/voucher/
 * internal/issue/issue.go`). Approval mints synchronously.
 *
 * Neither voucher-service route is idempotent on its own — `requestBatch`'s
 * handler mints a fresh `uuid.New()` batch id server-side on every call, the
 * same "no caller-supplied key" gap `/economy/marketing/fund` has (this
 * file's own header on step 2) — so idempotency is this function's own:
 * counts real `state='minted'` rows and only mints the shortfall.
 *
 * Approval can return 200 with the batch merely "approved" rather than
 * "minted" — `approveBatch`'s own handler mints synchronously but only LOGS
 * a mint failure server-side, it does not fail the HTTP response (`services/
 * voucher/internal/api/batches_routes.go`) — so this re-checks
 * `voucher.vouchers` afterward rather than trusting the response shape.
 */
async function ensureListingStock(
  pool: pg.Pool,
  voucher: StagingVoucherConfig,
  params: EnsureListingStockParams,
  log: (message: string) => void,
): Promise<VoucherOutcome> {
  const existingVouchers = async (): Promise<number> => {
    const result = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM voucher.vouchers WHERE listing_id = $1",
      [params.listingId],
    );
    return Number(result.rows[0]?.count ?? "0");
  };

  const had = await existingVouchers();
  const shortfall = params.stockTarget - had;
  if (shortfall <= 0) {
    return { status: "already_present" };
  }

  let listingFacts = await existingListingFacts(pool, params.listingId);
  if (listingFacts === null) {
    const created = await params.createIfMissing();
    if (!created.ok) return { status: "failed", detail: created.detail };
    listingFacts = created.facts;
  }

  const requestBatchBody: RequestBatchRequest = requestBatchRequestSchema.parse({
    listingId: params.listingId,
    merchantId: params.merchantId,
    currency: listingFacts.currency,
    faceValueMinor: listingFacts.faceValueMinor,
    quantity: shortfall,
    partialRedemptionPolicy: listingFacts.partialRedemptionPolicy,
    requestedBy: "staging-seed-requester",
  });
  const requested = await postSigned(voucher, "/internal/v1/batches", requestBatchBody);
  if (!requested.ok) {
    log(
      `[seed:staging] voucher /internal/v1/batches (${params.listingId}) answered an error: ${requested.detail}`,
    );
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
      `[seed:staging] voucher /internal/v1/batches/approve (${params.listingId}) answered an error: ${approved.detail}`,
    );
    return { status: "failed", detail: approved.detail };
  }

  // Approval can 200 without actually minting (see this function's own
  // header) — the only trustworthy confirmation is a real row count.
  const have = await existingVouchers();
  if (have <= had) {
    const detail =
      "batches/approve answered 200 but voucher.vouchers gained no rows for the listing";
    log(`[seed:staging] ${detail}`);
    return { status: "failed", detail };
  }
  return { status: "created", detail: `had ${String(had)}, minted ${String(have - had)} more` };
}

/** Step 4 (2.3.c) — the ORIGINAL demo listing/voucher, price fixed forever
 * (`DEMO_LISTING_ID`'s own doc comment says why). Its own restore-rehearsal
 * job only needs ONE real, decryptable voucher to exist — never repriced,
 * only kept in stock. */
async function ensureDemoVoucher(
  pool: pg.Pool,
  ledger: StagingLedgerConfig,
  voucher: StagingVoucherConfig,
  log: (message: string) => void,
): Promise<VoucherOutcome> {
  return ensureListingStock(
    pool,
    voucher,
    {
      listingId: DEMO_LISTING_ID,
      merchantId: SNAP_APP_AU_ID,
      stockTarget: DEMO_VOUCHER_STOCK_TARGET,
      createIfMissing: async () => {
        const priced = await priceDemoListing(ledger);
        if (!priced.ok) {
          log(`[seed:staging] ledger /v1/pricing/listing answered an error: ${priced.detail}`);
          return { ok: false, detail: priced.detail };
        }
        const listing = buildDemoListing(priced.pricePoints);
        await insertListing(pool, listing);
        return {
          ok: true,
          facts: {
            faceValueMinor: listing.faceValueMinor,
            settlementValueMinor: listing.settlementValueMinor,
            currency: listing.currency,
            partialRedemptionPolicy: listing.partialRedemptionPolicy,
          },
        };
      },
    },
    log,
  );
}

interface AffordableListingSpec {
  readonly listingId: string;
  readonly locationId: string;
  readonly merchantId: string;
  readonly merchantName: string;
  readonly region: "AU" | "ID";
  readonly currency: string;
  readonly title: string;
  readonly locationName: string;
  readonly address: string;
  readonly district: string;
  readonly targetQuotePoints: number;
}

/** face = settlement for these: there is no merchant "margin" to model for
 * a fixture the platform owns outright — `settlementValueMinor <=
 * faceValueMinor` (docs/09 §3) still holds since they're equal. */
function buildAffordableListing(
  spec: AffordableListingSpec,
  settlementMinor: number,
  pricePoints: number,
): Listing {
  return listingSchema.parse({
    id: spec.listingId,
    merchantId: spec.merchantId,
    merchantName: spec.merchantName,
    title: spec.title,
    description:
      spec.region === "ID"
        ? "Tukarkan di Snap App. Tunjukkan kodenya di kasir."
        : "Redeem at Snap App. Show the code at the counter.",
    category: "retail",
    locations: [
      {
        id: spec.locationId,
        name: spec.locationName,
        address: spec.address,
        district: spec.district,
      },
    ],
    currency: spec.currency,
    faceValueMinor: toMinorUnits(settlementMinor),
    settlementValueMinor: toMinorUnits(settlementMinor),
    priceInPoints: pricePoints,
    stockRemaining: DEMO_VOUCHER_STOCK_TARGET,
    stockTotal: DEMO_VOUCHER_STOCK_TARGET,
    transferable: false,
    partialRedemptionPolicy: "single_use_forfeit",
    minimumSpendMinor: null,
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    status: "available",
    region: spec.region,
    audience: "all_ages",
    contentCategory: "services",
    imageUrl: "http://127.0.0.1:26900/yourtal-media/listings/snap-app-au-demo.jpg",
    channel: "in_store",
    partialRedemption: "single_use",
  });
}

/** F74/8.2.i (reopened) — the two NEW, cheap-by-construction listings
 * (`AU_AFFORDABLE_LISTING_ID`/`ID_LISTING_ID`). Priced ONLY once, at
 * creation, via `deriveAffordableSettlementMinor` — never re-priced on a
 * later run (this file never edits a listing's settlement value after
 * creation; see `AU_AFFORDABLE_LISTING_ID`'s own doc for why). Stock is
 * still kept topped up every run, same as the original 2.3.c listing. */
async function ensureAffordableDemoListing(
  pool: pg.Pool,
  ledger: StagingLedgerConfig,
  voucher: StagingVoucherConfig,
  spec: AffordableListingSpec,
  log: (message: string) => void,
): Promise<VoucherOutcome> {
  return ensureListingStock(
    pool,
    voucher,
    {
      listingId: spec.listingId,
      merchantId: spec.merchantId,
      stockTarget: DEMO_VOUCHER_STOCK_TARGET,
      createIfMissing: async () => {
        const derived = await deriveAffordableSettlementMinor(
          ledger,
          spec.region,
          spec.currency,
          spec.targetQuotePoints,
          log,
        );
        if (!derived.ok) return { ok: false, detail: derived.detail };
        const listing = buildAffordableListing(spec, derived.settlementMinor, derived.pricePoints);
        await insertListing(pool, listing);
        return {
          ok: true,
          facts: {
            faceValueMinor: listing.faceValueMinor,
            settlementValueMinor: listing.settlementValueMinor,
            currency: listing.currency,
            partialRedemptionPolicy: listing.partialRedemptionPolicy,
          },
        };
      },
    },
    log,
  );
}

/** F74/8.2.i — Step 5: each demo viewer's own AVAILABLE balance (trustTier 3,
 * so `contractGrant` posts it straight to `available`, never `pending` — the
 * tier-0 grant above is deliberately the opposite), topped up until it
 * affords several vouchers at TODAY's live quote. Never minted without cash:
 * `kind: "goodwill"` is the exact same marketing-cash-backed `GrantAction`
 * step 3 already uses — there is no separate "business allocation" grant
 * kind for demo balances, and this file never writes a `ledger.entry` row
 * directly (see the file header's "no raw SQL" rule).
 *
 * Why several vouchers, not one: `platform.listing_points` reprices
 * continuously (4.9.a) — a balance sized for exactly one quote goes stale
 * the moment the price drifts up, which is exactly how 8.2.e's own staging
 * Check failed (858 points quoted live, viewer.au had 600).
 *
 * # ONE grant attempt per run, never a tight loop of small chunks
 *
 * Verified against a REAL ledger (not the fake `staging.test.ts` uses):
 * `checkCaps` (`services/ledger/internal/reward/caps.go`) enforces F12's
 * daily earn cap — a POINTS sum, per user, across every action and funding
 * source, region-wide — regardless of `kind` or trust tier. A tight loop of
 * many small grants in one run does not "make more progress" once that
 * day's allowance is used; it only burns `kind: "goodwill"`'s own 3-per-day
 * COUNT cap for nothing. So this makes exactly one attempt, sized to
 * `chunkPoints` (kept safely under each region's known daily cap — see
 * `AU_TOPUP_CHUNK_POINTS`/`ID_TOPUP_CHUNK_POINTS`), and lets FURTHER
 * deploys — real days apart — make the rest of the progress, the same way
 * `viewer.au`'s own balance organically reached 600 over staging's real
 * history before this function ever ran.
 *
 * The idempotencyKey is DERIVED from the observed balance
 * (`floor(available / chunkPoints) + 1`), not a locally-incremented
 * counter: a capped attempt is never stored (the ledger refuses before
 * writing anything), so the NEXT run recomputes the SAME index and retries
 * the identical key; a grant that actually landed moves `available` up by
 * `chunkPoints`, so the next run derives the NEXT index on its own — no
 * separate progress row to keep in sync.
 *
 * `velocity_capped` (F12's cap doing exactly its job) is reported as
 * `"capped_for_today"`, never `"failed"` — see `DemoBalanceResult`'s own
 * doc. Anything else (`insufficient_available`, a network error, an
 * unexpected response) is a real problem and stays `"failed"`. */
async function ensureDemoRedemptionBalance(
  ledger: StagingLedgerConfig,
  userId: string,
  region: "AU" | "ID",
  targetPoints: number,
  chunkPoints: number,
  log: (message: string) => void,
): Promise<DemoBalanceResult> {
  const before = await walletAvailablePoints(ledger, userId);
  if (!before.ok) {
    log(`[seed:staging] ledger /v1/wallet/balance answered an error: ${before.detail}`);
    return { region, status: "failed", detail: before.detail };
  }
  if (before.availablePoints >= targetPoints) {
    return {
      region,
      status: "already_sufficient",
      availablePoints: before.availablePoints,
      targetPoints,
    };
  }

  const chunkIndex = Math.floor(before.availablePoints / chunkPoints) + 1;
  const request: GrantActionRequest = grantActionRequestSchema.parse({
    kind: "goodwill",
    userId,
    region,
    points: toPoints(chunkPoints),
    trustTier: 3,
    ageBand: "adult",
    idempotencyKey: `staging-seed-viewer-${region}-topup-${String(chunkIndex)}`,
  });
  const granted = await postSigned(ledger, "/v1/actions/grants", request);
  if (!granted.ok) {
    if (granted.detail === "velocity_capped") {
      log(
        `[seed:staging] ${region} redemption balance top-up hit today's F12 earn cap — ` +
          `expected, not a failure; it tries again on a later day ` +
          `(available ${String(before.availablePoints)}/${String(targetPoints)}).`,
      );
      return {
        region,
        status: "capped_for_today",
        detail: granted.detail,
        availablePoints: before.availablePoints,
        targetPoints,
      };
    }
    log(
      `[seed:staging] ledger /v1/actions/grants (${region} topup) answered an error: ${granted.detail}`,
    );
    return {
      region,
      status: "failed",
      detail: granted.detail,
      availablePoints: before.availablePoints,
      targetPoints,
    };
  }

  const after = await walletAvailablePoints(ledger, userId);
  if (!after.ok) {
    log(`[seed:staging] ledger /v1/wallet/balance (post-topup) answered an error: ${after.detail}`);
    return { region, status: "failed", detail: after.detail, targetPoints };
  }
  return { region, status: "topped_up", availablePoints: after.availablePoints, targetPoints };
}

/** `POST /v1/wallet/balance` — the same real ledger route `apps/api`'s own
 * wallet module reads (`services/ledger/internal/api/earning_routes.go`'s
 * `balance`), reused here rather than a raw SQL balance query for the same
 * reason step 3 makes a real grant call instead of a raw insert. */
async function walletAvailablePoints(
  ledger: StagingLedgerConfig,
  userId: string,
): Promise<{ ok: true; availablePoints: number } | { ok: false; detail: string }> {
  const result = await postSigned(ledger, "/v1/wallet/balance", { userId });
  if (!result.ok) return { ok: false, detail: result.detail };
  const body = result.body;
  const availablePoints =
    typeof body === "object" && body !== null && "availablePoints" in body
      ? body.availablePoints
      : undefined;
  if (typeof availablePoints !== "number") {
    return {
      ok: false,
      detail: `unexpected /v1/wallet/balance response: ${JSON.stringify(body)}`,
    };
  }
  return { ok: true, availablePoints };
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
        "identity.user_profile this seed did not create) — skipping the pending grant, " +
        "the demo voucher, the affordable listings and the redemption balance top-up.",
    );
    return {
      ...base,
      pendingGrant: "skipped",
      demoVoucher: "skipped",
      redemptionBalance: [],
      affordableListings: [],
    };
  }

  const grant = await ensureTierZeroPendingGrant(
    options.ledger,
    world.viewerUserId,
    log,
    options.replayDetectionWindowMs ?? REPLAY_DETECTION_WINDOW_MS,
  );
  const voucher = await ensureDemoVoucher(pool, options.ledger, options.voucher, log);

  // F74/8.2.i (reopened) — a SECOND AU listing and the first ID one, both
  // cheap by construction (see `AU_AFFORDABLE_LISTING_ID`'s own doc for why
  // this is a new listing rather than a re-price of `DEMO_LISTING_ID`).
  const auListing = await ensureAffordableDemoListing(
    pool,
    options.ledger,
    options.voucher,
    {
      listingId: AU_AFFORDABLE_LISTING_ID,
      locationId: AU_AFFORDABLE_LOCATION_ID,
      merchantId: SNAP_APP_AU_ID,
      merchantName: "Snap App",
      region: "AU",
      currency: "AUD",
      title: "Snap App starter voucher",
      locationName: "Snap App — Pyrmont",
      address: "2 Refinery Drive, Pyrmont NSW 2009",
      district: "Pyrmont",
      targetQuotePoints: AU_AFFORDABLE_QUOTE_TARGET_POINTS,
    },
    log,
  );
  const idListing = await ensureAffordableDemoListing(
    pool,
    options.ledger,
    options.voucher,
    {
      listingId: ID_LISTING_ID,
      locationId: ID_LOCATION_ID,
      merchantId: SNAP_APP_ID_ID,
      merchantName: "Snap App",
      region: "ID",
      currency: "IDR",
      title: "Voucher hemat Snap App",
      locationName: "Snap App — Kemang",
      address: "Jl. Kemang Raya No. 8, Jakarta Selatan",
      district: "Kemang",
      targetQuotePoints: ID_AFFORDABLE_QUOTE_TARGET_POINTS,
    },
    log,
  );
  const affordableListings: AffordableListingResult[] = [
    {
      region: "AU",
      listingId: AU_AFFORDABLE_LISTING_ID,
      locationId: AU_AFFORDABLE_LOCATION_ID,
      status: auListing.status,
      ...(auListing.detail === undefined ? {} : { detail: auListing.detail }),
    },
    {
      region: "ID",
      listingId: ID_LISTING_ID,
      locationId: ID_LOCATION_ID,
      status: idListing.status,
      ...(idListing.detail === undefined ? {} : { detail: idListing.detail }),
    },
  ];

  // Each region's target tracks TODAY's live quote of ITS OWN affordable
  // listing (see `quoteExistingListing`'s own header) — re-quoted every
  // run, never cached from the listing's own creation call, so a later
  // price drift is caught on the very next deploy without ever editing the
  // listing itself.
  const redemptionBalance: DemoBalanceResult[] = [];
  const auQuote = await quoteExistingListing(pool, options.ledger, AU_AFFORDABLE_LISTING_ID, "AU");
  if (!auQuote.ok) {
    log(
      "[seed:staging] could not re-quote the AU affordable listing, so the AU viewer's " +
        `redemption balance was not topped up: ${auQuote.detail}`,
    );
    redemptionBalance.push({ region: "AU", status: "failed", detail: auQuote.detail });
  } else {
    const auTargetPoints = auQuote.pricePoints * REDEMPTION_HEADROOM_VOUCHERS;
    redemptionBalance.push(
      await ensureDemoRedemptionBalance(
        options.ledger,
        world.viewerUserId,
        "AU",
        auTargetPoints,
        AU_TOPUP_CHUNK_POINTS,
        log,
      ),
    );
  }
  if (world.viewerIdUserId !== null) {
    const idQuote = await quoteExistingListing(pool, options.ledger, ID_LISTING_ID, "ID");
    if (!idQuote.ok) {
      log(
        "[seed:staging] could not re-quote the ID affordable listing, so the ID viewer's " +
          `redemption balance was not topped up: ${idQuote.detail}`,
      );
      redemptionBalance.push({ region: "ID", status: "failed", detail: idQuote.detail });
    } else {
      const idTargetPoints = idQuote.pricePoints * REDEMPTION_HEADROOM_VOUCHERS;
      redemptionBalance.push(
        await ensureDemoRedemptionBalance(
          options.ledger,
          world.viewerIdUserId,
          "ID",
          idTargetPoints,
          ID_TOPUP_CHUNK_POINTS,
          log,
        ),
      );
    }
  }

  return {
    ...base,
    pendingGrant: grant.status,
    ...(grant.detail === undefined ? {} : { pendingGrantDetail: grant.detail }),
    demoVoucher: voucher.status,
    ...(voucher.detail === undefined ? {} : { demoVoucherDetail: voucher.detail }),
    redemptionBalance,
    affordableListings,
  };
}
