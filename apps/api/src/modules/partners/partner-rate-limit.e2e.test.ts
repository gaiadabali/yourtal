import { createHmac, randomUUID } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { PARTNER_RATE_LIMIT } from "./partner-rate-limit.guard";
import { bootPartnerApp, partnerKit } from "./testing/partner-e2e-kit";
import type { Partner } from "./testing/partner-e2e-kit";

/**
 * 2.8.f: the per-partner budget over the real HTTP stack. A malformed body
 * (400) still passes both guards and counts, so the budget is spent cheaply
 * without touching the ledger. Runs from several source addresses to show the
 * limit is the partner's, not the IP's.
 */
const owner = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");
let app: NestFastifyApplication;
let kit: ReturnType<typeof partnerKit>;

beforeAll(async () => {
  app = await bootPartnerApp();
  kit = partnerKit(app, owner);
}, 120_000);

afterAll(async () => {
  await app.close();
});

describe("partner rate limit (2.8.f)", () => {
  it("refuses a partner past its budget from any address, and only that partner", async () => {
    const budget = PARTNER_RATE_LIMIT.identity?.max ?? 0;
    const partner = await kit.seedPartner();
    const other = await kit.seedPartner();
    const bad = { region: "nowhere" };
    // `remoteAddress` rotates the source so the per-IP limits (60 a minute a route) never fire.
    const sign = (p: Partner, path: string, ip = "198.51.100.1", secret = p.secret) => {
      const raw = JSON.stringify(bad);
      const signature = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
      return app.inject({
        method: "POST",
        url: `/api/partners/${path}`,
        remoteAddress: ip,
        headers: {
          authorization: `Partner ${p.partnerId}:${signature}`,
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        payload: raw,
      });
    };

    // Spread over three routes so the budget is shared, not per route.
    const paths = ["receipts/status", "links", "vouchers/owner"];
    for (let i = 0; i < budget; i++) {
      const res = await sign(
        partner,
        paths[i % paths.length] ?? "links",
        `198.51.100.${1 + (i % 200)}`,
      );
      expect(res.statusCode, `request ${i}`).toBe(400);
    }

    const refused = await sign(partner, "receipts/status", "198.51.100.250");
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({
      statusCode: 429,
      error: "Too Many Requests",
      message: "Too many requests. Try again later.",
    });
    expect(refused.json<{ retryAfterSeconds: number }>().retryAfterSeconds).toBeGreaterThan(0);

    // Another partner has its own budget.
    expect((await sign(other, "receipts/status", "198.51.100.250")).statusCode).toBe(400);

    // A bad signature is 401 before the partner budget, whatever the claimed id.
    const forged = await sign(
      partner,
      "receipts/status",
      "198.51.100.251",
      `wrong-${randomUUID()}`,
    );
    expect(forged.statusCode).toBe(401);
  }, 120_000);
});
