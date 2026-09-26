import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { createAppDb } from "../persistence/drizzle-client";
import type { AppDb } from "../persistence/drizzle-client";
import { sessionFor } from "../testing/session-for";

/**
 * 1.5.g's Check, over the real HTTP stack (`PrincipalService` + `PdpGuard`
 * + a real Cerbos), not a hand-wired guard:
 *
 *   1. a call presenting `x-yt-user-id` with no session gets 401 (F30 —
 *      no session, not merely denied; a SIGNED-IN principal Cerbos refuses
 *      still gets 403, proved in (2) below on the same route family);
 *   2. an ID principal reading an AU campaign is denied BY CERBOS
 *      (`campaign_view.yaml`'s `f2-region-wall`), not by anything in the web
 *      layer;
 *   3. the route suites already prove (3) — this file is (1) and (2) only.
 *
 * Run with `.env` sourced (`PDP_BASE_URL=http://127.0.0.1:26335`, this
 * worktree's own Cerbos, mounting this worktree's own `policies/`) so a
 * schema or policy change still uncommitted here is what gets asked, not
 * whatever `yourtal-cerbos` (26592, shared) last saw merged.
 */

const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app.close();
});

describe("1.5.g's Check (1): x-yt-user-id with no session", () => {
  it("gets 401, not 403 (F30) — the header is not read at all, so this is exactly the anonymous case", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { "x-yt-user-id": "someone-i-am-not" },
    });

    // PrincipalService no longer inspects x-yt-* at all
    // (principal.service.test.ts proves that directly), so this request
    // carries no credential whatsoever and reaches PdpGuard as
    // `anonymousPrincipal` — the SAME principal a request with no headers at
    // all produces (proved right below). `PdpGuard`'s own F30 branch maps an
    // anonymous DENY to 401/no_session rather than the usual 403/forbidden
    // `authz-error.mapper.ts` produces for a SIGNED-IN principal Cerbos
    // refuses (proved for exactly that case in (2) below, on the campaign
    // route family) — "sign in" is the correct instruction here, not "you
    // lack permission", since there is no session to speak of.
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: "no_session" });
  });

  it("is refused identically to a request with no headers at all — proof the header has zero effect", async () => {
    const withHeader = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { "x-yt-user-id": "someone-i-am-not", "x-yt-business-roles": "{}" },
    });
    const withNothing = await app.inject({ method: "GET", url: "/api/me" });

    expect(withHeader.statusCode).toBe(withNothing.statusCode);
    expect(withHeader.json()).toStrictEqual(withNothing.json());
  });
});

describe("1.5.g's Check (2): an ID principal reading an AU campaign is denied by Cerbos", () => {
  it("region_mismatch — enforced by campaign_view.yaml's f2-region-wall, not the UI", async () => {
    // The seeded catalogue is ID-only (campaign.mock.ts) — flip one LIVE,
    // visible campaign to AU directly in the database, the same technique
    // checkout.controller.test.ts's buyableListing() uses for the same
    // reason. Picking a `live` row (rather than merely visible) means the
    // ALLOW rule's own state=="live" condition is satisfied too, so the
    // f2-region-wall DENY is the ONLY thing standing between allow and
    // deny — isolating exactly what this check exists to prove.
    //
    // `with-test-db.mjs` gives the WHOLE run one shared database, not one
    // per file — campaign.controller.e2e.test.ts's own `beforeAll` grabs
    // `listVisible(50)`'s first row as "a" live campaign to read, with no
    // opinion on which one. Leaving this row flipped to AU after this test
    // finishes made that file flaky (an ID-jurisdiction viewer there,
    // legitimately reading whichever campaign sorted first, got denied by
    // the very wall this file exists to prove) — so the flip is reverted
    // in `finally`, real state, not a value this suite owns past this test.
    const rows = await owner.execute<{ id: string }>(sql`
      UPDATE campaign.campaigns SET region = 'AU'
       WHERE id = (SELECT id FROM campaign.campaigns WHERE lifecycle_state = 'live' ORDER BY random() LIMIT 1)
      RETURNING id::text`);
    const campaignId = rows.rows[0]?.id;
    expect(campaignId, "a live seeded campaign must exist to flip").toBeDefined();

    try {
      const idViewer = await sessionFor(app, { jurisdiction: "ID" });
      const denied = await app.inject({
        method: "GET",
        url: `/api/campaigns/${String(campaignId)}`,
        headers: { cookie: idViewer.cookie },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toMatchObject({ code: "forbidden" });

      // Control: the SAME campaign, an AU viewer — proves the wall discriminates
      // on region, rather than this route refusing every signed-in viewer.
      const auViewer = await sessionFor(app, { jurisdiction: "AU" });
      const allowed = await app.inject({
        method: "GET",
        url: `/api/campaigns/${String(campaignId)}`,
        headers: { cookie: auViewer.cookie },
      });
      expect(allowed.statusCode).toBe(200);
    } finally {
      await owner.execute(
        sql`UPDATE campaign.campaigns SET region = 'ID' WHERE id = ${campaignId}`,
      );
    }
  });
});
