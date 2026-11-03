import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { consentRecordSchema } from "@yourtal/consent/consent-record";
import { APP_URL, OWNER_URL } from "./database-urls";

/**
 * Group 3.7 Y1 (docs/29 §5): oidc.forget_subject and oidc.end_app_access
 * against real Postgres. Fixtures are written as the owner; the functions run
 * as the app, inside a transaction, as their callers will.
 */
const { Pool } = pg;
let app: pg.Pool;
let owner: pg.Pool;

const SNAP = "snapapp-staging";
const FTR = "ftr";
const RECEIVERS = [
  { sector: SNAP, clientId: "snapapp-staging-server", endpoint: "https://snap.test/events" },
  { sector: FTR, clientId: "ftr-web" },
];
const DELETED = "urn:yourtal:event:account-deleted";
const ENDED = "urn:yourtal:event:access-ended";

function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

async function person(dob: string): Promise<string> {
  const id = randomUUID();
  await owner.query(
    `INSERT INTO identity.user_profile (user_id, region, display_name, date_of_birth, timezone)
     VALUES ($1, 'AU', 'Test', $2, 'Australia/Sydney')`,
    [id, dob],
  );
  return id;
}

async function subject(userId: string, sector: string): Promise<string> {
  const sub = `sub-${randomUUID()}`;
  await owner.query(`INSERT INTO oidc.subject (sector, user_id, sub) VALUES ($1, $2, $3)`, [
    sector,
    userId,
    sub,
  ]);
  return sub;
}

async function consent(userId: string, sector: string, invite: string | null = null) {
  await owner.query(
    `INSERT INTO oidc.app_consent (user_id, sector, scopes, policy_version_id, granted_via, invite_id, granted_at)
     VALUES ($1, $2, '{openid}', 'pv-1', $3, $4, now())`,
    [userId, sector, invite === null ? "consent_screen" : "guardian_invite", invite],
  );
}

async function invite(inviter: string, teen: string | null, sector = SNAP): Promise<string> {
  const id = randomUUID();
  await owner.query(
    `INSERT INTO oidc.teen_invite
       (id, sector, code_hash, inviter_user_id, region, teen_user_id, expires_at, accepted_at)
     VALUES ($1, $2, $3, $4, 'AU', $5, now() + interval '7 days', CASE WHEN $5::text IS NULL THEN NULL ELSE now() END)`,
    [id, sector, `hash-${id}`, inviter, teen],
  );
  return id;
}

async function inTransaction<T>(run: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await app.connect();
  try {
    await db.query("BEGIN");
    const result = await run(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

const forget = (userId: string) =>
  inTransaction(async (db) => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT oidc.forget_subject($1, $2::jsonb) AS n`,
      [userId, JSON.stringify(RECEIVERS)],
    );
    return rows[0]?.n;
  });

const endAccess = (userId: string, sector: string, receiver: string | null, reason: string) =>
  inTransaction(async (db) => {
    const { rows } = await db.query<{ ended: boolean }>(
      `SELECT oidc.end_app_access($1, $2, $3, $4) AS ended`,
      [userId, sector, receiver, reason],
    );
    return rows[0]?.ended;
  });

async function events(subs: string[]) {
  const { rows } = await app.query<{
    client_id: string;
    sub: string;
    event_type: string;
    payload: Record<string, unknown>;
  }>(
    `SELECT client_id, sub, event_type, payload FROM oidc.event_outbox WHERE sub = ANY($1) ORDER BY client_id`,
    [subs],
  );
  return rows;
}

async function oidcRows(userId: string): Promise<Record<string, number>> {
  const { rows } = await app.query<Record<string, number>>(
    `SELECT (SELECT count(*) FROM oidc.subject WHERE user_id = $1)::int AS subject,
            (SELECT count(*) FROM oidc.app_consent WHERE user_id = $1)::int AS app_consent,
            (SELECT count(*) FROM oidc.teen_invite WHERE inviter_user_id = $1 OR teen_user_id = $1)::int AS teen_invite,
            (SELECT count(*) FROM oidc.sign_in_log WHERE user_id = $1)::int AS sign_in_log,
            (SELECT count(*) FROM oidc.model
              WHERE payload->>'accountId' = $1 OR payload->'result'->'login'->>'accountId' = $1)::int AS model`,
    [userId],
  );
  return rows[0] ?? {};
}

async function consentRecords(userId: string) {
  const { rows } = await app.query<{
    id: string;
    user_id: string;
    purpose: string;
    jurisdiction: string;
    policy_version_id: string;
    state: string;
    recorded_at: Date;
    source: string;
    audience: string | null;
  }>(`SELECT * FROM identity.consent_record WHERE user_id = $1 ORDER BY id`, [userId]);
  return rows;
}

async function liveConsent(userId: string, sector: string) {
  const { rows } = await app.query<{ ended_at: Date | null; end_reason: string | null }>(
    `SELECT ended_at, end_reason FROM oidc.app_consent WHERE user_id = $1 AND sector = $2`,
    [userId, sector],
  );
  return rows[0];
}

beforeAll(() => {
  app = new Pool({ connectionString: APP_URL, max: 2 });
  owner = new Pool({ connectionString: OWNER_URL, max: 2 });
});

afterAll(async () => {
  await app.end();
  await owner.end();
});

describe("oidc.forget_subject", () => {
  it("tells each receiving app, ends invited teens' access, and leaves no oidc row", async () => {
    const parent = await person("1985-05-05");
    const teen = await person(yearsAgo(15));
    const grownUp = await person(yearsAgo(19)); // invited as a teen, now 18+
    const other = await person("1990-01-01");

    const subs = {
      snap: await subject(parent, SNAP),
      ftr: await subject(parent, FTR),
      unreceived: await subject(parent, "no-receiver"),
      teen: await subject(teen, SNAP),
      grownUp: await subject(grownUp, SNAP),
      other: await subject(other, SNAP),
    };
    await consent(parent, SNAP);
    await consent(parent, FTR);
    await consent(other, SNAP);
    const teenInvite = await invite(parent, teen);
    const grownUpInvite = await invite(parent, grownUp);
    await invite(parent, null); // pending, never accepted
    await consent(teen, SNAP, teenInvite);
    await consent(grownUp, SNAP, grownUpInvite);
    await owner.query(
      `INSERT INTO identity.consent_record
         (user_id, purpose, jurisdiction, policy_version_id, state, source, audience)
       VALUES ($1, 'sister_app_profile_sharing', 'AU', 'pv-1', 'granted', 'oidc_consent_screen', $2)`,
      [parent, SNAP],
    );
    await owner.query(
      `INSERT INTO oidc.sign_in_log (user_id, client_id, result) VALUES ($1, 'c', 'ok'), ($2, 'c', 'ok')`,
      [parent, other],
    );
    await owner.query(
      `INSERT INTO oidc.model (kind, id, payload) VALUES
         ('Session', $1, jsonb_build_object('accountId', $4::text)),
         ('Interaction', $2, jsonb_build_object('result', jsonb_build_object('login', jsonb_build_object('accountId', $4::text)))),
         ('Session', $3, jsonb_build_object('accountId', $5::text))`,
      [randomUUID(), randomUUID(), randomUUID(), parent, other],
    );
    const evidenceBefore = await consentRecords(parent);
    const otherBefore = await oidcRows(other);

    // 2 account-deleted + 1 inviter_deleted, then 3 subjects, 2 consents,
    // 3 invites, 1 log line and 2 provider records deleted.
    expect(await forget(parent)).toBe(14);

    expect(await events([subs.snap, subs.ftr, subs.unreceived])).toEqual([
      { client_id: "ftr-web", sub: subs.ftr, event_type: DELETED, payload: { [DELETED]: {} } },
      {
        client_id: "snapapp-staging-server",
        sub: subs.snap,
        event_type: DELETED,
        payload: { [DELETED]: {} },
      },
    ]);
    expect(await events([subs.teen])).toEqual([
      {
        client_id: "snapapp-staging-server",
        sub: subs.teen,
        event_type: ENDED,
        payload: { [ENDED]: { reason: "inviter_deleted", erase_data: true } },
      },
    ]);
    expect(await liveConsent(teen, SNAP)).toMatchObject({ end_reason: "inviter_deleted" });
    const withdrawal = (await consentRecords(teen)).at(-1);
    expect(withdrawal).toMatchObject({
      state: "withdrawn",
      source: "inviter_deleted",
      audience: SNAP,
      jurisdiction: "AU",
    });

    // The adult's space is their own: no event, consent standing.
    expect(await events([subs.grownUp])).toEqual([]);
    expect(await liveConsent(grownUp, SNAP)).toMatchObject({ ended_at: null });

    expect(await oidcRows(parent)).toEqual({
      subject: 0,
      app_consent: 0,
      teen_invite: 0,
      sign_in_log: 0,
      model: 0,
    });
    expect(await consentRecords(parent)).toEqual(evidenceBefore);
    expect(await oidcRows(other)).toEqual(otherBefore);
    expect(await events([subs.other])).toEqual([]);

    // A second call (the sweep after a retry) finds nothing and writes nothing.
    expect(await forget(parent)).toBe(0);
    expect(await events([subs.snap, subs.ftr, subs.teen])).toHaveLength(3);
  });

  it("refuses receivers it cannot route", async () => {
    const id = await person("1980-01-01");
    for (const bad of [
      "{}",
      JSON.stringify([{ sector: SNAP }]),
      JSON.stringify([...RECEIVERS, RECEIVERS[0]]),
    ]) {
      await expect(
        app.query(`SELECT oidc.forget_subject($1, $2::jsonb)`, [id, bad]),
      ).rejects.toThrow(/receiver/);
    }
  });
});

describe("oidc.end_app_access", () => {
  const cases = [
    { reason: "user_removed", teen: false, erase: false },
    { reason: "security", teen: false, erase: false },
    { reason: "teen_removed", teen: true, erase: true },
    { reason: "guardian_withdrew", teen: true, erase: true },
    { reason: "parent_ended", teen: true, erase: true },
    { reason: "inviter_deleted", teen: true, erase: true },
  ] as const;

  for (const { reason, teen, erase } of cases) {
    it(`ends access for ${reason}`, async () => {
      const userId = await person(teen ? yearsAgo(16) : "1990-01-01");
      const sub = await subject(userId, SNAP);
      let inviteId: string | null = null;
      if (teen) {
        inviteId = await invite(await person("1970-01-01"), userId);
        await consent(userId, SNAP, inviteId);
      } else {
        await consent(userId, SNAP);
      }

      expect(await endAccess(userId, SNAP, "snapapp-staging-server", reason)).toBe(true);

      expect(await liveConsent(userId, SNAP)).toMatchObject({ end_reason: reason });
      expect(await events([sub])).toEqual([
        {
          client_id: "snapapp-staging-server",
          sub,
          event_type: ENDED,
          payload: { [ENDED]: { reason, erase_data: erase } },
        },
      ]);
      const records = await consentRecords(userId);
      expect(records).toHaveLength(1);
      const record = records[0]!;
      expect(record).toMatchObject({ state: "withdrawn", source: reason, audience: SNAP });
      // Me's consent list parses every record: the new source must pass.
      consentRecordSchema.parse({
        userId: record.user_id,
        purpose: record.purpose,
        jurisdiction: record.jurisdiction,
        policyVersionId: record.policy_version_id,
        state: record.state,
        recordedAt: record.recorded_at.toISOString(),
        source: record.source,
      });
      if (inviteId !== null) {
        const { rows } = await app.query(
          `SELECT end_reason FROM oidc.teen_invite WHERE id = $1 AND ended_at IS NOT NULL`,
          [inviteId],
        );
        expect(rows).toEqual([{ end_reason: reason }]);
      }

      // Nothing live any more: false, and nothing written.
      expect(await endAccess(userId, SNAP, "snapapp-staging-server", reason)).toBe(false);
      expect(await events([sub])).toHaveLength(1);
      expect(await consentRecords(userId)).toHaveLength(1);
    });
  }

  it("is false with nothing written when no consent is live", async () => {
    const never = await person("1990-01-01");
    const sub = await subject(never, SNAP);
    expect(await endAccess(never, SNAP, "snapapp-staging-server", "user_removed")).toBe(false);
    expect(await events([sub])).toEqual([]);
    expect(await consentRecords(never)).toEqual([]);
  });

  it("leaves an adult's own consent alone for a guardian-side reason", async () => {
    const adult = await person("1990-01-01");
    await consent(adult, SNAP);
    expect(await endAccess(adult, SNAP, "snapapp-staging-server", "guardian_withdrew")).toBe(false);
    expect(await liveConsent(adult, SNAP)).toMatchObject({ ended_at: null });
  });

  it("ends access without an event when the sector has no receiver", async () => {
    const adult = await person("1990-01-01");
    const sub = await subject(adult, SNAP);
    await consent(adult, SNAP);
    expect(await endAccess(adult, SNAP, null, "user_removed")).toBe(true);
    expect(await events([sub])).toEqual([]);
    expect(await consentRecords(adult)).toHaveLength(1);
  });

  it("refuses an unknown reason", async () => {
    await expect(endAccess(randomUUID(), SNAP, null, "because")).rejects.toThrow(/unknown/);
  });
});
