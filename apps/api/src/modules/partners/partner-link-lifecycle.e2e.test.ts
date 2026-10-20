import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { linkCodes } from "../me/persistence/schema/me-schema";
import { partnerReceipts } from "./persistence/schema/partner.table";
import { bootPartnerApp, partnerKit, receipt } from "./testing/partner-e2e-kit";

/**
 * How a partner link ends (14.3 follow-up): the partner revokes it, or the
 * user deletes their account. Either way the next receipt earns nothing and
 * says why.
 */
const owner = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
let app: NestFastifyApplication;
let kit: ReturnType<typeof partnerKit>;

beforeAll(async () => {
  app = await bootPartnerApp();
  kit = partnerKit(app, owner);
});

afterAll(async () => {
  await app.close();
});

describe("POST /api/partners/links/:linkId/revoke", () => {
  it("revokes the partner's own link, answers a second revoke the same, and stops earning", async () => {
    const partner = await kit.seedPartner();
    const { session, linkId } = await kit.linkedAdult(partner);

    const first = await kit.partnerPost(partner, `links/${linkId}/revoke`, {});
    expect(first.statusCode, first.body).toBe(200);
    const { revokedAt } = first.json<{ revokedAt: string }>();
    expect(first.json()).toEqual({ linkId, revokedAt });

    const again = await kit.partnerPost(partner, `links/${linkId}/revoke`, {});
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ linkId, revokedAt });

    const refused = await kit.partnerPost(partner, "actions", receipt(linkId));
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ code: string }>().code).toBe("link_revoked");
    expect(await kit.availablePoints(session.cookie)).toBe(0);

    const listed = await app.inject({
      method: "GET",
      url: "/api/me/linked-apps",
      headers: { cookie: session.cookie },
    });
    expect(listed.json<{ linkedApps: unknown[] }>().linkedApps).toEqual([]);
  });

  it("treats another partner's link, or a malformed id, as unknown and leaves it alone", async () => {
    const owning = await kit.seedPartner();
    const other = await kit.seedPartner();
    const { session, linkId } = await kit.linkedAdult(owning);

    for (const id of [linkId, "not-a-uuid", randomUUID()]) {
      const refused = await kit.partnerPost(other, `links/${id}/revoke`, {});
      expect(refused.statusCode, id).toBe(400);
      expect(refused.json<{ code: string }>().code).toBe("unknown_link");
    }

    const still = await kit.partnerPost(owning, "actions", receipt(linkId));
    expect(still.statusCode, still.body).toBe(200);
    expect(await kit.availablePoints(session.cookie)).toBe(1);
  });

  it("refuses a bad signature without revoking", async () => {
    const partner = await kit.seedPartner();
    const { linkId } = await kit.linkedAdult(partner);
    const forged = await kit.partnerPost(partner, `links/${linkId}/revoke`, {}, "wrong-secret");
    expect(forged.statusCode).toBe(401);
    expect((await kit.partnerPost(partner, "actions", receipt(linkId))).statusCode).toBe(200);
  });
});

describe("account deletion ends partner links (DSAR partner_links)", () => {
  it("a deleted account's link earns nothing, its codes are gone, its receipts are detached", async () => {
    const partner = await kit.seedPartner();
    const { session, linkId } = await kit.linkedAdult(partner);
    const earned = receipt(linkId);
    expect((await kit.partnerPost(partner, "actions", earned)).statusCode).toBe(200);
    const { code: unspent } = (await kit.issueCode(session.cookie)).json<{ code: string }>();

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    const report = deleted.json<{ results: { domain: string; outcome: { status: string } }[] }>();
    expect(report.results.find((r) => r.domain === "partner_links")?.outcome.status).toBe(
      "anonymised",
    );

    const refused = await kit.partnerPost(partner, "actions", receipt(linkId));
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ code: string }>().code).toBe("link_revoked");

    const relink = await kit.partnerPost(partner, "links", { code: unspent });
    expect(relink.statusCode).toBe(400);
    expect(relink.json<{ code: string }>().code).toBe("invalid_link_code");
    expect(
      await owner.select().from(linkCodes).where(eq(linkCodes.userId, session.userId)),
    ).toEqual([]);

    // The receipt still counts as reported (it earns once), but names no one.
    const [kept] = await owner
      .select({ userId: partnerReceipts.userId })
      .from(partnerReceipts)
      .where(eq(partnerReceipts.receiptHash, earned.externalRef));
    expect(kept?.userId).toBe("00000000-0000-0000-0000-000000000000");
  });
});
