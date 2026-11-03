import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { TeenInviteProblem } from "@yourtal/contracts/oidc/interaction";
import type { TeenInvite, TeenInviteCreated } from "@yourtal/contracts/oidc/teen-invite";
import { hashOpaqueToken } from "../auth/crypto/opaque-token";
import { normalizeEmail } from "../auth/email";
import { ageBandOf } from "./claims";
import type { Region } from "./clients";
import type { TeenInviteCheck, TeenInviteChecker } from "./sign-in-checks";

/** docs/26 §3.3: valid 7 days, 10 a day per parent, 128 random bits. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITES_PER_DAY = 10;
const CODE_BYTES = 16;

export const ACCESS_ENDED_EVENT = "urn:yourtal:event:access-ended";

export type CreateInviteResult =
  | { readonly ok: true; readonly invite: Required<TeenInviteCreated> }
  | { readonly ok: false; readonly error: "parent_not_eligible" | "too_many_invites" };

export interface TeenInviteStore extends TeenInviteChecker {
  create(input: { sector: string; parentSub: string; now: Date }): Promise<CreateInviteResult>;
  find(input: { sector: string; inviteId: string; now: Date }): Promise<TeenInvite | null>;
  /**
   * Ends the invite and the teen's access, and queues `access-ended` with
   * `parent_ended` for each of `receivers` (docs/26 §2.2). Null when no such
   * invite by this parent exists in this sector.
   */
  end(input: {
    sector: string;
    inviteId: string;
    parentSub: string;
    receivers: readonly string[];
    now: Date;
  }): Promise<TeenInvite | null>;
}

interface PersonRow {
  display_name: string;
  region: Region;
  date_of_birth: string;
  suspended: boolean;
  email: string | null;
  email_verified: boolean;
}

interface InviteRow {
  id: string;
  sector: string;
  inviter_user_id: string;
  region: Region;
  teen_user_id: string | null;
  expires_at: Date;
  accepted_at: Date | null;
  ended_at: Date | null;
}

const INVITE_COLUMNS =
  "id, sector, inviter_user_id, region, teen_user_id, expires_at, accepted_at, ended_at";

type Query = Pick<Pool | PoolClient, "query">;

async function person(db: Query, userId: string): Promise<PersonRow | null> {
  const result = await db.query<PersonRow>(
    `SELECT p.display_name, p.region, to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
            p.suspended_at IS NOT NULL AS suspended,
            c.identifier AS email, c.verified_at IS NOT NULL AS email_verified
       FROM identity.user_profile p
       LEFT JOIN identity.credential c ON c.user_id = p.user_id AND c.kind = 'password'
      WHERE p.user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

/** A verified adult whose account is not on hold: who may make an invite. */
function verifiedAdult(row: PersonRow | null, now: Date): row is PersonRow & { email: string } {
  return (
    row !== null &&
    row.email !== null &&
    row.email_verified &&
    !row.suspended &&
    ageBandOf({ dateOfBirth: row.date_of_birth }, now) === "adult"
  );
}

function statusOf(row: InviteRow, now: Date): TeenInvite["status"] {
  if (row.ended_at !== null) return "ended";
  if (row.accepted_at !== null) return "accepted";
  return row.expires_at.getTime() <= now.getTime() ? "expired" : "pending";
}

async function subOf(db: Query, sector: string, userId: string | null): Promise<string | null> {
  if (userId === null) return null;
  const result = await db.query<{ sub: string }>(
    "SELECT sub FROM oidc.subject WHERE sector = $1 AND user_id = $2",
    [sector, userId],
  );
  return result.rows[0]?.sub ?? null;
}

async function userOfSub(db: Query, sector: string, sub: string): Promise<string | null> {
  const result = await db.query<{ user_id: string }>(
    "SELECT user_id FROM oidc.subject WHERE sector = $1 AND sub = $2",
    [sector, sub],
  );
  return result.rows[0]?.user_id ?? null;
}

async function view(db: Query, row: InviteRow, now: Date): Promise<TeenInvite> {
  return {
    inviteId: row.id,
    status: statusOf(row, now),
    teenSub: await subOf(db, row.sector, row.teen_user_id),
  };
}

/** The approved guardian's email, or null while the guardian's consent is not `granted`. */
async function approvedGuardian(pool: Pool, teenUserId: string): Promise<{ email: string | null } | null> {
  const result = await pool.query<{ guardian_email: string | null }>(
    `SELECT g.guardian_email
       FROM identity.guardian_consent g
       JOIN identity.user_profile p ON p.user_id = g.user_id
      WHERE g.user_id = $1 AND p.parent_consent_status = 'granted'
        AND g.approved_at IS NOT NULL AND g.revoked_at IS NULL`,
    [teenUserId],
  );
  const row = result.rows[0];
  return row === undefined ? null : { email: row.guardian_email };
}

/**
 * docs/26 §3.3, "Who approves": the inviter is a verified adult in the
 * teen's region whose email is the approved guardian email, both normalised.
 */
async function byGuardian(
  pool: Pool,
  teen: { region: Region },
  guardianEmail: string | null,
  invite: InviteRow,
  now: Date,
): Promise<TeenInviteCheck> {
  const inviter = await person(pool, invite.inviter_user_id);
  const isGuardian =
    verifiedAdult(inviter, now) &&
    inviter.region === teen.region &&
    invite.region === teen.region &&
    guardianEmail !== null &&
    normalizeEmail(guardianEmail) === normalizeEmail(inviter.email);
  if (!isGuardian) return { allowed: false, problem: "wrong_inviter" };
  return {
    allowed: true,
    inviteId: invite.id,
    parentName: inviter.display_name,
    pending: invite.accepted_at === null,
  };
}

export function createPgTeenInvites(pool: Pool): TeenInviteStore {
  return {
    /**
     * Only ever reads (sign-in-checks.ts): a standing invite this teen accepted
     * in this app, else a pending one by its code. The guardian is checked
     * again each time, so a withdrawn approval stops the next sign-in.
     */
    async check({ userId, client, inviteCode, now }) {
      const teen = await person(pool, userId);
      const guardian = await approvedGuardian(pool, userId);
      if (teen === null || guardian === null) return { allowed: false, problem: "not_approved" };

      const standing = await pool.query<InviteRow>(
        `SELECT ${INVITE_COLUMNS} FROM oidc.teen_invite
          WHERE teen_user_id = $1 AND sector = $2 AND accepted_at IS NOT NULL AND ended_at IS NULL
          ORDER BY accepted_at DESC LIMIT 1`,
        [userId, client.sector],
      );
      const accepted = standing.rows[0];
      let problem: TeenInviteProblem = "no_invite";
      if (accepted !== undefined) {
        const result = await byGuardian(pool, teen, guardian.email, accepted, now);
        if (result.allowed) return result;
        problem = result.problem;
      }
      if (inviteCode === undefined) return { allowed: false, problem };

      const byCode = await pool.query<InviteRow>(
        `SELECT ${INVITE_COLUMNS} FROM oidc.teen_invite WHERE code_hash = $1 AND sector = $2`,
        [hashOpaqueToken(inviteCode), client.sector],
      );
      const invite = byCode.rows[0];
      if (invite === undefined || statusOf(invite, now) !== "pending") {
        return { allowed: false, problem: "invite_expired" };
      }
      return byGuardian(pool, teen, guardian.email, invite, now);
    },

    async create({ sector, parentSub, now }) {
      const parentId = await userOfSub(pool, sector, parentSub);
      const parent = parentId === null ? null : await person(pool, parentId);
      if (parentId === null || !verifiedAdult(parent, now)) {
        return { ok: false, error: "parent_not_eligible" };
      }
      const code = randomBytes(CODE_BYTES).toString("base64url");
      const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
      // The daily cap and the insert in one statement, so two at once cannot both slip under it.
      const made = await pool.query<{ id: string }>(
        `INSERT INTO oidc.teen_invite (id, sector, code_hash, inviter_user_id, region, created_at, expires_at)
         SELECT $1, $2, $3, $4, $5, $6, $7
          WHERE (SELECT count(*) FROM oidc.teen_invite
                  WHERE inviter_user_id = $4 AND created_at > $6::timestamptz - interval '1 day') < $8
         RETURNING id`,
        [
          randomUUID(),
          sector,
          hashOpaqueToken(code),
          parentId,
          parent.region,
          now,
          expiresAt,
          INVITES_PER_DAY,
        ],
      );
      const inviteId = made.rows[0]?.id;
      if (inviteId === undefined) return { ok: false, error: "too_many_invites" };
      return { ok: true, invite: { inviteId, code, expiresAt: expiresAt.toISOString() } };
    },

    async find({ sector, inviteId, now }) {
      const result = await pool.query<InviteRow>(
        `SELECT ${INVITE_COLUMNS} FROM oidc.teen_invite WHERE id = $1 AND sector = $2`,
        [inviteId, sector],
      );
      const row = result.rows[0];
      return row === undefined ? null : view(pool, row, now);
    },

    async end({ sector, inviteId, parentSub, receivers, now }) {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        const parentId = await userOfSub(db, sector, parentSub);
        const locked = await db.query<InviteRow>(
          `SELECT ${INVITE_COLUMNS} FROM oidc.teen_invite
            WHERE id = $1 AND sector = $2 AND inviter_user_id = $3 FOR UPDATE`,
          [inviteId, sector, parentId ?? ""],
        );
        const row = locked.rows[0];
        if (row === undefined) {
          await db.query("ROLLBACK");
          return null;
        }
        if (row.ended_at === null) {
          await db.query(
            "UPDATE oidc.teen_invite SET ended_at = $2, end_reason = 'parent_ended' WHERE id = $1",
            [row.id, now],
          );
          row.ended_at = now;
          if (row.teen_user_id !== null) {
            await endTeenAccess(db, row, row.teen_user_id, receivers, now);
          }
        }
        const answer = await view(db, row, now);
        await db.query("COMMIT");
        return answer;
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      } finally {
        db.release();
      }
    },
  };
}

/** The teen's consent ends, its withdrawal is evidenced, and each receiving client is told. */
async function endTeenAccess(
  db: PoolClient,
  invite: InviteRow,
  teenUserId: string,
  receivers: readonly string[],
  now: Date,
): Promise<void> {
  const ended = await db.query<{ policy_version_id: string }>(
    `UPDATE oidc.app_consent SET ended_at = $3, end_reason = 'parent_ended'
      WHERE user_id = $1 AND sector = $2 AND invite_id = $4 AND ended_at IS NULL
      RETURNING policy_version_id`,
    [teenUserId, invite.sector, now, invite.id],
  );
  const policy = ended.rows[0]?.policy_version_id;
  if (policy !== undefined) {
    await db.query(
      `INSERT INTO identity.consent_record
         (user_id, purpose, jurisdiction, policy_version_id, state, recorded_at, source, audience)
       VALUES ($1, 'sister_app_profile_sharing', $2, $3, 'withdrawn', $4, 'guardian_invite', $5)`,
      [teenUserId, invite.region, policy, now, invite.sector],
    );
  }
  const sub = await subOf(db, invite.sector, teenUserId);
  if (sub === null) return;
  for (const clientId of receivers) {
    await db.query(
      `INSERT INTO oidc.event_outbox (jti, client_id, sub, event_type, payload, iat)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        clientId,
        sub,
        ACCESS_ENDED_EVENT,
        { [ACCESS_ENDED_EVENT]: { reason: "parent_ended", erase_data: true } },
        now,
      ],
    );
  }
}
