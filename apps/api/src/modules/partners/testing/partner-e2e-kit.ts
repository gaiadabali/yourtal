import { createHmac, randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { toMinorUnits } from "@yourtal/contracts/money";
import { AppModule } from "../../../app.module";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import { LEDGER_INTERNAL_CLIENT } from "../../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import { sessionFor } from "../../../shared/testing/session-for";
import { partnerCredentials } from "../persistence/schema/partner.table";

/**
 * Shared fixtures for the partner-link e2e suites (14.3): an app booted with
 * `rawBody: true` (what main.ts passes, and what the HMAC verifies against)
 * and both regions' marketing funded, plus signed partner calls.
 */
export async function bootPartnerApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
    rawBody: true,
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const ledger = app.get<LedgerInternalClient>(LEDGER_INTERNAL_CLIENT);
  for (const region of ["AU", "ID"] as const) {
    const funded = await ledger.fundMarketing({
      region,
      amountMinor: toMinorUnits(region === "AU" ? 500_000 : 50_000_000),
      proposedBy: "staff-1",
      approvedBy: "staff-2",
    });
    if (funded.isErr()) throw new Error(`funding ${region}: ${funded.error.message}`);
  }
  return app;
}

export interface Partner {
  readonly partnerId: string;
  readonly secret: string;
}

export const receipt = (linkId: string) => ({
  linkId,
  action: "receipt_scanned",
  externalRef: `receipt-${randomUUID()}`,
});

export function partnerKit(app: NestFastifyApplication, owner: AppDb) {
  /** The table names an env var, not a value: a fresh var per partner, so none share a secret. */
  async function seedPartner(): Promise<Partner> {
    const partnerId = `test-partner-${randomUUID()}`;
    const secret = `test-only-partner-secret-${randomUUID()}`;
    const secretEnvVar = `TEST_PARTNER_SECRET_${randomUUID().replaceAll("-", "_")}`;
    process.env[secretEnvVar] = secret;
    await owner.insert(partnerCredentials).values({ partnerId, secretEnvVar });
    return { partnerId, secret };
  }

  /** Signs `body` exactly as sent: the HMAC covers the raw bytes. */
  function partnerPost(partner: Partner, path: string, body: unknown, secret = partner.secret) {
    const raw = JSON.stringify(body);
    const signature = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    return app.inject({
      method: "POST",
      url: `/api/partners/${path}`,
      headers: {
        authorization: `Partner ${partner.partnerId}:${signature}`,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      payload: raw,
    });
  }

  function issueCode(cookie: string) {
    return app.inject({
      method: "POST",
      url: "/api/me/linked-apps/code",
      headers: { cookie, "idempotency-key": randomUUID() },
    });
  }

  async function availablePoints(cookie: string): Promise<number> {
    const wallet = await app.inject({ method: "GET", url: "/api/wallet", headers: { cookie } });
    return wallet.json<{ availablePoints: number }>().availablePoints;
  }

  async function linkedAdult(partner: Partner, jurisdiction: "AU" | "ID" = "AU") {
    const session = await sessionFor(app, { jurisdiction });
    const { code } = (await issueCode(session.cookie)).json<{ code: string }>();
    const linked = await partnerPost(partner, "links", { code });
    if (linked.statusCode !== 200) throw new Error(`linking failed: ${linked.body}`);
    const { linkId } = linked.json<{ linkId: string }>();
    return { session, code, linkId };
  }

  return { seedPartner, partnerPost, issueCode, availablePoints, linkedAdult };
}
