import type { Pool } from "pg";
import { errors } from "oidc-provider";
import type { Adapter, AdapterFactory, AdapterPayload } from "oidc-provider";

/**
 * oidc-provider's storage over `oidc.model`. A row past `expires_at` reads as
 * absent; a consumed row carries `consumed`, which is how the library spots a
 * code used twice and revokes what the first use issued (docs/26 §1.6).
 *
 * Clients are never read from here: they are static (clients.ts). The library
 * asks the adapter about an unknown client id, so a stored "Client" row could
 * otherwise register an app nobody reviewed.
 */
const NEVER_STORED = new Set(["Client", "InitialAccessToken", "RegistrationAccessToken"]);

interface ModelRow {
  payload: AdapterPayload;
  consumed_at: Date | null;
}

function toPayload(row: ModelRow | undefined): AdapterPayload | undefined {
  if (row === undefined) return undefined;
  if (row.consumed_at === null) return row.payload;
  return { ...row.payload, consumed: Math.floor(row.consumed_at.getTime() / 1000) };
}

class PgAdapter implements Adapter {
  constructor(
    private readonly kind: string,
    private readonly pool: Pool,
  ) {}

  async upsert(id: string, payload: AdapterPayload, expiresIn?: number): Promise<void> {
    if (NEVER_STORED.has(this.kind)) throw new Error(`oidc: ${this.kind} records are not stored`);
    await this.pool.query(
      `INSERT INTO oidc.model (kind, id, payload, grant_id, uid, expires_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::int IS NULL THEN NULL
                                        ELSE now() + make_interval(secs => $6::int) END)
       ON CONFLICT (kind, id) DO UPDATE SET
         payload = EXCLUDED.payload,
         grant_id = EXCLUDED.grant_id,
         uid = EXCLUDED.uid,
         expires_at = EXCLUDED.expires_at`,
      [this.kind, id, payload, payload.grantId ?? null, payload.uid ?? null, expiresIn ?? null],
    );
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    if (NEVER_STORED.has(this.kind)) return undefined;
    const result = await this.pool.query<ModelRow>(
      `SELECT payload, consumed_at FROM oidc.model
        WHERE kind = $1 AND id = $2 AND (expires_at IS NULL OR expires_at > now())`,
      [this.kind, id],
    );
    return toPayload(result.rows[0]);
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    const result = await this.pool.query<ModelRow>(
      `SELECT payload, consumed_at FROM oidc.model
        WHERE kind = $1 AND uid = $2 AND (expires_at IS NULL OR expires_at > now())
        LIMIT 1`,
      [this.kind, uid],
    );
    return toPayload(result.rows[0]);
  }

  /** The device flow is off; nothing has a user code. */
  findByUserCode(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  /**
   * The library reads `consumed` before it calls this and ignores what it
   * returns, so two redemptions racing past that read would both win. Only
   * one UPDATE can flip consumed_at; the loser does what the library does for
   * a reused code (revokes the grant and everything issued from it) and
   * throws invalid_grant, which the token endpoint answers as a 400.
   */
  async consume(id: string): Promise<void> {
    const result = await this.pool.query<{ grant_id: string | null }>(
      `UPDATE oidc.model SET consumed_at = now()
        WHERE kind = $1 AND id = $2 AND consumed_at IS NULL
        RETURNING grant_id`,
      [this.kind, id],
    );
    if (result.rowCount === 1 || this.kind !== "AuthorizationCode") return;
    const row = await this.pool.query<{ grant_id: string | null }>(
      "SELECT grant_id FROM oidc.model WHERE kind = $1 AND id = $2",
      [this.kind, id],
    );
    const grantId = row.rows[0]?.grant_id;
    if (grantId !== null && grantId !== undefined) {
      await this.pool.query(
        "DELETE FROM oidc.model WHERE grant_id = $1 OR (kind = 'Grant' AND id = $1)",
        [grantId],
      );
    }
    throw new errors.InvalidGrant("authorization code already consumed");
  }

  async destroy(id: string): Promise<void> {
    await this.pool.query("DELETE FROM oidc.model WHERE kind = $1 AND id = $2", [this.kind, id]);
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await this.pool.query("DELETE FROM oidc.model WHERE grant_id = $1", [grantId]);
  }
}

export function pgAdapterFactory(pool: Pool): AdapterFactory {
  return (kind: string) => new PgAdapter(kind, pool);
}
