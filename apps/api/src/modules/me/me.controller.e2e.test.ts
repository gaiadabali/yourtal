import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { DrizzleCampaignRepository } from "../campaign/persistence/drizzle-campaign.repository";

/**
 * 5.4/5.5, end to end against the real app, real Postgres and this
 * worktree's own Cerbos (started with `pnpm dev:cerbos`, per this session's
 * final report — the shared slot-2 sidecar does not carry the `me` policy
 * files this ticket adds).
 */
let app: NestFastifyApplication;
const db: AppDb = createAppDb(
  process.env["DATABASE_URL"] ?? process.env["TEST_DATABASE_URL"] ?? "",
);
const campaigns = new DrizzleCampaignRepository(db);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET/POST /api/me/consents", () => {
  it("withdrawing a consent is recorded and returned as the latest for that purpose", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });

    const granted = await app.inject({
      method: "POST",
      url: "/api/me/consents",
      headers: { cookie: session.cookie },
      payload: {
        purpose: "declared_interest_targeting",
        state: "granted",
        source: "settings_toggle",
      },
    });
    expect(granted.statusCode).toBe(201);

    const withdrawn = await app.inject({
      method: "POST",
      url: "/api/me/consents",
      headers: { cookie: session.cookie },
      payload: {
        purpose: "declared_interest_targeting",
        state: "withdrawn",
        source: "settings_toggle",
      },
    });
    expect(withdrawn.statusCode).toBe(201);

    const listed = await app.inject({
      method: "GET",
      url: "/api/me/consents",
      headers: { cookie: session.cookie },
    });
    expect(listed.statusCode).toBe(200);
    const body = listed.json<{ consents: { purpose: string; state: string }[] }>();
    const found = body.consents.find((c) => c.purpose === "declared_interest_targeting");
    expect(found?.state).toBe("withdrawn");
  });

  it("refuses an anonymous caller with 401", async () => {
    const response = await app.inject({ method: "GET", url: "/api/me/consents" });
    expect(response.statusCode).toBe(401);
  });
});

describe("GET/PUT /api/me/interests", () => {
  it("replaces the declared set and refuses an unknown node", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });

    const bad = await app.inject({
      method: "PUT",
      url: "/api/me/interests",
      headers: { cookie: session.cookie },
      payload: { nodeIds: ["not-a-real-node"] },
    });
    expect(bad.statusCode).toBe(400);

    const put = await app.inject({
      method: "PUT",
      url: "/api/me/interests",
      headers: { cookie: session.cookie },
      payload: { nodeIds: ["coffee", "fitness"] },
    });
    expect(put.statusCode).toBe(200);

    const listed = await app.inject({
      method: "GET",
      url: "/api/me/interests",
      headers: { cookie: session.cookie },
    });
    expect(listed.json<{ nodeIds: string[] }>().nodeIds.sort()).toEqual(["coffee", "fitness"]);
  });
});

/** No business is seeded (`src/seed.ts` never inserts `business.business_accounts`) — this suite owns its own fixture row. */
async function seedBusiness(region: "AU" | "ID"): Promise<string> {
  const id = randomUUID();
  const handle = `me-e2e-${id.slice(0, 8)}`;
  await db.execute(sql`
    INSERT INTO business.business_accounts (id, legal_name, display_name, district, roles, region, currency, handle)
    VALUES (${id}, 'Me E2E Pty Ltd', 'Me E2E', 'Test District', '["advertiser"]'::jsonb, ${region},
            ${region === "AU" ? "AUD" : "IDR"}, ${handle})
  `);
  return id;
}

describe("GET/PUT/DELETE /api/me/follows/:businessId", () => {
  it("follows and unfollows a real AU business", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await seedBusiness("AU");

    const followed = await app.inject({
      method: "PUT",
      url: `/api/me/follows/${businessId}`,
      headers: { cookie: session.cookie },
    });
    expect(followed.statusCode).toBe(200);

    const listed = await app.inject({
      method: "GET",
      url: "/api/me/follows",
      headers: { cookie: session.cookie },
    });
    expect(
      listed.json<{ follows: { businessId: string }[] }>().follows.map((f) => f.businessId),
    ).toContain(businessId);

    const unfollowed = await app.inject({
      method: "DELETE",
      url: `/api/me/follows/${businessId}`,
      headers: { cookie: session.cookie },
    });
    expect(unfollowed.statusCode).toBe(200);
  });

  it("refuses to follow a business in a different region (F2)", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const businessId = await seedBusiness("ID");

    const response = await app.inject({
      method: "PUT",
      url: `/api/me/follows/${businessId}`,
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET/PUT/DELETE /api/me/saves/:campaignId", () => {
  it("saves and unsaves a real campaign", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const visible = await campaigns.listVisible(1);
    const campaignId = visible[0]?.id;
    expect(campaignId, "expected at least one seeded campaign").toBeDefined();

    const saved = await app.inject({
      method: "PUT",
      url: `/api/me/saves/${String(campaignId)}`,
      headers: { cookie: session.cookie },
    });
    expect(saved.statusCode).toBe(200);

    const listed = await app.inject({
      method: "GET",
      url: "/api/me/saves",
      headers: { cookie: session.cookie },
    });
    expect(listed.json<{ campaignIds: string[] }>().campaignIds).toContain(campaignId);

    const unsaved = await app.inject({
      method: "DELETE",
      url: `/api/me/saves/${String(campaignId)}`,
      headers: { cookie: session.cookie },
    });
    expect(unsaved.statusCode).toBe(200);
  });
});

describe("GET /api/me/sessions (continue watching)", () => {
  it("lists a parked (superseded) session with its coverage", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const visible = await campaigns.listVisible(1);
    const campaignId = visible[0]?.id;
    const termsVersion = await campaigns.currentTermsVersion(String(campaignId));
    const sessionId = randomUUID();
    const now = new Date();

    await db.execute(sql`
      INSERT INTO watch.session (id, user_id, campaign_id, terms_version, state, started_at, last_progress_at, completed_at)
      VALUES (${sessionId}, ${session.userId}, ${campaignId}, ${termsVersion}, 'superseded', ${now}, ${now}, NULL)
    `);
    await db.execute(sql`
      INSERT INTO watch.coverage (session_id, from_second, to_second, recorded_at)
      VALUES (${sessionId}, 0, 42, ${now})
    `);

    const response = await app.inject({
      method: "GET",
      url: "/api/me/sessions",
      headers: { cookie: session.cookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      sessions: { sessionId: string; coveredSeconds: number }[];
    }>();
    const found = body.sessions.find((s) => s.sessionId === sessionId);
    expect(found?.coveredSeconds).toBe(42);
  });
});

describe("GET/PUT /api/me/notifications", () => {
  it("reads back a stored notification and toggles a preference", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    await db.execute(sql`
      INSERT INTO me.notification (user_id, region, category, title, body)
      VALUES (${session.userId}, 'AU', 'points_unlocked', 'Points unlocked', '5 pts are now available.')
    `);

    const listed = await app.inject({
      method: "GET",
      url: "/api/me/notifications",
      headers: { cookie: session.cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(
      listed
        .json<{ notifications: { category: string }[] }>()
        .notifications.some((n) => n.category === "points_unlocked"),
    ).toBe(true);

    const setPref = await app.inject({
      method: "PUT",
      url: "/api/me/notifications/preferences/points_unlocked",
      headers: { cookie: session.cookie },
      payload: { pushEnabled: false },
    });
    expect(setPref.statusCode).toBe(200);

    const prefs = await app.inject({
      method: "GET",
      url: "/api/me/notifications/preferences",
      headers: { cookie: session.cookie },
    });
    expect(
      prefs.json<{ preferences: Record<string, boolean> }>().preferences["points_unlocked"],
    ).toBe(false);
  });
});

describe("POST /api/me/linked-apps/code", () => {
  it("issues a one-time code with an expiry", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const response = await app.inject({
      method: "POST",
      url: "/api/me/linked-apps/code",
      headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<{ code: string; expiresAt: string }>();
    expect(body.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("GET /api/me/data-export and DELETE /api/me", () => {
  it("exports the caller's own data, then deletion removes the profile and ends the session", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });

    await app.inject({
      method: "POST",
      url: "/api/me/consents",
      headers: { cookie: session.cookie },
      payload: { purpose: "marketing_communications", state: "granted", source: "settings_toggle" },
    });

    const exported = await app.inject({
      method: "GET",
      url: "/api/me/data-export",
      headers: { cookie: session.cookie },
    });
    expect(exported.statusCode).toBe(200);
    const exportBody = exported.json<{ consents: unknown[]; otherDataDomains: { id: string }[] }>();
    expect(exportBody.consents.length).toBeGreaterThan(0);
    expect(exportBody.otherDataDomains.some((d) => d.id === "ledger")).toBe(true);

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
    });
    expect(deleted.statusCode).toBe(200);
    const report = deleted.json<{
      complete: boolean;
      results: { domain: string; outcome: { status: string } }[];
    }>();
    const identity = report.results.find((r) => r.domain === "identity");
    expect(identity?.outcome.status).toBe("erased");

    // The session row identity's handler just deleted no longer validates.
    const after = await app.inject({
      method: "GET",
      url: "/api/me/consents",
      headers: { cookie: session.cookie },
    });
    expect(after.statusCode).toBe(401);
  });
});
