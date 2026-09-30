import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../app.module";
import { sessionFor } from "../testing/session-for";
import { createAppDb } from "../persistence/drizzle-client";
import type { AppDb } from "../persistence/drizzle-client";
import { LEDGER_INTERNAL_CLIENT } from "../ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../ledger-client/ledger-internal-client";
import { ledgerDeletionHandler } from "./deletion-handlers";

// 13.24: DELETE /api/me leaves no spendable balance and reports the ledger
// domain done. Fake ledger mode (the test default); the Go ledger's escrow is
// the same contract, covered by its own suite.
let app: NestFastifyApplication;
let ledger: LedgerInternalClient;
const appUrl = process.env["DATABASE_URL"] ?? process.env["TEST_DATABASE_URL"] ?? "";
const pool = new Pool({ connectionString: appUrl });
const owner: AppDb = createAppDb(process.env["DATABASE_OWNER_URL"] ?? "");

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  ledger = app.get<LedgerInternalClient>(LEDGER_INTERNAL_CLIENT);
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

async function grantUnlocked(userId: string, points: number): Promise<void> {
  await owner.execute(sql`
    INSERT INTO platform.ledger_fake_grant (kind, user_id, region, points, unlock_at, idempotency_key)
    VALUES ('goodwill', ${userId}, 'AU', ${points}, now() - interval '1 hour', ${randomUUID()})`);
}

describe("DELETE /api/me and the ledger (13.24)", () => {
  it("escrows the whole balance for good and reports the ledger domain anonymised", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    await grantUnlocked(session.userId, 120);

    const before = await ledger.balance(session.userId);
    expect(before._unsafeUnwrap().availablePoints).toBe(120);

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
    });
    expect(deleted.statusCode).toBe(200);
    const report = deleted.json<{ results: { domain: string; outcome: { status: string } }[] }>();
    expect(report.results.find((r) => r.domain === "ledger")?.outcome.status).toBe("anonymised");

    const escrows = await owner.execute<{ points: string; reason: string; state: string }>(
      sql`SELECT points, reason, state FROM platform.ledger_fake_escrow WHERE user_id = ${session.userId}`,
    );
    expect(escrows.rows).toEqual([{ points: "120", reason: "account_deleted", state: "held" }]);
    expect((await ledger.balance(session.userId))._unsafeUnwrap().availablePoints).toBe(0);
  });

  it("a second run escrows nothing more", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    await grantUnlocked(session.userId, 40);
    const handler = ledgerDeletionHandler(pool, ledger);

    await handler(session.userId);
    await handler(session.userId);

    const escrows = await owner.execute<{ n: string }>(
      sql`SELECT count(*) AS n FROM platform.ledger_fake_escrow WHERE user_id = ${session.userId}`,
    );
    expect(escrows.rows[0]?.n).toBe("1");
  });

  it("the app role can clear a subject's grant device and IP only through the function", async () => {
    const cleared = await pool.query<{ cleared: number }>(
      "SELECT platform.pseudonymise_ledger_subject($1) AS cleared",
      [randomUUID()],
    );
    expect(cleared.rows[0]?.cleared).toBe(0);
    await expect(
      pool.query(`UPDATE ledger."grant" SET ip_address = NULL WHERE user_id = $1`, [randomUUID()]),
    ).rejects.toThrow(/permission denied/);
  });
});
