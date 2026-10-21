import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { linkCodes } from "../me/persistence/schema/me-schema";
import { partnerLinks } from "./persistence/schema/partner.table";
import { bootPartnerApp, partnerKit, receipt } from "./testing/partner-e2e-kit";

/**
 * 14.3.d: the lasting partner link over the real HTTP stack. Time is moved
 * by backdating rows as `owner` (the code's expiry, the link's creation),
 * the same owner-seeds-fixtures convention `partner-actions.e2e.test.ts`
 * uses. Own app instance with TEEN_ACCOUNTS on, as
 * `teen-consent-refusal.e2e.test.ts` does, so a teen can register.
 */
const owner = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
const originalTeenAccounts = process.env["TEEN_ACCOUNTS"];
let app: NestFastifyApplication;
let kit: ReturnType<typeof partnerKit>;

beforeAll(async () => {
  process.env["TEEN_ACCOUNTS"] = "true";
  app = await bootPartnerApp();
  kit = partnerKit(app, owner);
});

afterAll(async () => {
  await app.close();
  if (originalTeenAccounts === undefined) delete process.env["TEEN_ACCOUNTS"];
  else process.env["TEEN_ACCOUNTS"] = originalTeenAccounts;
});

describe("a lasting partner link (14.3)", () => {
  it("earns 11 minutes after linking, long after the code has expired", async () => {
    const partner = await kit.seedPartner();
    await kit.fundReceipts(partner, "AU");
    const { session, code, linkId } = await kit.linkedAdult(partner);

    const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);
    await owner
      .update(linkCodes)
      .set({ expiresAt: new Date(Date.now() - 60 * 1000) })
      .where(eq(linkCodes.code, code));
    await owner
      .update(partnerLinks)
      .set({ createdAt: elevenMinutesAgo })
      .where(eq(partnerLinks.id, linkId));

    const earned = await kit.partnerPost(partner, "actions", receipt(linkId));
    expect(earned.statusCode, earned.body).toBe(200);
    expect(earned.json()).toEqual({ granted: true, points: 1, linkId, duplicate: false });
    expect(await kit.availablePoints(session.cookie)).toBe(1);

    // The code was spent by the link and cannot link a second time.
    const again = await kit.partnerPost(partner, "links", { code });
    expect(again.statusCode).toBe(400);
    expect(again.json<{ code: string }>().code).toBe("invalid_link_code");
  });

  it("pays ID's rate (10) and keeps one active link per partner", async () => {
    const partner = await kit.seedPartner();
    await kit.fundReceipts(partner, "ID");
    const { session, linkId } = await kit.linkedAdult(partner, "ID");

    const { code: second } = (await kit.issueCode(session.cookie)).json<{ code: string }>();
    const relinked = await kit.partnerPost(partner, "links", { code: second });
    expect(relinked.json<{ linkId: string; region: string }>()).toMatchObject({
      linkId,
      region: "ID",
    });

    const earned = await kit.partnerPost(partner, "actions", receipt(linkId));
    expect(earned.json()).toMatchObject({ granted: true, points: 10 });

    const listed = await app.inject({
      method: "GET",
      url: "/api/me/linked-apps",
      headers: { cookie: session.cookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ linkedApps: unknown[] }>().linkedApps).toEqual([
      { linkId, partnerId: partner.partnerId, linkedAt: expect.any(String) as string },
    ]);
  });

  it("a replayed receipt pays once, under any idempotency key", async () => {
    const partner = await kit.seedPartner();
    await kit.fundReceipts(partner, "AU");
    const { session, linkId } = await kit.linkedAdult(partner);
    const body = receipt(linkId);

    const first = await kit.partnerPost(partner, "actions", body);
    const second = await kit.partnerPost(partner, "actions", body);
    expect(first.json()).toMatchObject({ granted: true, points: 1, duplicate: false });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ granted: true, points: 1, duplicate: true });
    expect(await kit.availablePoints(session.cookie)).toBe(1);

    // The same receipt reported for another account pays that account nothing.
    const other = await kit.linkedAdult(partner);
    const stolen = await kit.partnerPost(partner, "actions", { ...body, linkId: other.linkId });
    expect(stolen.json()).toEqual({
      granted: false,
      points: 0,
      linkId: other.linkId,
      duplicate: true,
    });
    expect(await kit.availablePoints(other.session.cookie)).toBe(0);
  });

  it("an unlinked user earns nothing: unknown links and other partners' links are refused", async () => {
    const partner = await kit.seedPartner();
    const unknown = await kit.partnerPost(partner, "actions", receipt(randomUUID()));
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json<{ code: string }>().code).toBe("unknown_link");

    const { session, linkId } = await kit.linkedAdult(await kit.seedPartner());
    const crossPartner = await kit.partnerPost(partner, "actions", receipt(linkId));
    expect(crossPartner.statusCode).toBe(400);
    expect(crossPartner.json<{ code: string }>().code).toBe("unknown_link");
    expect(await kit.availablePoints(session.cookie)).toBe(0);
  });

  it("a revoked link earns nothing and says so; linking again works", async () => {
    const partner = await kit.seedPartner();
    await kit.fundReceipts(partner, "AU");
    const { session, linkId } = await kit.linkedAdult(partner);

    const someoneElse = await sessionFor(app, { jurisdiction: "AU" });
    const notYours = await app.inject({
      method: "DELETE",
      url: `/api/me/linked-apps/${linkId}`,
      headers: { cookie: someoneElse.cookie },
    });
    expect(notYours.statusCode).toBe(404);

    const unlinked = await app.inject({
      method: "DELETE",
      url: `/api/me/linked-apps/${linkId}`,
      headers: { cookie: session.cookie },
    });
    expect(unlinked.statusCode, unlinked.body).toBe(200);
    expect(unlinked.json()).toEqual({ linkId, unlinked: true });

    const refused = await kit.partnerPost(partner, "actions", receipt(linkId));
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ code: string }>().code).toBe("link_revoked");
    expect(await kit.availablePoints(session.cookie)).toBe(0);

    const { code } = (await kit.issueCode(session.cookie)).json<{ code: string }>();
    const relinked = await kit.partnerPost(partner, "links", { code });
    const { linkId: fresh } = relinked.json<{ linkId: string }>();
    expect(fresh).not.toBe(linkId);
    expect((await kit.partnerPost(partner, "actions", receipt(fresh))).statusCode).toBe(200);
    expect(await kit.availablePoints(session.cookie)).toBe(1);
  });

  it("refuses a bad signature on the link route too", async () => {
    const partner = await kit.seedPartner();
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const { code } = (await kit.issueCode(session.cookie)).json<{ code: string }>();
    const forged = await kit.partnerPost(partner, "links", { code }, "not-the-real-secret");
    expect(forged.statusCode).toBe(401);
    // The refused call did not spend the code.
    expect((await kit.partnerPost(partner, "links", { code })).statusCode).toBe(200);
  });
});

describe("a teen cannot link (F101, F105)", () => {
  it("is refused a code, and a code that exists anyway is refused by the partner route", async () => {
    const partner = await kit.seedPartner();
    const octets = randomBytes(3);
    const register = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      remoteAddress: `10.${String(octets[0])}.${String(octets[1])}.${String(octets[2])}`,
      headers: { "idempotency-key": randomUUID() },
      payload: {
        email: `teen-partner-link+${randomUUID()}@example.test`,
        password: "not-a-real-secret-14-3-d",
        region: "AU",
        locale: "en-AU",
        displayName: "Teen Partner Link Test",
        dateOfBirth: "2012-01-01",
        timezone: "Australia/Sydney",
        guardianEmail: `guardian+${randomUUID()}@example.test`,
      },
    });
    expect(register.statusCode, register.body).toBeLessThan(300);
    const { userId, token } = register.json<{ userId: string; token: string }>();

    const refused = await kit.issueCode(`yt_session=${token}`);
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ code: string }>().code).toBe("teen_consent_not_allowed");

    const code = randomUUID().slice(0, 8).toUpperCase();
    await owner.insert(linkCodes).values({
      code,
      userId,
      region: "AU",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    const linked = await kit.partnerPost(partner, "links", { code });
    expect(linked.statusCode).toBe(403);
    expect(linked.json<{ code: string }>().code).toBe("teen_consent_not_allowed");
    const rows = await owner.select().from(partnerLinks).where(eq(partnerLinks.userId, userId));
    expect(rows).toEqual([]);
  });
});
