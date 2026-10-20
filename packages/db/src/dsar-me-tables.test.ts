import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { DATA_DOMAINS } from "@yourtal/consent/dsar";
import { executeDeletion } from "@yourtal/consent/dsar-orchestrator";
import { ANALYST_URL, APP_URL, OWNER_URL } from "./database-urls";
import { postgresHandlers } from "./dsar-handlers";
import { cleanup, hasTable, seedPerson } from "./dsar-me-tables.fixture";
import type { Person, Seeded } from "./dsar-me-tables.fixture";

/**
 * Group 1.20: account deletion reaches every `me` table, the account-security
 * tokens, a person's seat in an organisation and watch sessions, against real
 * Postgres. Fixtures are written as the OWNER; the handlers and the
 * permission checks run as the app, the split `dsar-handlers.test.ts` explains.
 */
const { Pool } = pg;
let app: pg.Pool;
let owner: pg.Pool;
let analyst: pg.Pool;
let subject: Seeded;
let bystander: Seeded;

/** Every `me` table this ticket knows a handler for. A new one must be added here AND erased. */
const COVERED_ME_TABLES = [
  "interest",
  "follow",
  "save",
  "link_code",
  "streak_state",
  "notification",
  "notification_preference",
  "viewer_setting",
  "viewer_theme",
  "voucher_expiry_warning",
  "viewer_area",
];

/** Tables the app role must not be able to DELETE from itself (it can only call the functions). */
const APP_CANNOT_DELETE = [
  "me.link_code",
  "me.streak_state",
  "me.notification",
  "me.notification_preference",
  "me.viewer_setting",
  "me.viewer_theme",
  "me.voucher_expiry_warning",
  "feed.demotion",
  "charity.member",
  "watch.session",
];

/** [table, column] for every table keyed by the person's id as text. */
const KEYED_BY_USER: readonly (readonly [string, string])[] = [
  ["me.interest", "user_id"],
  ["me.follow", "user_id"],
  ["me.save", "user_id"],
  ["me.link_code", "user_id"],
  ["me.streak_state", "user_id"],
  ["me.notification", "user_id"],
  ["me.notification_preference", "user_id"],
  ["me.viewer_setting", "user_id"],
  ["me.viewer_theme", "user_id"],
  ["me.voucher_expiry_warning", "user_id"],
  ["feed.demotion", "user_id"],
  ["identity.verification_token", "user_id"],
  ["identity.principal_security_state", "user_id"],
  ["charity.member", "user_id"],
  ["business.team_invitations", "accepted_by_user_id"],
];

async function rowsFor(person: Pick<Person, "id">): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const tables = [...KEYED_BY_USER];
  if (await hasTable(owner, "me", "viewer_area")) tables.push(["me.viewer_area", "user_id"]);
  for (const [table, column] of tables) {
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${table} WHERE ${column} = $1`,
      [person.id],
    );
    counts[table] = Number(rows[0]?.n ?? 0);
  }
  const sessions = `(SELECT id FROM watch.session WHERE user_id = $1)`;
  for (const [table, where] of [
    ["watch.session", `user_id = $1`],
    ["watch.coverage", `session_id IN ${sessions}`],
    ["watch.checkpoint_nonce", `session_id IN ${sessions}`],
    ["watch.checkpoint_issue", `session_id IN ${sessions}`],
    ["campaign.question_response", `session_id IN ${sessions}`],
  ] as const) {
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${table} WHERE ${where}`,
      [person.id],
    );
    counts[table] = Number(rows[0]?.n ?? 0);
  }
  return counts;
}

beforeAll(async () => {
  app = new Pool({ connectionString: APP_URL, max: 4 });
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
  analyst = new Pool({ connectionString: ANALYST_URL, max: 1 });
  subject = await seedPerson(owner, {
    id: randomUUID(),
    email: `subject-${randomUUID()}@example.test`,
  });
  bystander = await seedPerson(owner, {
    id: randomUUID(),
    email: `bystander-${randomUUID()}@example.test`,
  });
});

afterAll(async () => {
  await cleanup(owner, [subject, bystander]);
  await app.end();
  await owner.end();
  await analyst.end();
});

describe("every me table has a deletion handler", () => {
  it("lists no `me` table this test does not know", async () => {
    const { rows } = await owner.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'me'`,
    );
    const unknown = rows.map((row) => row.table_name).filter((t) => !COVERED_ME_TABLES.includes(t));
    // A new me.* table holds personal data until proven otherwise: add it to
    // platform.erase_me_subject (a new migration) and to this test's seed.
    expect(unknown, "a me table has no deletion handler").toEqual([]);
  });

  it("seeds a row in each table for both people", async () => {
    for (const person of [subject, bystander]) {
      const counts = await rowsFor(person);
      for (const [table, n] of Object.entries(counts)) {
        expect(n, `${table} for ${person.email}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("the app role alone cannot erase", () => {
  it("is refused DELETE on the tables it has no grant for, and nothing is lost", async () => {
    const before = await rowsFor(subject);
    for (const table of APP_CANNOT_DELETE) {
      await expect(
        app.query(`DELETE FROM ${table} WHERE user_id = $1`, [subject.id]),
        table,
      ).rejects.toThrow(/permission denied/);
    }
    expect(await rowsFor(subject)).toEqual(before);
  });

  it("cannot read or delete checkpoint answers or coverage either", async () => {
    await expect(
      app.query(`DELETE FROM campaign.question_response WHERE session_id = $1`, [randomUUID()]),
    ).rejects.toThrow(/permission denied/);
    await expect(
      app.query(`DELETE FROM watch.coverage WHERE session_id = $1`, [randomUUID()]),
    ).rejects.toThrow(/permission denied/);
  });

  it("reaches them only through definer functions that are pinned and not public", async () => {
    const { rows } = await owner.query<{
      name: string;
      definer: boolean;
      config: string[] | null;
      acl: string[] | null;
      owner: string;
      app_may: boolean;
      analyst_may: boolean;
    }>(
      `SELECT p.proname AS name, p.prosecdef AS definer, p.proconfig AS config,
              p.proacl::text[] AS acl, pg_get_userbyid(p.proowner) AS owner,
              has_function_privilege('yourtal_app', p.oid, 'EXECUTE') AS app_may,
              has_function_privilege('yourtal_analyst', p.oid, 'EXECUTE') AS analyst_may
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'platform'
          AND p.proname IN ('erase_me_subject', 'erase_org_memberships', 'erase_watch_subject')
        ORDER BY p.proname`,
    );
    expect(rows.map((row) => row.name)).toEqual([
      "erase_me_subject",
      "erase_org_memberships",
      "erase_watch_subject",
    ]);
    for (const fn of rows) {
      expect(fn.definer, fn.name).toBe(true);
      expect(
        fn.config?.some((entry) => entry.startsWith("search_path=pg_catalog")),
        fn.name,
      ).toBe(true);
      expect(fn.owner, fn.name).not.toBe("yourtal_app");
      expect(fn.app_may, fn.name).toBe(true);
      expect(fn.analyst_may, fn.name).toBe(false);
      // A PUBLIC grant shows up as an ACL entry with an empty grantee.
      expect(fn.acl?.some((entry) => entry.startsWith("=")) ?? false, fn.name).toBe(false);
    }
    await expect(
      analyst.query(`SELECT platform.erase_me_subject($1)`, [subject.id]),
    ).rejects.toThrow(/permission denied/);
  });

  it("refuses an empty subject", async () => {
    await expect(app.query(`SELECT platform.erase_me_subject('')`)).rejects.toThrow(/subject/);
    await expect(app.query(`SELECT platform.erase_watch_subject(NULL)`)).rejects.toThrow(/subject/);
  });
});

describe("deleting one person", () => {
  it("erases every table for them, reports every domain, and leaves the other person alone", async () => {
    const bystanderBefore = await rowsFor(bystander);
    const report = await executeDeletion(subject.id, postgresHandlers(app));

    expect(report.results.map((result) => result.domain)).toEqual(DATA_DOMAINS.map((d) => d.id));
    const status = Object.fromEntries(report.results.map((r) => [r.domain, r.outcome]));
    expect(status["me_data"]).toEqual({ status: "erased", records: 10 });
    expect(status["account_security"]).toEqual({ status: "erased", records: 2 });
    expect(status["org_memberships"]).toEqual({ status: "erased", records: 2 });
    // question_response + nonce + issue + coverage + session.
    expect(status["watch_sessions"]).toEqual({ status: "erased", records: 5 });

    const after = await rowsFor(subject);
    for (const [table, n] of Object.entries(after)) expect(n, table).toBe(0);
    expect(await rowsFor(bystander)).toEqual(bystanderBefore);
  });

  it("keeps an invitation the person sent, which holds someone else's email", async () => {
    const { rows } = await owner.query(
      `SELECT 1 FROM business.team_invitations WHERE invited_by_user_id = $1`,
      [subject.id],
    );
    expect(rows).toHaveLength(1);
  });

  it("does nothing the second time and reports the same statuses", async () => {
    const bystanderBefore = await rowsFor(bystander);
    const first = await executeDeletion(randomUUID(), postgresHandlers(app));
    const again = await executeDeletion(subject.id, postgresHandlers(app));

    expect(again.results.map((r) => [r.domain, r.outcome.status])).toEqual(
      first.results.map((r) => [r.domain, r.outcome.status]),
    );
    for (const domain of ["me_data", "account_security", "org_memberships", "watch_sessions"]) {
      expect(again.results.find((r) => r.domain === domain)?.outcome).toEqual({
        status: "erased",
        records: 0,
      });
    }
    for (const [table, n] of Object.entries(await rowsFor(subject))) expect(n, table).toBe(0);
    expect(await rowsFor(bystander)).toEqual(bystanderBefore);
  });

  it("is a no-op for a subject that is not a uuid", async () => {
    await expect(
      app.query(`SELECT platform.erase_watch_subject('not-a-uuid') AS n`),
    ).resolves.toMatchObject({ rows: [{ n: 0 }] });
  });
});
