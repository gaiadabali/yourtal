import type { Pool } from "pg";
import type {
  MailboxStatus,
  SpambankApp,
  SpambankRegion,
} from "@yourtal/contracts/spambank/common";
import { eraseSpambankMailbox } from "@yourtal/db/dsar-spambank-handlers";

/**
 * `spambank.mailbox` for the management API (spambank/BUILD.md section 6): one row per YourTal
 * account, created `provisioning` with its name, made `active` once the mail account and its folders
 * exist. Raw SQL on the app role's pool, always by `user_id`: the region wall is not applied to this
 * pool (nothing here lists mailboxes), and every statement names the one person it is about.
 */

export interface MailboxRecord {
  readonly id: string;
  readonly userId: string;
  readonly region: SpambankRegion;
  readonly localPart: string;
  readonly domain: string;
  /** Stalwart's id for the account; null until the account was created. */
  readonly stalwartAccountId: string | null;
  readonly junkMailboxId: string | null;
  readonly status: MailboxStatus;
  readonly enabledVia: SpambankApp;
  readonly statementsToSnapapp: boolean;
  readonly newMailAlerts: boolean;
  readonly emailState: string | null;
  readonly createdAt: Date;
}

export type InsertOutcome =
  | { readonly kind: "inserted"; readonly mailbox: MailboxRecord }
  /** The name is in use, or retired: draw another. */
  | { readonly kind: "name_taken" }
  /** The person already has a mailbox (a call that raced this one made it). */
  | { readonly kind: "user_exists"; readonly mailbox: MailboxRecord };

export interface NewMailbox {
  readonly userId: string;
  readonly region: SpambankRegion;
  readonly localPart: string;
  readonly domain: string;
  readonly enabledVia: SpambankApp;
}

export interface MailboxStore {
  find(userId: string): Promise<MailboxRecord | null>;
  insertProvisioning(input: NewMailbox): Promise<InsertOutcome>;
  setStalwartAccount(id: string, accountId: string): Promise<void>;
  /** `provisioning` to `active`. Null when the row is no longer `provisioning` (it was erased meanwhile). */
  activate(
    id: string,
    input: { junkMailboxId: string | null; emailState: string | null },
  ): Promise<MailboxRecord | null>;
  /** Drops a `provisioning` row whose name cannot be used; `retire` keeps the name from being drawn again. */
  discardProvisioning(id: string, localPart: string, retire: boolean): Promise<void>;
  updateSettings(
    id: string,
    patch: { statementsToSnapapp?: boolean; newMailAlerts?: boolean },
  ): Promise<MailboxRecord | null>;
  /** BUILD.md 4.11: marks the mailbox `erasing`, retires its name, deletes what the service learned from its mail. */
  erase(userId: string): Promise<number>;
  /** The row of a mailbox whose Stalwart account is gone. */
  removeErasing(id: string): Promise<void>;
  /** Runs `work` while holding this person's lock, so two calls to switch on never both provision. */
  withUserLock<T>(userId: string, work: () => Promise<T>): Promise<T>;
}

interface Row {
  id: string;
  user_id: string;
  region: SpambankRegion;
  local_part: string;
  domain: string;
  stalwart_account_id: string | null;
  junk_mailbox_id: string | null;
  status: MailboxStatus;
  enabled_via: SpambankApp;
  statements_to_snapapp: boolean;
  new_mail_alerts: boolean;
  email_state: string | null;
  created_at: Date;
}

const COLUMNS = `id, user_id, region, local_part, domain, stalwart_account_id, junk_mailbox_id,
  status, enabled_via, statements_to_snapapp, new_mail_alerts, email_state, created_at`;

function recordOf(row: Row): MailboxRecord {
  return {
    id: row.id,
    userId: row.user_id,
    region: row.region,
    localPart: row.local_part,
    domain: row.domain,
    stalwartAccountId: row.stalwart_account_id,
    junkMailboxId: row.junk_mailbox_id,
    status: row.status,
    enabledVia: row.enabled_via,
    statementsToSnapapp: row.statements_to_snapapp,
    newMailAlerts: row.new_mail_alerts,
    emailState: row.email_state,
    createdAt: row.created_at,
  };
}

const UNIQUE_VIOLATION = "23505";

function uniqueViolationOn(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  if (code !== UNIQUE_VIOLATION) return null;
  return typeof constraint === "string" ? constraint : "";
}

/**
 * `lockPool` is where a person's advisory lock is held while the work runs. It is a pool of its own
 * so that work holding a lock (which then queries through `pool`) can never use up the connections it
 * is waiting for; by default the two are the same pool.
 */
export function createPgMailboxStore(pool: Pool, lockPool: Pool = pool): MailboxStore {
  const lockKey = (userId: string) => `spambank:mailbox:${userId}`;

  async function find(userId: string): Promise<MailboxRecord | null> {
    const result = await pool.query<Row>(
      `SELECT ${COLUMNS} FROM spambank.mailbox WHERE user_id = $1`,
      [userId],
    );
    const row = result.rows[0];
    return row === undefined ? null : recordOf(row);
  }

  return {
    find,

    async insertProvisioning(input) {
      try {
        const result = await pool.query<Row>(
          `INSERT INTO spambank.mailbox (user_id, region, local_part, domain, status, enabled_via)
           VALUES ($1, $2, $3, $4, 'provisioning', $5)
           RETURNING ${COLUMNS}`,
          [input.userId, input.region, input.localPart, input.domain, input.enabledVia],
        );
        const row = result.rows[0];
        if (row === undefined) throw new Error("spambank.mailbox insert returned no row");
        return { kind: "inserted", mailbox: recordOf(row) };
      } catch (error) {
        const constraint = uniqueViolationOn(error);
        if (constraint === null) throw error;
        // `mailbox_user_id_key`: this person's own row. Anything else is the name: taken, or the
        // retired-name trigger's `mailbox_local_part_retired`.
        if (constraint.includes("user_id")) {
          const existing = await find(input.userId);
          if (existing !== null) return { kind: "user_exists", mailbox: existing };
        }
        return { kind: "name_taken" };
      }
    },

    async setStalwartAccount(id, accountId) {
      await pool.query(
        `UPDATE spambank.mailbox SET stalwart_account_id = $2, updated_at = now() WHERE id = $1`,
        [id, accountId],
      );
    },

    async activate(id, input) {
      const result = await pool.query<Row>(
        `UPDATE spambank.mailbox
            SET status = 'active', junk_mailbox_id = $2, email_state = $3, updated_at = now()
          WHERE id = $1 AND status = 'provisioning'
          RETURNING ${COLUMNS}`,
        [id, input.junkMailboxId, input.emailState],
      );
      const row = result.rows[0];
      return row === undefined ? null : recordOf(row);
    },

    async discardProvisioning(id, localPart, retire) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (retire) {
          await client.query(
            `INSERT INTO spambank.retired_name (local_part) VALUES ($1) ON CONFLICT DO NOTHING`,
            [localPart],
          );
        }
        await client.query(
          `DELETE FROM spambank.mailbox WHERE id = $1 AND status = 'provisioning'`,
          [id],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async updateSettings(id, patch) {
      const result = await pool.query<Row>(
        `UPDATE spambank.mailbox
            SET statements_to_snapapp = COALESCE($2::boolean, statements_to_snapapp),
                new_mail_alerts = COALESCE($3::boolean, new_mail_alerts),
                updated_at = now()
          WHERE id = $1 AND status IN ('active', 'suspended')
          RETURNING ${COLUMNS}`,
        [id, patch.statementsToSnapapp ?? null, patch.newMailAlerts ?? null],
      );
      const row = result.rows[0];
      return row === undefined ? null : recordOf(row);
    },

    async erase(userId) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const records = await eraseSpambankMailbox(client, userId);
        await client.query("COMMIT");
        return records;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async removeErasing(id) {
      await pool.query(`DELETE FROM spambank.mailbox WHERE id = $1 AND status = 'erasing'`, [id]);
    },

    async withUserLock(userId, work) {
      const client = await lockPool.connect();
      let unlocked = false;
      try {
        await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [lockKey(userId)]);
        try {
          return await work();
        } finally {
          unlocked = await client
            .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockKey(userId)])
            .then(
              () => true,
              () => false,
            );
        }
      } finally {
        // A connection that may still hold the lock must not go back to the pool.
        client.release(unlocked ? undefined : true);
      }
    },
  };
}
