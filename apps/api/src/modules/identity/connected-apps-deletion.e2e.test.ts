import { randomBytes, randomUUID } from "node:crypto";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { receiversFor } from "@yourtal/contracts/oidc/event-receivers";
import { AppModule } from "../../app.module";
import { LEDGER_INTERNAL_CLIENT } from "../../shared/ledger-client/ledger-internal-client";
import type { LedgerInternalClient } from "../../shared/ledger-client/ledger-internal-client";
import type { AppDb } from "../../shared/persistence/drizzle-client";
import { sessionFor } from "../../shared/testing/session-for";
import { IDENTITY_DB } from "./persistence/identity-db.token";
import { GUARDIAN_CONSENT_REPOSITORY } from "./persistence/guardian-consent.repository";
import type { GuardianConsentRepository } from "./persistence/guardian-consent.repository";
import { USER_PROFILE_REPOSITORY } from "./persistence/user-profile.repository";
import type { UserProfileRepository } from "./persistence/user-profile.repository";
import { createPgOidcStore } from "../oidc/oidc-store";
import { revokeGuardianConsent } from "./use-cases/revoke-guardian-consent.use-case";

/**
 * Group 3.7 Y2 (docs/29 §5), against the real app and Postgres: a deletion,
 * self-service or by the guardian's link, writes one `account-deleted` row for each
 * app the person signed in to and the report shows `connected_apps`; the guardian's
 * withdrawal writes `guardian_withdrew` in its own transaction.
 */
const DATABASE_URL = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!;
const OWNER_URL = process.env["DATABASE_OWNER_URL"]!;
const RECEIVERS = receiversFor("dev");
const SNAP = RECEIVERS[0]!;

let app: NestFastifyApplication;
let owner: pg.Pool;
const originalTeenAccounts = process.env["TEEN_ACCOUNTS"];

beforeAll(async () => {
  process.env["TEEN_ACCOUNTS"] = "true";
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalPipes(new ZodValidationPipe());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  owner = new pg.Pool({ connectionString: OWNER_URL || DATABASE_URL, max: 2 });
});

afterAll(async () => {
  await app.close();
  await owner.end();
  if (originalTeenAccounts === undefined) delete process.env["TEEN_ACCOUNTS"];
  else process.env["TEEN_ACCOUNTS"] = originalTeenAccounts;
});

function randomTestIp(): string {
  const [a, b, c] = randomBytes(3);
  return `10.${String(a)}.${String(b)}.${String(c)}`;
}

/** A registered, approved-pending teen and the guardian link's token. */
async function teen(): Promise<{ userId: string; token: string }> {
  const guardianEmail = `guardian+${randomUUID()}@example.test`;
  const register = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    remoteAddress: randomTestIp(),
    headers: { "idempotency-key": randomUUID() },
    payload: {
      email: `connected-apps-teen+${randomUUID()}@example.test`,
      password: "not-a-real-secret-3-7-y2",
      region: "AU",
      locale: "en-AU",
      displayName: "Connected Apps Teen",
      dateOfBirth: "2012-01-01",
      timezone: "Australia/Sydney",
      guardianEmail,
    },
  });
  expect(register.statusCode).toBeLessThan(300);
  const { userId } = register.json<{ userId: string }>();
  const { rows } = await owner.query<{ metadata: { token: string } }>(
    `SELECT metadata FROM platform.sim_outbox WHERE category = 'guardian_consent' AND recipient = $1`,
    [guardianEmail],
  );
  return { userId, token: rows[0]!.metadata.token };
}

/** The person has signed in to every receiving app. */
async function signedIn(userId: string): Promise<string[]> {
  const subs: string[] = [];
  for (const receiver of RECEIVERS) {
    const sub = `sub-${randomUUID()}`;
    subs.push(sub);
    await owner.query(`INSERT INTO oidc.subject (sector, user_id, sub) VALUES ($1, $2, $3)`, [
      receiver.sector,
      userId,
      sub,
    ]);
  }
  return subs;
}

async function outbox(subs: string[]) {
  const { rows } = await owner.query<{
    client_id: string;
    event_type: string;
    payload: Record<string, Record<string, unknown>>;
  }>(
    `SELECT client_id, event_type, payload FROM oidc.event_outbox WHERE sub = ANY($1) ORDER BY client_id`,
    [subs],
  );
  return rows;
}

const oidcRows = async (userId: string): Promise<number> =>
  (
    await owner.query(
      `SELECT 1 FROM oidc.subject WHERE user_id = $1 UNION ALL SELECT 1 FROM oidc.app_consent WHERE user_id = $1`,
      [userId],
    )
  ).rowCount ?? 0;

const DELETED = "urn:yourtal:event:account-deleted";
const ENDED = "urn:yourtal:event:access-ended";

describe("deleting an account tells the apps", () => {
  it("self-delete: one account-deleted row per app, the report shows connected_apps, oidc rows gone", async () => {
    const session = await sessionFor(app, { jurisdiction: "AU" });
    const subs = await signedIn(session.userId);

    const response = await app.inject({
      method: "DELETE",
      url: "/api/me",
      headers: { cookie: session.cookie, "idempotency-key": randomUUID() },
    });
    expect(response.statusCode, response.body).toBe(200);
    const report = response.json<{
      complete: boolean;
      results: { domain: string; outcome: { status: string; records?: number } }[];
    }>();
    expect(report.complete).toBe(true);
    expect(report.results.find((result) => result.domain === "connected_apps")?.outcome).toEqual({
      status: "erased",
      records: 2 * RECEIVERS.length,
    });

    const rows = await outbox(subs);
    expect(rows.map((row) => [row.client_id, row.event_type])).toEqual(
      RECEIVERS.map((receiver) => [receiver.clientId, DELETED]).sort(),
    );
    expect(await oidcRows(session.userId)).toBe(0);
  });

  it("the guardian's delete link writes the same rows", async () => {
    const { userId, token } = await teen();
    const subs = await signedIn(userId);

    const response = await app.inject({
      method: "POST",
      url: `/api/guardian/${token}/delete-account`,
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID(), "content-type": "application/json" },
      payload: { confirm: true },
    });
    expect(response.statusCode, response.body).toBe(201);

    expect((await outbox(subs)).map((row) => row.event_type)).toEqual(RECEIVERS.map(() => DELETED));
    expect(await oidcRows(userId)).toBe(0);
  });
});

describe("the guardian's withdrawal ends the teen's app access", () => {
  /** A teen who signed in to SnapApp through a parent's invite. */
  async function invitedTeen() {
    const person = await teen();
    const [sub] = await signedIn(person.userId);
    const invite = randomUUID();
    await owner.query(
      `INSERT INTO oidc.teen_invite
         (id, sector, code_hash, inviter_user_id, region, teen_user_id, expires_at, accepted_at)
       VALUES ($1, $2, $3, $4, 'AU', $5, now() + interval '7 days', now())`,
      [invite, SNAP.sector, `hash-${invite}`, randomUUID(), person.userId],
    );
    await owner.query(
      `INSERT INTO oidc.app_consent (user_id, sector, scopes, policy_version_id, granted_via, invite_id, granted_at)
       VALUES ($1, $2, '{openid}', 'pv-1', 'guardian_invite', $3, now())`,
      [person.userId, SNAP.sector, invite],
    );
    return { ...person, sub: sub!, invite };
  }

  const state = async (userId: string, invite: string) => {
    const consent = await owner.query<{ ended_at: Date | null; end_reason: string | null }>(
      `SELECT ended_at, end_reason FROM oidc.app_consent WHERE user_id = $1`,
      [userId],
    );
    const invites = await owner.query<{ ended_at: Date | null }>(
      `SELECT ended_at FROM oidc.teen_invite WHERE id = $1`,
      [invite],
    );
    const records = await owner.query(
      `SELECT 1 FROM identity.consent_record WHERE user_id = $1 AND state = 'withdrawn' AND source = 'guardian_withdrew'`,
      [userId],
    );
    const guardian = await owner.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at FROM identity.guardian_consent WHERE user_id = $1`,
      [userId],
    );
    return {
      consentEnded: consent.rows[0]?.ended_at != null,
      consentReason: consent.rows[0]?.end_reason,
      inviteEnded: invites.rows[0]?.ended_at != null,
      withdrawnRecords: records.rowCount,
      revoked: guardian.rows[0]?.revoked_at != null,
    };
  };

  it("writes access-ended with guardian_withdrew, the withdrawn record and the end of the invite", async () => {
    const person = await invitedTeen();
    const response = await app.inject({
      method: "POST",
      url: `/api/guardian/${person.token}/revoke`,
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
    });
    expect(response.statusCode, response.body).toBe(201);

    const rows = await outbox([person.sub]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ client_id: SNAP.clientId, event_type: ENDED });
    expect(rows[0]?.payload[ENDED]).toEqual({ reason: "guardian_withdrew", erase_data: true });
    expect(await state(person.userId, person.invite)).toEqual({
      consentEnded: true,
      consentReason: "guardian_withdrew",
      inviteEnded: true,
      withdrawnRecords: 1,
      revoked: true,
    });

    // A second use of the link changes nothing: still one event.
    await app.inject({
      method: "POST",
      url: `/api/guardian/${person.token}/revoke`,
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
    });
    expect(await outbox([person.sub])).toHaveLength(1);
  });

  it("ends a live consent in a sector with no receiver too, queueing no event for it", async () => {
    const person = await invitedTeen();
    await owner.query(`UPDATE oidc.app_consent SET sector = 'no-receiver' WHERE user_id = $1`, [
      person.userId,
    ]);
    const response = await app.inject({
      method: "POST",
      url: `/api/guardian/${person.token}/revoke`,
      remoteAddress: randomTestIp(),
      headers: { "idempotency-key": randomUUID() },
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(await outbox([person.sub])).toEqual([]);
    const consent = await owner.query<{ end_reason: string | null }>(
      `SELECT end_reason FROM oidc.app_consent WHERE user_id = $1`,
      [person.userId],
    );
    expect(consent.rows[0]?.end_reason).toBe("guardian_withdrew");
  });

  it("a forced rollback writes neither the revoke nor the events", async () => {
    const person = await invitedTeen();
    const profiles = app.get<UserProfileRepository>(USER_PROFILE_REPOSITORY, { strict: false });

    await expect(
      revokeGuardianConsent(
        app.get<AppDb>(IDENTITY_DB, { strict: false }),
        app.get<GuardianConsentRepository>(GUARDIAN_CONSENT_REPOSITORY, { strict: false }),
        { ...profiles, setParentConsentStatus: () => Promise.reject(new Error("forced rollback")) },
        app.get<LedgerInternalClient>(LEDGER_INTERNAL_CLIENT, { strict: false }),
        person.token,
        new Date(),
        RECEIVERS,
      ),
    ).rejects.toThrow("forced rollback");

    expect(await outbox([person.sub])).toEqual([]);
    expect(await state(person.userId, person.invite)).toEqual({
      consentEnded: false,
      consentReason: null,
      inviteEnded: false,
      withdrawnRecords: 0,
      revoked: false,
    });
  });
});

describe("3.10.g: a withdrawal racing a teen's acceptance leaves no live consent", () => {
  let appPool: pg.Pool;
  beforeAll(() => {
    appPool = new pg.Pool({ connectionString: DATABASE_URL, max: 4 });
  });
  afterAll(async () => {
    await appPool.end();
  });

  /** A teen with an approved guardian, a sub at SnapApp and a pending invite nobody has used. */
  async function acceptable() {
    const person = await teen();
    await owner.query(
      `UPDATE identity.guardian_consent SET approved_at = now(), guardian_confirmed_adult_at = now() WHERE user_id = $1`,
      [person.userId],
    );
    await signedIn(person.userId);
    const invite = randomUUID();
    await owner.query(
      `INSERT INTO oidc.teen_invite (id, sector, code_hash, inviter_user_id, region, expires_at)
       VALUES ($1, $2, $3, $4, 'AU', now() + interval '7 days')`,
      [invite, SNAP.sector, `hash-${invite}`, randomUUID()],
    );
    return { ...person, invite };
  }

  const accept = (userId: string, invite: string) =>
    createPgOidcStore(appPool).grantAppConsent({
      userId,
      sector: SNAP.sector,
      scopes: ["openid"],
      policyVersionId: "pv-1",
      jurisdiction: "AU",
      now: new Date(),
      invite: { id: invite, accept: true },
    });

  const withdraw = (token: string) =>
    revokeGuardianConsent(
      app.get<AppDb>(IDENTITY_DB, { strict: false }),
      app.get<GuardianConsentRepository>(GUARDIAN_CONSENT_REPOSITORY, { strict: false }),
      app.get<UserProfileRepository>(USER_PROFILE_REPOSITORY, { strict: false }),
      app.get<LedgerInternalClient>(LEDGER_INTERNAL_CLIENT, { strict: false }),
      token,
      new Date(),
      RECEIVERS,
    );

  /** Waits until `count` sessions are blocked on a lock whose statement matches `pattern`. */
  async function blocked(pattern: string, count = 1): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const { rows } = await owner.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE wait_event_type = 'Lock' AND query ILIKE $1 AND pid <> pg_backend_pid()`,
        [pattern],
      );
      if ((rows[0]?.n ?? 0) >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`nothing blocked on ${pattern}`);
  }

  const live = async (userId: string) =>
    (
      await owner.query(`SELECT 1 FROM oidc.app_consent WHERE user_id = $1 AND ended_at IS NULL`, [
        userId,
      ])
    ).rowCount;

  it("a withdrawal that commits first refuses the acceptance", async () => {
    const person = await acceptable();
    const guardian = await owner.connect();
    try {
      await guardian.query("BEGIN");
      await guardian.query(
        `UPDATE identity.guardian_consent SET approved_at = NULL, revoked_at = now() WHERE user_id = $1`,
        [person.userId],
      );
      const accepting = accept(person.userId, person.invite);
      await blocked("%FOR SHARE%");
      await guardian.query("COMMIT");
      expect(await accepting).toBe(false);
    } finally {
      await guardian.query("ROLLBACK");
      guardian.release();
    }
    expect(await live(person.userId)).toBe(0);
    expect(
      (await owner.query(`SELECT accepted_at FROM oidc.teen_invite WHERE id = $1`, [person.invite]))
        .rows[0].accepted_at,
    ).toBeNull();
  });

  it("an acceptance that holds the guardian row first is ended by the withdrawal that waits for it", async () => {
    const person = await acceptable();
    // Stall the acceptance after it has locked the guardian row, on the invite.
    const stall = await owner.connect();
    let accepting: Promise<boolean>;
    let withdrawing: ReturnType<typeof withdraw>;
    try {
      await stall.query("BEGIN");
      await stall.query(`SELECT 1 FROM oidc.teen_invite WHERE id = $1 FOR UPDATE`, [person.invite]);
      accepting = accept(person.userId, person.invite);
      await blocked("%teen_invite%FOR UPDATE%");
      withdrawing = withdraw(person.token);
      await blocked("%update%guardian_consent%");
      await stall.query("COMMIT");
    } finally {
      await stall.query("ROLLBACK");
      stall.release();
    }
    expect(await accepting).toBe(true);
    expect((await withdrawing).isOk()).toBe(true);

    expect(await live(person.userId)).toBe(0);
    const consent = await owner.query<{ end_reason: string }>(
      `SELECT end_reason FROM oidc.app_consent WHERE user_id = $1`,
      [person.userId],
    );
    expect(consent.rows).toEqual([{ end_reason: "guardian_withdrew" }]);
    expect(
      (
        await owner.query(
          `SELECT 1 FROM oidc.event_outbox WHERE client_id = $1 AND payload::text LIKE '%guardian_withdrew%' AND sub IN
             (SELECT sub FROM oidc.subject WHERE user_id = $2)`,
          [SNAP.clientId, person.userId],
        )
      ).rowCount,
    ).toBe(1);
  });
});
