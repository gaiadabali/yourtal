import { randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../../shared/testing/session-for";
import type { TestSession } from "../../shared/testing/session-for";

/**
 * TASKS.md 7.1.d — the whole real thing, over real HTTP, against real
 * Postgres and the real (simulated) email driver's outbox: an AU business
 * with an ABN, a team invite by email, and acceptance read back through the
 * dev inbox — the same round trip a reviewer or a Studio UI would drive.
 */
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

function cookieHeader(session: TestSession): { readonly cookie: string } {
  return { cookie: session.cookie };
}

describe("7.1.d Check: AU business with an ABN, invited teammate accepted through the inbox", () => {
  it("creates the business, invites by email, and the invitee joins by presenting the mailed token", async () => {
    const owner = await sessionFor(app, { jurisdiction: "AU" });
    const invitee = await sessionFor(app, { jurisdiction: "AU" });

    const created = await app.inject({
      method: "POST",
      url: "/api/businesses",
      headers: { ...cookieHeader(owner), "idempotency-key": randomUUID() },
      payload: {
        legalName: "Wharf Espresso Pty Ltd",
        displayName: "Wharf Espresso",
        taxIdKind: "ABN",
        taxIdValue: "12345678901",
        addressState: "NSW",
        addressPostcode: "2000",
        roles: ["advertiser"],
        region: "AU",
        handle: `wharf-espresso-${randomUUID().slice(0, 8)}`,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const business = created.json<{ business: { id: string; taxIdKind: string } }>().business;
    expect(business.taxIdKind).toBe("ABN");

    const invited = await app.inject({
      method: "POST",
      url: `/api/${business.id}/business/team/invite`,
      headers: { ...cookieHeader(owner), "idempotency-key": randomUUID() },
      payload: { email: invitee.email, role: "marketer" },
    });
    expect(invited.statusCode, invited.body).toBe(201);
    expect(invited.json()).not.toHaveProperty("token");

    const inbox = await app.inject({ method: "GET", url: "/api/dev/inbox" });
    expect(inbox.statusCode).toBe(200);
    const entries = inbox.json<{
      entries: Array<{
        category: string;
        recipient: string;
        metadata: { token?: string };
      }>;
    }>().entries;
    const mailed = entries.find(
      (entry) => entry.category === "team_invitation" && entry.recipient === invitee.email,
    );
    expect(mailed, "the invitation email should appear in the dev inbox").toBeDefined();
    const token = mailed?.metadata.token;
    expect(typeof token).toBe("string");

    const accepted = await app.inject({
      method: "POST",
      url: "/api/me/businesses/invitations/accept",
      headers: cookieHeader(invitee),
      payload: { token },
    });
    expect(accepted.statusCode, accepted.body).toBe(201);
    expect(accepted.json()).toMatchObject({
      businessId: business.id,
      member: { userId: invitee.userId, role: "marketer" },
    });
    expect(accepted.json<{ member: { joinedAt: string | null } }>().member.joinedAt).not.toBeNull();

    const myBusinesses = await app.inject({
      method: "GET",
      url: "/api/me/businesses",
      headers: cookieHeader(invitee),
    });
    expect(myBusinesses.statusCode).toBe(200);
    expect(myBusinesses.json<Array<{ business: { id: string }; role: string }>>()).toContainEqual(
      expect.objectContaining({
        business: expect.objectContaining({ id: business.id }),
        role: "marketer",
      }),
    );
  });
});
