import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toMinorUnits } from "@yourtal/contracts/money";
import { AppModule } from "../../../app.module";
import { createAppDb } from "../../../shared/persistence/drizzle-client";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { LEDGER_INTERNAL_CLIENT } from "../../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import { sessionFor } from "../../../shared/testing/session-for";
import type { TestSession } from "../../../shared/testing/session-for";
import { DevTokenAccess } from "../dev-token-access";
import { partnerKit, receipt } from "../../partners/testing/partner-e2e-kit";

/**
 * F126 over the real stack (Nest, Cerbos, Postgres, Valkey, the fake-mode
 * ledger): with the AU region setting switched on, an account earns nothing
 * until its sign-in email is verified (the real token flow), and never while
 * that email is a disposable address.
 */
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
let app: NestFastifyApplication;
let kit: ReturnType<typeof partnerKit>;

const DURATION = 30;
const REWARD = 100;
const allocationId = randomUUID();
const businessId = randomUUID();
const campaignId = randomUUID();

/** A fresh sign-in address on a listed disposable domain (a subdomain, to cover both matches). */
const disposableEmail = () => `identity-check+${randomUUID()}@inbox.mailinator.com`;

async function seedCampaign(): Promise<void> {
  await owner.execute(sql`
    INSERT INTO platform.ledger_fake_allocation (id, business_id, region, funder_type, currency, total_points, remaining_points)
    VALUES (${allocationId}, ${businessId}, 'AU', 'partner', 'AUD', 1000000, 1000000)
  `);
  await owner.execute(sql`
    INSERT INTO campaign.campaigns
      (id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
       estimated_data_mb, reward_points, question_count, scoring_rule,
       lifecycle_state, published_at, business_id, region, audience, content_category,
       poster_url, teaser_url, hls_url, aspect, estimated_bytes,
       starts_at, ends_at, open_viewing, teaser_start_seconds, target_districts)
    VALUES
      (${campaignId}, 'quick', 'F126 identity check fixture', ${randomUUID()}, 'identity merchant',
       'fixture', ${DURATION}, 5, ${REWARD}, 0, 'base_only',
       'live', now(), ${businessId}, 'AU', 'all_ages', 'entertainment',
       'https://example.test/poster.jpg', 'https://example.test/teaser.m3u8',
       'https://example.test/hls.m3u8', '16:9', 1000000,
       now() - interval '1 hour', now() + interval '30 days', false, 0, '[]'::jsonb)
  `);
  await owner.execute(sql`
    INSERT INTO campaign.terms_version
      (campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds, accuracy_bonus_points, effective_from)
    VALUES (${campaignId}, 1, ${REWARD}, 0, 'base_only', ${DURATION}, 0, now())
  `);
  await owner.execute(sql`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES (${campaignId}, 'hls', 'https://example.test/hls.m3u8')
  `);
  await owner.execute(sql`
    INSERT INTO campaign.reward_config
      (campaign_id, allocation_id, funder_type, max_points_for_campaign,
       reward_points_per_completion, accuracy_bonus_points, daily_cap_points)
    VALUES (${campaignId}, ${allocationId}, 'partner', ${100 * REWARD}, ${REWARD}, 0, NULL)
  `);
}

beforeAll(async () => {
  // Switched on for AU the way staff would: a newer approved row wins.
  await owner.execute(sql`
    INSERT INTO platform.region_setting (region, key, value, set_by, approved_by, effective_from)
    VALUES ('AU', 'points_identity_check', '{"enabled": true}'::jsonb, 'test-a', 'test-b', clock_timestamp())
  `);
  await seedCampaign();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  // rawBody: the partner HMAC is checked against the raw bytes (main.ts passes the same).
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const funded = await app.get<LedgerInternalClient>(LEDGER_INTERNAL_CLIENT).fundMarketing({
    region: "AU",
    amountMinor: toMinorUnits(500_000),
    proposedBy: "staff-1",
    approvedBy: "staff-2",
  });
  if (funded.isErr()) throw new Error(`funding AU: ${funded.error.message}`);
  kit = partnerKit(app, owner);
});

afterAll(async () => {
  await app.close();
  // The shared database: AU goes back to the seeded "off".
  await owner.execute(
    sql`DELETE FROM platform.region_setting WHERE key = 'points_identity_check' AND set_by = 'test-a'`,
  );
  await owner.execute(
    sql`DELETE FROM platform.ledger_fake_hold WHERE allocation_id = ${allocationId}`,
  );
  await owner.execute(
    sql`DELETE FROM platform.ledger_fake_grant WHERE campaign_id = ${campaignId}`,
  );
  await owner.execute(sql`DELETE FROM watch.session WHERE campaign_id = ${campaignId}`);
  await owner.execute(sql`DELETE FROM campaign.reward_config WHERE campaign_id = ${campaignId}`);
  await owner.execute(sql`DELETE FROM campaign.terms_version WHERE campaign_id = ${campaignId}`);
  await owner.execute(sql`DELETE FROM campaign.video_source WHERE campaign_id = ${campaignId}`);
  await owner.execute(sql`DELETE FROM campaign.campaigns WHERE id = ${campaignId}`);
  await owner.execute(sql`DELETE FROM platform.ledger_fake_allocation WHERE id = ${allocationId}`);
});

interface Started {
  session: {
    id: string;
    nonEarning: boolean;
    nonEarningReason: string | null;
    holdId: string | null;
  };
  identityCheck?: { missing: string[] };
}

async function start(viewer: TestSession): Promise<Started> {
  const response = await app.inject({
    method: "POST",
    url: "/api/watch/sessions",
    headers: { cookie: viewer.cookie, "idempotency-key": randomUUID() },
    payload: { campaignId },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<Started>();
}

async function watchAndComplete(viewer: TestSession, sessionId: string) {
  await owner.execute(
    sql`UPDATE watch.session SET started_at = now() - make_interval(secs => ${DURATION + 5}) WHERE id = ${sessionId}`,
  );
  const progress = await app.inject({
    method: "POST",
    url: `/api/watch/sessions/${sessionId}/progress`,
    headers: { cookie: viewer.cookie },
    payload: { fromSeconds: 0, toSeconds: DURATION, reportedAt: new Date().toISOString() },
  });
  expect(progress.statusCode, progress.body).toBe(201);
  const complete = await app.inject({
    method: "POST",
    url: `/api/watch/sessions/${sessionId}/complete`,
    headers: { cookie: viewer.cookie, "idempotency-key": randomUUID() },
  });
  expect(complete.statusCode, complete.body).toBe(201);
  return complete.json<{ granted: boolean; pendingPoints: number; reason?: string | null }>();
}

/** The real email-verification flow: the token registration sent, confirmed. */
async function verifyEmail(viewer: TestSession): Promise<void> {
  const token = app.get(DevTokenAccess).peekToken("email_verification", viewer.userId, Date.now());
  expect(token).toBeDefined();
  const confirmed = await app.inject({
    method: "POST",
    url: "/api/auth/email/verify/confirm",
    headers: { "idempotency-key": randomUUID() },
    payload: { token },
  });
  expect(confirmed.statusCode, confirmed.body).toBe(201);
}

/** Sets `verified_at` directly, for accounts whose point is what comes after the verification. */
async function setVerifiedAt(viewer: TestSession, verified: boolean): Promise<void> {
  await owner.execute(
    verified
      ? sql`UPDATE identity.credential SET verified_at = now() WHERE user_id = ${viewer.userId} AND kind = 'password'`
      : sql`UPDATE identity.credential SET verified_at = NULL WHERE user_id = ${viewer.userId} AND kind = 'password'`,
  );
}

async function grantsFor(userId: string): Promise<number> {
  const { rows } = await owner.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM platform.ledger_fake_grant WHERE user_id = ${userId}`,
  );
  return rows[0]?.n ?? 0;
}

async function holdState(sessionId: string): Promise<string | undefined> {
  const { rows } = await owner.execute<{ state: string }>(sql`
    SELECT h.state FROM platform.ledger_fake_hold h
      JOIN watch.session s ON s.hold_id = h.id WHERE s.id = ${sessionId}
  `);
  return rows[0]?.state;
}

describe("F126: watching, with the region's identity check on", () => {
  it("an account with an unverified email watches without earning: no hold, no grant, and the step named", async () => {
    const viewer = await sessionFor(app);
    const started = await start(viewer);
    expect(started.session).toMatchObject({
      nonEarning: true,
      nonEarningReason: "identity_check_required",
      holdId: null,
    });
    expect(started.identityCheck).toEqual({ missing: ["verify_email"] });

    const completed = await watchAndComplete(viewer, started.session.id);
    expect(completed).toMatchObject({
      granted: false,
      pendingPoints: 0,
      reason: "identity_check_required",
    });
    expect(await grantsFor(viewer.userId)).toBe(0);
  });

  it("after the email is verified the next start is a fresh, earning attempt that pays", async () => {
    const viewer = await sessionFor(app);
    const refused = await start(viewer);
    expect(refused.session.nonEarningReason).toBe("identity_check_required");

    await verifyEmail(viewer);
    const earning = await start(viewer);
    expect(earning.session.id).not.toBe(refused.session.id);
    expect(earning.session.nonEarning).toBe(false);
    expect(earning.session.holdId).not.toBeNull();
    expect(earning.identityCheck).toBeUndefined();
    const { rows } = await owner.execute<{ state: string }>(
      sql`SELECT state FROM watch.session WHERE id = ${refused.session.id}`,
    );
    expect(rows[0]?.state).toBe("superseded");

    const paid = await watchAndComplete(viewer, earning.session.id);
    expect(paid).toMatchObject({ granted: true, pendingPoints: REWARD });
    expect(await holdState(earning.session.id)).toBe("consumed");
    expect(await grantsFor(viewer.userId)).toBe(1);
  });

  it("a session that started earning pays nothing if the check no longer passes at completion, and its hold is released", async () => {
    const viewer = await sessionFor(app);
    await verifyEmail(viewer);
    const earning = await start(viewer);
    expect(earning.session.nonEarning).toBe(false);

    await setVerifiedAt(viewer, false);
    const unpaid = await watchAndComplete(viewer, earning.session.id);
    expect(unpaid).toMatchObject({
      granted: false,
      pendingPoints: 0,
      reason: "identity_check_required",
    });
    expect(await holdState(earning.session.id)).toBe("released");
    expect(await grantsFor(viewer.userId)).toBe(0);
  });

  it("a disposable-domain account is refused even when its email is verified", async () => {
    const viewer = await sessionFor(app, { email: disposableEmail() });
    await setVerifiedAt(viewer, true);
    const started = await start(viewer);
    expect(started.session).toMatchObject({
      nonEarning: true,
      nonEarningReason: "identity_check_required",
      holdId: null,
    });
    expect(started.identityCheck).toEqual({ missing: ["use_permanent_email"] });
    expect((await watchAndComplete(viewer, started.session.id)).granted).toBe(false);
    expect(await grantsFor(viewer.userId)).toBe(0);
  });

  it("an unverified disposable account is told both things at once", async () => {
    const viewer = await sessionFor(app, { email: disposableEmail() });
    const started = await start(viewer);
    expect(started.identityCheck).toEqual({ missing: ["verify_email", "use_permanent_email"] });
  });
});

describe("F126: partner receipts, with the region's identity check on", () => {
  it("refuses a receipt with identity_check_required and missing, records nothing, and pays once the account passes", async () => {
    const partner = await kit.seedPartner();
    await kit.fundReceipts(partner, "AU");
    const viewer = await sessionFor(app);
    const { code } = (await kit.issueCode(viewer.cookie)).json<{ code: string }>();
    const scan = { user: code, action: "receipt_scanned", externalRef: `receipt-${randomUUID()}` };

    const refused = await kit.partnerPost(partner, "actions", scan);
    expect(refused.statusCode, refused.body).toBe(403);
    const body = refused.json<{ code: string; linkId?: string; missing?: string[] }>();
    expect(body.code).toBe("identity_check_required");
    expect(body.missing).toEqual(["verify_email"]);
    expect(body.linkId).toBeDefined();
    const { rows } = await owner.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM platform.partner_receipt WHERE user_id = ${viewer.userId}`,
    );
    expect(rows[0]?.n).toBe(0);
    expect(await kit.availablePoints(viewer.cookie)).toBe(0);
    expect(await grantsFor(viewer.userId)).toBe(0);

    await verifyEmail(viewer);
    const paid = await kit.partnerPost(partner, "actions", receipt(body.linkId ?? ""));
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json<{ granted: boolean }>().granted).toBe(true);
    expect(await grantsFor(viewer.userId)).toBe(1);
  });

  it("refuses a disposable-domain account's receipt even when its email is verified", async () => {
    const partner = await kit.seedPartner();
    await kit.fundReceipts(partner, "AU");
    const viewer = await sessionFor(app, { email: disposableEmail() });
    await setVerifiedAt(viewer, true);
    const { code } = (await kit.issueCode(viewer.cookie)).json<{ code: string }>();

    const refused = await kit.partnerPost(partner, "actions", {
      user: code,
      action: "receipt_scanned",
      externalRef: `receipt-${randomUUID()}`,
    });
    expect(refused.statusCode, refused.body).toBe(403);
    expect(refused.json<{ code: string; missing: string[] }>()).toMatchObject({
      code: "identity_check_required",
      missing: ["use_permanent_email"],
    });
    expect(await grantsFor(viewer.userId)).toBe(0);
  });
});
