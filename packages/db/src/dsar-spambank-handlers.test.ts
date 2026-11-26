import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { DATA_DOMAINS } from "@yourtal/consent/dsar";
import { executeDeletion } from "@yourtal/consent/dsar-orchestrator";
import { APP_URL, OWNER_URL } from "./database-urls";
import { postgresHandlers } from "./dsar-handlers";
import { eraseSpambankMailbox } from "./dsar-spambank-handlers";

/**
 * The `spambank` DSAR domain (spambank/BUILD.md 4.11) against real Postgres, as the app role: the
 * person's mailbox goes `erasing` with its name retired for good, what the service learned from their
 * mail is deleted, nobody else's rows are touched, and a second run is a no-op.
 */

const { Pool } = pg;
const RUN = Date.now().toString(36);
const toLetters = (text: string): string =>
  text.replace(/[0-9]/g, (digit) => "abcdefghij"[Number(digit)] ?? "a");
const name = (n: number): string =>
  `ds${toLetters(RUN)}${toLetters(String(n + 1000))}`.slice(0, 16);

let app: pg.Pool;
let owner: pg.Pool;
const users: string[] = [];
const names: string[] = [];
const domains: string[] = [];

async function mailbox(n: number): Promise<{ id: string; userId: string; localPart: string }> {
  const userId = `dsar-sb-${RUN}-${String(n)}`;
  const localPart = name(n);
  users.push(userId);
  names.push(localPart);
  const { rows } = await app.query<{ id: string }>(
    `INSERT INTO spambank.mailbox (user_id, region, local_part, domain, status, enabled_via, stalwart_account_id)
     VALUES ($1, 'AU', $2, 'yourtal.gaiada.com', 'active', 'yourtal', $3) RETURNING id`,
    [userId, localPart, `acct-${userId}`],
  );
  return { id: rows[0]!.id, userId, localPart };
}

/** Everything the service learns from a mailbox's mail, for one mailbox. */
async function learn(mailboxId: string, orgDomain: string): Promise<void> {
  domains.push(orgDomain);
  await app.query(
    `INSERT INTO spambank.ingested_message (mailbox_id, email_id, received_at, folder, bulk, dmarc_pass, autoreply_decision)
     VALUES ($1, 'M1', now(), 'inbox', false, true, 'not_bulk'), ($1, 'M2', now(), 'junk', true, true, 'would_send')`,
    [mailboxId],
  );
  await app.query(
    `INSERT INTO spambank.lead (region, org_domain, first_seen_at, last_seen_at, messages)
     VALUES ('AU', $1, now(), now(), 2) ON CONFLICT DO NOTHING`,
    [orgDomain],
  );
  await app.query(
    `INSERT INTO spambank.lead_sighting (region, org_domain, mailbox_id, first_seen_at, last_seen_at)
     VALUES ('AU', $1, $2, now(), now())`,
    [orgDomain, mailboxId],
  );
  await app.query(
    `INSERT INTO spambank.statement_offer (mailbox_id, email_id, blob_id, type, size)
     VALUES ($1, 'M1', 'B1', 'application/pdf', 1000)`,
    [mailboxId],
  );
  await app.query(
    `INSERT INTO spambank.unsubscribe (id, mailbox_id, org_domain, method, status)
     VALUES ($1, $2, $3, 'one_click', 'done')`,
    [randomUUID(), mailboxId, orgDomain],
  );
}

async function count(table: string, mailboxId: string): Promise<number> {
  const { rows } = await app.query<{ n: string }>(
    `SELECT count(*) AS n FROM spambank.${table} WHERE mailbox_id = $1`,
    [mailboxId],
  );
  return Number(rows[0]!.n);
}

beforeAll(() => {
  app = new Pool({ connectionString: APP_URL, max: 5 });
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
});

afterAll(async () => {
  await owner.query(`DELETE FROM spambank.mailbox WHERE user_id = ANY($1)`, [users]);
  await owner.query(`DELETE FROM spambank.retired_name WHERE local_part = ANY($1)`, [names]);
  await owner.query(`DELETE FROM spambank.lead WHERE org_domain = ANY($1)`, [domains]);
  await app.end();
  await owner.end();
});

describe("the spambank DSAR domain", () => {
  it("is an erase domain owned by ops, and Postgres supplies its handler", () => {
    expect(DATA_DOMAINS.find((domain) => domain.id === "spambank")).toMatchObject({
      onDeletion: "erase",
      owner: "ops",
    });
    expect(postgresHandlers(app)["spambank"]).toBeTypeOf("function");
  });

  it("marks the mailbox erasing, retires its name and deletes what was learned from the mail", async () => {
    const mine = await mailbox(1);
    const other = await mailbox(2);
    const brand = `brand-${RUN}.example`;
    await learn(mine.id, brand);
    await learn(other.id, brand);

    const handler = postgresHandlers(app)["spambank"]!;
    expect(await handler(mine.userId)).toBeGreaterThan(0);

    const { rows } = await app.query<{ status: string }>(
      `SELECT status FROM spambank.mailbox WHERE id = $1`,
      [mine.id],
    );
    expect(rows[0]?.status).toBe("erasing");
    const retired = await app.query(`SELECT 1 FROM spambank.retired_name WHERE local_part = $1`, [
      mine.localPart,
    ]);
    expect(retired.rowCount).toBe(1);
    for (const table of ["ingested_message", "lead_sighting", "statement_offer", "unsubscribe"]) {
      expect(await count(table, mine.id), table).toBe(0);
    }
    // The other person's mailbox and everything about it are untouched.
    const theirs = await app.query<{ status: string }>(
      `SELECT status FROM spambank.mailbox WHERE id = $1`,
      [other.id],
    );
    expect(theirs.rows[0]?.status).toBe("active");
    for (const table of ["ingested_message", "lead_sighting", "statement_offer", "unsubscribe"]) {
      expect(await count(table, other.id), table).toBeGreaterThan(0);
    }
    // A lead is a brand, not a person: it stays.
    const lead = await app.query(`SELECT 1 FROM spambank.lead WHERE org_domain = $1`, [brand]);
    expect(lead.rowCount).toBe(1);
  });

  it("never lets the retired name be given out again, even if the row is removed", async () => {
    const box = await mailbox(3);
    await postgresHandlers(app)["spambank"]!(box.userId);
    // The sweep removes the row once the Stalwart account is gone; the name stays retired.
    await app.query(`DELETE FROM spambank.mailbox WHERE id = $1`, [box.id]);
    await expect(
      app.query(
        `INSERT INTO spambank.mailbox (user_id, region, local_part, domain, status, enabled_via)
         VALUES ($1, 'AU', $2, 'yourtal.gaiada.com', 'provisioning', 'yourtal')`,
        [`${box.userId}-again`, box.localPart],
      ),
    ).rejects.toMatchObject({ code: "23505" });
    users.push(`${box.userId}-again`);
  });

  it("is idempotent, and a person with no mailbox has nothing to erase", async () => {
    const box = await mailbox(4);
    const handler = postgresHandlers(app)["spambank"]!;
    expect(await handler(box.userId)).toBeGreaterThan(0);
    expect(await handler(box.userId)).toBe(0);
    expect(await handler(`dsar-sb-${RUN}-nobody`)).toBe(0);
  });

  it("rolls back as one when it fails part way: nothing is half erased", async () => {
    const box = await mailbox(5);
    await learn(box.id, `brand-${RUN}.example`);
    const client = await app.connect();
    try {
      await client.query("BEGIN");
      await eraseSpambankMailbox(client, box.userId);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    const { rows } = await app.query<{ status: string }>(
      `SELECT status FROM spambank.mailbox WHERE id = $1`,
      [box.id],
    );
    expect(rows[0]?.status).toBe("active");
    expect(await count("ingested_message", box.id)).toBe(2);
    const retired = await app.query(`SELECT 1 FROM spambank.retired_name WHERE local_part = $1`, [
      box.localPart,
    ]);
    expect(retired.rowCount).toBe(0);
  });

  it("is part of a full deletion report: the domain is handled, not left unhandled", async () => {
    const box = await mailbox(6);
    const report = await executeDeletion(
      box.userId,
      {
        spambank: postgresHandlers(app)["spambank"]!,
      },
      DATA_DOMAINS.filter((domain) => domain.id === "spambank"),
    );
    expect(report.complete).toBe(true);
    expect(report.results[0]?.outcome.status).toBe("erased");
  });
});
