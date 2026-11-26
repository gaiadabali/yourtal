import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { APP_URL, LEDGER_URL, OWNER_URL } from "./database-urls";

/**
 * Spambank T1 (BUILD.md section 6, migration 20261128090000_spambank.sql):
 * the schema's constraints, the two D2 claim queries that T7 will run (the
 * per-domain 30-day throttle and the daily cap), cascades, the region wall and
 * the grants, against real Postgres. Constraints and cascades are driven as the
 * app role, because that is the role the API and worker use: a grant that
 * refused everything would show up here as a failure, not hide a CHECK.
 *
 * Every row is keyed by a RUN token, and the days used for the daily-cap tests
 * are far in the future, so nothing here collides with another file or a seed.
 */

const { Pool, Client } = pg;

const RUN = Date.now().toString(36);
const appUser = (n: number): string => `sbt1-${RUN}-${String(n)}`;
const domainOf = (n: string): string => `${n}-${RUN}.example`;
/** A valid, unique name per run and counter: letters only (the format forbids digits but a trailing pair). */
const toLetters = (text: string): string =>
  text.replace(/[0-9]/g, (digit) => "abcdefghij"[Number(digit)] ?? "a");
const letters = (n: number): string =>
  `sb${toLetters(RUN)}${toLetters(String(n + 1000))}`.slice(0, 16);

let app: pg.Pool;
let owner: pg.Pool;
const createdUsers: string[] = [];
const createdNames: string[] = [];
const createdDomains: string[] = [];
let originalCap = 200;

type Region = "AU" | "ID";

async function mailbox(
  region: Region = "AU",
  over: { name?: string; user?: string } = {},
): Promise<{ id: string; localPart: string; userId: string }> {
  const userId = over.user ?? appUser(createdUsers.length + 1);
  const localPart = over.name ?? letters(createdNames.length + 1);
  createdUsers.push(userId);
  createdNames.push(localPart);
  const { rows } = await app.query<{ id: string }>(
    `INSERT INTO spambank.mailbox (user_id, region, local_part, domain, status, enabled_via)
     VALUES ($1, $2, $3, 'yourtal.gaiada.com', 'active', 'yourtal') RETURNING id`,
    [userId, region, localPart],
  );
  return { id: rows[0]!.id, localPart, userId };
}

/** The pg error code a statement fails with, or null if it succeeded. */
async function codeOf(run: Promise<unknown>): Promise<string | null> {
  try {
    await run;
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? "no-code";
  }
}

beforeAll(async () => {
  app = new Pool({ connectionString: APP_URL, max: 25 });
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
  originalCap = (await owner.query<{ daily_cap: number }>(`SELECT daily_cap FROM spambank.control`))
    .rows[0]!.daily_cap;
});

afterAll(async () => {
  await owner.query(`UPDATE spambank.control SET daily_cap = $1`, [originalCap]);
  await owner.query(`DELETE FROM spambank.mailbox WHERE user_id = ANY($1)`, [createdUsers]);
  await owner.query(`DELETE FROM spambank.retired_name WHERE local_part = ANY($1)`, [createdNames]);
  await owner.query(`DELETE FROM spambank.lead WHERE org_domain = ANY($1)`, [createdDomains]);
  await owner.query(`DELETE FROM spambank.autoreply_domain WHERE org_domain = ANY($1)`, [
    createdDomains,
  ]);
  await owner.query(`DELETE FROM spambank.autoreply_day WHERE day >= '2090-01-01'`);
  await owner.query(`DELETE FROM spambank.autoreply WHERE org_domain = ANY($1)`, [createdDomains]);
  await app.end();
  await owner.end();
});

describe("spambank.mailbox", () => {
  it("lists the section 6 tables", async () => {
    const { rows } = await owner.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'spambank' ORDER BY 1`,
    );
    expect(rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining([
        "app_event_outbox",
        "autoreply",
        "autoreply_day",
        "autoreply_domain",
        "blocklist_check",
        "control",
        "ingested_message",
        "lead",
        "lead_sighting",
        "mailbox",
        "retired_name",
        "send_count",
        "statement_offer",
        "unsubscribe",
      ]),
    );
  });

  it("accepts the generated forms and refuses everything else in local_part", async () => {
    for (const ok of ["abcdef", "geewizduck", "abcdefghijklmnop", "geewizduck42", "abcdef10"]) {
      const name = ok;
      const user = `sbt1-${RUN}-ok-${name}`;
      createdUsers.push(user);
      createdNames.push(name);
      const code = await codeOf(
        app.query(
          `INSERT INTO spambank.mailbox (user_id, region, local_part, domain, status, enabled_via)
           VALUES ($1, 'ID', $2, 'd', 'active', 'yourtal')`,
          [user, name],
        ),
      );
      // A name another run left behind would be a unique violation, never a check violation.
      expect([null, "23505"]).toContain(code);
    }
    for (const bad of [
      "abcde", // too short
      "abcdefghijklmnopq", // 17 letters
      "ABCDEFGH", // upper case
      "geewiz-duck", // punctuation
      "geewizduck1", // one digit
      "geewizduck05", // suffix starts with 0
      "geewizduck100", // three digits
      "geewiz duck", // space
    ]) {
      const code = await codeOf(
        app.query(
          `INSERT INTO spambank.mailbox (user_id, region, local_part, domain, status, enabled_via)
           VALUES ($1, 'AU', $2, 'd', 'active', 'yourtal')`,
          [`sbt1-${RUN}-bad`, bad],
        ),
      );
      expect(code, bad).toBe("23514");
    }
  });

  it("keeps local_part and user_id unique, and checks region, status and enabled_via", async () => {
    const first = await mailbox();
    expect(
      await codeOf(
        app.query(
          `INSERT INTO spambank.mailbox (user_id, region, local_part, domain, status, enabled_via)
           VALUES ($1, 'AU', $2, 'd', 'active', 'yourtal')`,
          [`${first.userId}-other`, first.localPart],
        ),
      ),
    ).toBe("23505");
    expect(
      await codeOf(
        app.query(
          `INSERT INTO spambank.mailbox (user_id, region, local_part, domain, status, enabled_via)
           VALUES ($1, 'AU', $2, 'd', 'active', 'yourtal')`,
          [first.userId, letters(900)],
        ),
      ),
    ).toBe("23505");
    for (const [region, status, via] of [
      ["NZ", "active", "yourtal"],
      ["AU", "deleted", "yourtal"],
      ["AU", "active", "other"],
    ] as const) {
      expect(
        await codeOf(
          app.query(
            `INSERT INTO spambank.mailbox (user_id, region, local_part, domain, status, enabled_via)
             VALUES ($1, $2, $3, 'd', $4, $5)`,
            [`sbt1-${RUN}-chk`, region, letters(901), status, via],
          ),
        ),
      ).toBe("23514");
    }
  });
});

describe("spambank.retired_name", () => {
  it("blocks a retired name from ever being given out again, and cannot be edited by the app", async () => {
    const name = letters(500);
    createdNames.push(name);
    await app.query(`INSERT INTO spambank.retired_name (local_part) VALUES ($1)`, [name]);

    const user = `sbt1-${RUN}-retired`;
    createdUsers.push(user);
    const retiredInsert = app.query(
      `INSERT INTO spambank.mailbox (user_id, region, local_part, domain, status, enabled_via)
       VALUES ($1, 'AU', $2, 'd', 'active', 'yourtal')`,
      [user, name],
    );
    // A unique violation, so the generator's retry-on-violation path covers it.
    expect(await codeOf(retiredInsert)).toBe("23505");

    // The generator's own lookup, as BUILD.md 4.1 describes it.
    const taken = await app.query(
      `SELECT 1 FROM spambank.retired_name WHERE local_part = $1
        UNION ALL SELECT 1 FROM spambank.mailbox WHERE local_part = $1`,
      [name],
    );
    expect(taken.rowCount).toBe(1);

    expect(
      await codeOf(app.query(`DELETE FROM spambank.retired_name WHERE local_part = $1`, [name])),
    ).toBe("42501");
    expect(
      await codeOf(
        app.query(`UPDATE spambank.retired_name SET local_part = $2 WHERE local_part = $1`, [
          name,
          letters(501),
        ]),
      ),
    ).toBe("42501");
  });

  it("lets the erase handler retire a name while its mailbox row still exists", async () => {
    const box = await mailbox();
    await app.query(
      `UPDATE spambank.mailbox SET status = 'erasing', updated_at = now() WHERE id = $1`,
      [box.id],
    );
    await app.query(`INSERT INTO spambank.retired_name (local_part) VALUES ($1)`, [box.localPart]);
    // The sweep then removes the row; the name stays retired.
    await app.query(`DELETE FROM spambank.mailbox WHERE id = $1`, [box.id]);
    const left = await app.query(`SELECT 1 FROM spambank.retired_name WHERE local_part = $1`, [
      box.localPart,
    ]);
    expect(left.rowCount).toBe(1);
  });
});

describe("D2 check 9: one reply per domain per 30 days, all users", () => {
  // BUILD.md 4.6 check 9, verbatim.
  const CLAIM = `INSERT INTO spambank.autoreply_domain (org_domain, last_replied_at, replies_total)
                 VALUES ($1, now(), 1)
                 ON CONFLICT (org_domain) DO UPDATE
                    SET last_replied_at = now(), replies_total = spambank.autoreply_domain.replies_total + 1
                  WHERE spambank.autoreply_domain.opted_out_at IS NULL
                    AND (spambank.autoreply_domain.last_replied_at IS NULL
                         OR spambank.autoreply_domain.last_replied_at < now() - interval '30 days')
                 RETURNING org_domain`;
  const claim = async (domain: string, db: pg.Pool | pg.PoolClient = app): Promise<number> =>
    (await db.query(CLAIM, [domain])).rowCount ?? 0;

  it("returns a row once, then none inside 30 days, then a row again after 30 days", async () => {
    const domain = domainOf("window");
    createdDomains.push(domain);
    expect(await claim(domain)).toBe(1);
    expect(await claim(domain)).toBe(0);
    await owner.query(
      `UPDATE spambank.autoreply_domain SET last_replied_at = now() - interval '29 days' WHERE org_domain = $1`,
      [domain],
    );
    expect(await claim(domain)).toBe(0);
    await owner.query(
      `UPDATE spambank.autoreply_domain SET last_replied_at = now() - interval '31 days' WHERE org_domain = $1`,
      [domain],
    );
    expect(await claim(domain)).toBe(1);
  });

  it("returns no row once the domain has opted out, however long ago the last reply was", async () => {
    const domain = domainOf("optout");
    createdDomains.push(domain);
    expect(await claim(domain)).toBe(1);
    await owner.query(
      `UPDATE spambank.autoreply_domain
          SET opted_out_at = now(), last_replied_at = now() - interval '400 days' WHERE org_domain = $1`,
      [domain],
    );
    expect(await claim(domain)).toBe(0);
    // An opt-out recorded before any reply ever went out also wins.
    const fresh = domainOf("optout-first");
    createdDomains.push(fresh);
    await app.query(
      `INSERT INTO spambank.autoreply_domain (org_domain, opted_out_at) VALUES ($1, now())`,
      [fresh],
    );
    expect(await claim(fresh)).toBe(0);
  });

  it("lets exactly one of two concurrent transactions claim a new domain", async () => {
    const domain = domainOf("race2");
    createdDomains.push(domain);
    const a = await app.connect();
    const b = await app.connect();
    try {
      await a.query("BEGIN");
      await b.query("BEGIN");
      expect(await claim(domain, a)).toBe(1);
      // B waits on A's uncommitted insert, then re-evaluates against A's row.
      const second = claim(domain, b);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await a.query("COMMIT");
      expect(await second).toBe(0);
      await b.query("COMMIT");
    } finally {
      a.release();
      b.release();
    }
  });

  it("lets exactly one of twenty parallel claims win", async () => {
    const domain = domainOf("race20");
    createdDomains.push(domain);
    const results = await Promise.all(Array.from({ length: 20 }, () => claim(domain)));
    expect(results.reduce((sum, n) => sum + n, 0)).toBe(1);
    const row = await owner.query<{ replies_total: number }>(
      `SELECT replies_total FROM spambank.autoreply_domain WHERE org_domain = $1`,
      [domain],
    );
    expect(row.rows[0]!.replies_total).toBe(1);
  });

  it("frees the domain claim when the daily-cap check rolls the transaction back", async () => {
    const domain = domainOf("rollback");
    createdDomains.push(domain);
    const client = await app.connect();
    try {
      await client.query("BEGIN");
      expect(await claim(domain, client)).toBe(1);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect(await claim(domain)).toBe(1);
  });

  it("never lets the app delete a guard row", async () => {
    const domain = domainOf("nodelete");
    createdDomains.push(domain);
    await claim(domain);
    expect(
      await codeOf(
        app.query(`DELETE FROM spambank.autoreply_domain WHERE org_domain = $1`, [domain]),
      ),
    ).toBe("42501");
  });
});

describe("D2 check 10: the global daily cap", () => {
  // BUILD.md 4.6 check 10: an atomic increment that only happens below the cap.
  const INCREMENT = `INSERT INTO spambank.autoreply_day (day, sent)
                     SELECT $1::date, 1 FROM spambank.control WHERE daily_cap > 0
                     ON CONFLICT (day) DO UPDATE SET sent = spambank.autoreply_day.sent + 1
                      WHERE spambank.autoreply_day.sent < (SELECT daily_cap FROM spambank.control)
                     RETURNING sent`;
  const increment = async (day: string): Promise<number> =>
    (await app.query(INCREMENT, [day])).rowCount ?? 0;
  const setCap = async (cap: number): Promise<void> => {
    await owner.query(`UPDATE spambank.control SET daily_cap = $1`, [cap]);
  };

  it("stops at the cap, sequentially", async () => {
    await setCap(3);
    const results: number[] = [];
    for (let i = 0; i < 5; i++) results.push(await increment("2090-01-01"));
    expect(results).toEqual([1, 1, 1, 0, 0]);
    const row = await owner.query<{ sent: number }>(
      `SELECT sent FROM spambank.autoreply_day WHERE day = '2090-01-01'`,
    );
    expect(row.rows[0]!.sent).toBe(3);
  });

  it("stops at the cap under twenty parallel claims", async () => {
    await setCap(5);
    const results = await Promise.all(Array.from({ length: 20 }, () => increment("2090-01-02")));
    expect(results.reduce((sum, n) => sum + n, 0)).toBe(5);
    const row = await owner.query<{ sent: number }>(
      `SELECT sent FROM spambank.autoreply_day WHERE day = '2090-01-02'`,
    );
    expect(row.rows[0]!.sent).toBe(5);
  });

  it("sends nothing when the cap is 0", async () => {
    await setCap(0);
    expect(await increment("2090-01-03")).toBe(0);
  });

  it("refuses, in the database, any write that would take the day past the cap", async () => {
    await setCap(2);
    // Even a query that forgets the WHERE cannot over-send.
    expect(
      await codeOf(
        app.query(`INSERT INTO spambank.autoreply_day (day, sent) VALUES ('2090-01-04', 3)`),
      ),
    ).toBe("23514");
    await app.query(`INSERT INTO spambank.autoreply_day (day, sent) VALUES ('2090-01-04', 2)`);
    expect(
      await codeOf(
        app.query(`UPDATE spambank.autoreply_day SET sent = sent + 1 WHERE day = '2090-01-04'`),
      ),
    ).toBe("23514");
    // Bounce and complaint tallies, and a lowered cap, never block unrelated writes.
    await setCap(1);
    await app.query(
      `UPDATE spambank.autoreply_day SET bounces = bounces + 1, complaints = complaints + 1 WHERE day = '2090-01-04'`,
    );
    expect(await increment("2090-01-04")).toBe(0);
  });

  it("keeps the counters non-negative", async () => {
    expect(
      await codeOf(
        app.query(
          `INSERT INTO spambank.autoreply_day (day, sent, bounces) VALUES ('2090-01-05', 0, -1)`,
        ),
      ),
    ).toBe("23514");
  });
});

describe("spambank.control", () => {
  it("is a singleton the app can update but not add to or delete from", async () => {
    expect((await owner.query(`SELECT 1 FROM spambank.control`)).rowCount).toBe(1);
    expect(await codeOf(owner.query(`INSERT INTO spambank.control (id) VALUES (false)`))).toBe(
      "23514",
    );
    expect(await codeOf(owner.query(`INSERT INTO spambank.control (id) VALUES (true)`))).toBe(
      "23505",
    );
    expect(await codeOf(app.query(`INSERT INTO spambank.control (id) VALUES (true)`))).toBe(
      "42501",
    );
    expect(await codeOf(app.query(`DELETE FROM spambank.control`))).toBe("42501");
    expect(await codeOf(owner.query(`UPDATE spambank.control SET daily_cap = -1`))).toBe("23514");
    await app.query(`UPDATE spambank.control SET paused_at = NULL, updated_by = 'sbt1'`);
  });
});

describe("cascades from spambank.mailbox", () => {
  it("removes sightings, offers, sends, unsubscribes and ingested rows, and keeps the lead and the reply log", async () => {
    const box = await mailbox();
    const domain = domainOf("cascade");
    createdDomains.push(domain);
    await app.query(
      `INSERT INTO spambank.lead (region, org_domain, first_seen_at, last_seen_at, messages) VALUES ('AU', $1, now(), now(), 1)`,
      [domain],
    );
    await app.query(
      `INSERT INTO spambank.lead_sighting (region, org_domain, mailbox_id, first_seen_at, last_seen_at)
       VALUES ('AU', $1, $2, now(), now())`,
      [domain, box.id],
    );
    await app.query(
      `INSERT INTO spambank.statement_offer (mailbox_id, email_id, blob_id, type, size)
       VALUES ($1, 'e1', 'b1', 'application/pdf', 10)`,
      [box.id],
    );
    await app.query(
      `INSERT INTO spambank.send_count (mailbox_id, day, recipients) VALUES ($1, '2090-02-01', 3)`,
      [box.id],
    );
    await app.query(
      `INSERT INTO spambank.unsubscribe (id, mailbox_id, org_domain, method, status)
       VALUES ($1, $2, $3, 'one_click', 'done')`,
      [randomUUID(), box.id, domain],
    );
    await app.query(
      `INSERT INTO spambank.ingested_message
         (mailbox_id, email_id, received_at, folder, bulk, dmarc_pass, autoreply_decision)
       VALUES ($1, 'e1', now(), 'inbox', true, true, 'would_send')`,
      [box.id],
    );
    const replyId = randomUUID();
    await app.query(
      `INSERT INTO spambank.autoreply (id, org_domain, to_address, source_mailbox_id, message_id, mode, status)
       VALUES ($1, $2, 'a@x.example', $3, $4, 'live', 'sent')`,
      [replyId, domain, box.id, `<${replyId}@probe>`],
    );

    await app.query(`DELETE FROM spambank.mailbox WHERE id = $1`, [box.id]);

    const counts = await owner.query<Record<string, number>>(
      `SELECT (SELECT count(*) FROM spambank.lead_sighting WHERE mailbox_id = $1)::int AS sightings,
              (SELECT count(*) FROM spambank.statement_offer WHERE mailbox_id = $1)::int AS offers,
              (SELECT count(*) FROM spambank.send_count WHERE mailbox_id = $1)::int AS sends,
              (SELECT count(*) FROM spambank.unsubscribe WHERE mailbox_id = $1)::int AS unsubs,
              (SELECT count(*) FROM spambank.ingested_message WHERE mailbox_id = $1)::int AS ingested,
              (SELECT count(*) FROM spambank.lead WHERE org_domain = $2)::int AS leads,
              (SELECT count(*) FROM spambank.autoreply WHERE id = $3 AND source_mailbox_id IS NULL)::int AS replies`,
      [box.id, domain, replyId],
    );
    expect(counts.rows[0]).toEqual({
      sightings: 0,
      offers: 0,
      sends: 0,
      unsubs: 0,
      ingested: 0,
      leads: 1,
      replies: 1,
    });
  });

  it("removes a lead's sightings when the lead goes (owner only)", async () => {
    const box = await mailbox();
    const domain = domainOf("leadgone");
    createdDomains.push(domain);
    await app.query(
      `INSERT INTO spambank.lead (region, org_domain, first_seen_at, last_seen_at) VALUES ('AU', $1, now(), now())`,
      [domain],
    );
    await app.query(
      `INSERT INTO spambank.lead_sighting (region, org_domain, mailbox_id, first_seen_at, last_seen_at)
       VALUES ('AU', $1, $2, now(), now())`,
      [domain, box.id],
    );
    expect(
      await codeOf(app.query(`DELETE FROM spambank.lead WHERE org_domain = $1`, [domain])),
    ).toBe("42501");
    await owner.query(`DELETE FROM spambank.lead WHERE org_domain = $1`, [domain]);
    expect(
      (await owner.query(`SELECT 1 FROM spambank.lead_sighting WHERE mailbox_id = $1`, [box.id]))
        .rowCount,
    ).toBe(0);
    // A sighting cannot name a lead that does not exist.
    expect(
      await codeOf(
        app.query(
          `INSERT INTO spambank.lead_sighting (region, org_domain, mailbox_id, first_seen_at, last_seen_at)
           VALUES ('AU', $1, $2, now(), now())`,
          [domain, box.id],
        ),
      ),
    ).toBe("23503");
  });
});

describe("the region wall", () => {
  async function walled(
    region: Region | "",
    run: (client: pg.Client) => Promise<void>,
  ): Promise<void> {
    const client = new Client({ connectionString: APP_URL });
    await client.connect();
    try {
      await client.query(`SELECT set_config('yourtal.region', $1, false)`, [region]);
      await run(client);
    } finally {
      await client.end();
    }
  }

  it("hides and refuses the other region's mailboxes and leads, and an unset region sees both", async () => {
    const au = await mailbox("AU");
    const id = await mailbox("ID");
    const domain = domainOf("wall");
    createdDomains.push(domain);
    for (const region of ["AU", "ID"] as const) {
      await app.query(
        `INSERT INTO spambank.lead (region, org_domain, first_seen_at, last_seen_at) VALUES ($1, $2, now(), now())`,
        [region, domain],
      );
    }

    await walled("ID", async (client) => {
      const seen = await client.query<{ id: string }>(
        `SELECT id FROM spambank.mailbox WHERE id = ANY($1)`,
        [[au.id, id.id]],
      );
      expect(seen.rows.map((row) => row.id)).toEqual([id.id]);
      const leads = await client.query<{ region: string }>(
        `SELECT region FROM spambank.lead WHERE org_domain = $1`,
        [domain],
      );
      expect(leads.rows.map((row) => row.region)).toEqual(["ID"]);
      const moved = await client.query(
        `UPDATE spambank.lead SET note = 'x' WHERE org_domain = $1 AND region = 'AU'`,
        [domain],
      );
      expect(moved.rowCount).toBe(0);
      expect(
        await codeOf(
          client.query(
            `INSERT INTO spambank.mailbox (user_id, region, local_part, domain, status, enabled_via)
             VALUES ($1, 'AU', $2, 'd', 'active', 'yourtal')`,
            [`sbt1-${RUN}-wall`, letters(777)],
          ),
        ),
      ).toBe("42501");
    });

    await walled("", async (client) => {
      const seen = await client.query(`SELECT 1 FROM spambank.mailbox WHERE id = ANY($1)`, [
        [au.id, id.id],
      ]);
      expect(seen.rowCount).toBe(2);
    });
  });

  it("is present on every spambank table that has a region column", async () => {
    const open = await owner.query<{ name: string }>(
      `SELECT c.relname AS name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE n.nspname = 'spambank' AND c.relkind = 'r' AND NOT a.attisdropped AND a.attname = 'region'
          AND NOT (c.relrowsecurity AND EXISTS (
                SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'region_wall'))`,
    );
    expect(open.rows).toEqual([]);
  });
});

describe("grants", () => {
  it("gives the ledger role nothing in the schema, and changes no other role's reach", async () => {
    const ledger = new Client({ connectionString: LEDGER_URL });
    await ledger.connect();
    try {
      expect(await codeOf(ledger.query(`SELECT 1 FROM spambank.mailbox`))).toBe("42501");
      expect(await codeOf(ledger.query(`SELECT 1 FROM spambank.control`))).toBe("42501");
    } finally {
      await ledger.end();
    }
  });

  it("gives the app role no DELETE on the tables that must never lose a row, and no TRUNCATE anywhere", async () => {
    const { rows } = await owner.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'yourtal_app' AND table_schema = 'spambank'
          AND (privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')
               OR (privilege_type = 'DELETE' AND table_name IN
                   ('retired_name', 'autoreply_domain', 'autoreply', 'autoreply_day', 'control', 'lead', 'blocklist_check', 'send_count')))`,
    );
    expect(rows).toEqual([]);
  });

  it("lets the app role read and write what T4 to T7 need", async () => {
    const box = await mailbox();
    await app.query(
      `UPDATE spambank.mailbox SET email_state = 's1', last_ingested_at = now() WHERE id = $1`,
      [box.id],
    );
    await app.query(
      `INSERT INTO spambank.blocklist_check (target, list, result) VALUES ('probe.example', 'dbl', 'clean')`,
    );
    const eventId = randomUUID();
    await app.query(
      `INSERT INTO spambank.app_event_outbox (jti, client_id, sub, event_type, payload, iat, expires_at)
       VALUES ($1, 'snapapp-staging-server', 'sub-probe', 'urn:yourtal:event:spambank-mail', '{}', now(), now() + interval '15 minutes')`,
      [eventId],
    );
    await app.query(`UPDATE spambank.app_event_outbox SET attempts = attempts + 1 WHERE jti = $1`, [
      eventId,
    ]);
    await app.query(`DELETE FROM spambank.app_event_outbox WHERE jti = $1`, [eventId]);
    await owner.query(`DELETE FROM spambank.blocklist_check WHERE target = 'probe.example'`);
  });
});
