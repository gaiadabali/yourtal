import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { TransferProblem } from "@yourtal/contracts/oidc/transfer";
import type { OidcAccount } from "./claims";
import { ageBandOf } from "./claims";
import type { MachineClient, OperatedApp, TransferRoute, YourTalClient } from "./clients";
import { clientById, isSignInClient } from "./clients";
import type { OidcStore } from "./oidc-store";
import { NO_TEEN_INVITES, signInBlock } from "./sign-in-checks";
import type { TransferSigner } from "./transfer-assertion";

/**
 * Group 4.8.a (docs/30 §5, D3): an app transfer is an `oidc.model` row of kind
 * `AppTransfer` for 15 minutes, so the adapter's expiry, the model purge and
 * `oidc.forget_subject` (which matches `accountId`) cover it with no table of its own.
 */
export const TRANSFER_TTL_MS = 15 * 60 * 1000;
const KIND = "AppTransfer";

interface TransferPayload {
  readonly accountId: string;
  readonly fromSector: string;
  readonly toClientId: string;
  readonly kind: TransferRoute["kind"];
  readonly financialYear: string;
  readonly bundleSha256: string;
  readonly lineCount: number;
  /** Epoch seconds of the person's Send; the assertion's `iat`. */
  readonly approvedAt?: number;
}

export interface AppTransfer extends TransferPayload {
  readonly id: string;
  readonly expiresAt: Date;
}

export type CreateTransferResult =
  | { readonly ok: true; readonly transferId: string; readonly expiresAt: Date }
  | { readonly ok: false; readonly error: "no_route" | "unknown_subject" };

export type MintResult =
  | { readonly ok: true; readonly assertion: string; readonly expiresAt: Date }
  | { readonly ok: false; readonly error: "not_found" | "not_approved" | "not_allowed" };

export interface TransferStore {
  create(input: {
    sector: string;
    fromSub: string;
    to: OperatedApp;
    financialYear: string;
    bundleSha256: string;
    lineCount: number;
    now: Date;
  }): Promise<CreateTransferResult>;
  /** A live transfer from this sector, else null. */
  find(input: { sector: string; transferId: string; now: Date }): Promise<AppTransfer | null>;
  /** The send screen's checks (docs/30 §5, `/connect`), for the signed-in person. */
  check(input: {
    transfer: AppTransfer;
    userId: string;
    now: Date;
  }): Promise<TransferProblem | null>;
  /** The person's Send. Keeps the first approval, so the assertion stays the same. */
  approve(input: { transferId: string; userId: string; now: Date }): Promise<boolean>;
  assertion(input: {
    client: MachineClient;
    transferId: string;
    fromSub: string;
    now: Date;
  }): Promise<MintResult>;
}

export interface TransferDeps {
  readonly pool: Pool;
  readonly store: Pick<OidcStore, "findAccount" | "findSubject" | "findAppConsent">;
  readonly clients: readonly YourTalClient[];
  /** This environment's routes (`transferRoutesFor`). */
  readonly routes: readonly TransferRoute[];
  readonly sign: TransferSigner;
  /** The destination's client secret as the provider holds it. */
  readonly secretOf: (clientId: string) => Promise<string | undefined>;
}

type Evaluation =
  | { readonly ok: true; readonly account: OidcAccount; readonly sub: string }
  | { readonly ok: false; readonly problem: TransferProblem };

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

export function createPgTransfers(deps: TransferDeps): TransferStore {
  const { pool, store } = deps;

  async function userOfSub(sector: string, sub: string): Promise<string | null> {
    const result = await pool.query<{ user_id: string }>(
      "SELECT user_id FROM oidc.subject WHERE sector = $1 AND sub = $2",
      [sector, sub],
    );
    return result.rows[0]?.user_id ?? null;
  }

  async function find(sector: string, transferId: string, now: Date): Promise<AppTransfer | null> {
    const result = await pool.query<{ payload: TransferPayload; expires_at: Date }>(
      `SELECT payload, expires_at FROM oidc.model
        WHERE kind = $1 AND id = $2 AND expires_at > $3 AND payload->>'fromSector' = $4`,
      [KIND, transferId, now, sector],
    );
    const row = result.rows[0];
    return row === undefined ? null : { ...row.payload, id: transferId, expiresAt: row.expires_at };
  }

  async function evaluate(transfer: AppTransfer, userId: string, now: Date): Promise<Evaluation> {
    if (transfer.accountId !== userId) return { ok: false, problem: "wrong_account" };
    const route = deps.routes.find(
      (one) => one.fromSector === transfer.fromSector && one.toClientId === transfer.toClientId,
    );
    const to = clientById(deps.clients, transfer.toClientId);
    if (route === undefined || to === undefined || !isSignInClient(to)) {
      return { ok: false, problem: "expired" };
    }
    const account = await store.findAccount(userId);
    if (
      account === null ||
      !(await signInBlock(account, to, NO_TEEN_INVITES, undefined, now)).ok ||
      ageBandOf(account, now) !== "adult" ||
      !route.regions.includes(account.region)
    ) {
      return { ok: false, problem: "not_allowed" };
    }
    const consent = await store.findAppConsent(userId, to.sector);
    const sub = await store.findSubject(to.sector, userId);
    if (consent === null || consent.endedAt !== null || sub === null) {
      return { ok: false, problem: "not_connected" };
    }
    return { ok: true, account, sub };
  }

  return {
    async create({ sector, fromSub, to, financialYear, bundleSha256, lineCount, now }) {
      const route = deps.routes.find((one) => one.fromSector === sector && one.to === to);
      if (route === undefined) return { ok: false, error: "no_route" };
      const accountId = await userOfSub(sector, fromSub);
      if (accountId === null) return { ok: false, error: "unknown_subject" };
      const transferId = randomUUID();
      const expiresAt = new Date(now.getTime() + TRANSFER_TTL_MS);
      const payload: TransferPayload = {
        accountId,
        fromSector: sector,
        toClientId: route.toClientId,
        kind: route.kind,
        financialYear,
        bundleSha256,
        lineCount,
      };
      await pool.query(
        "INSERT INTO oidc.model (kind, id, payload, expires_at) VALUES ($1, $2, $3, $4)",
        [KIND, transferId, payload, expiresAt],
      );
      return { ok: true, transferId, expiresAt };
    },

    find: ({ sector, transferId, now }) => find(sector, transferId, now),

    async check({ transfer, userId, now }) {
      const result = await evaluate(transfer, userId, now);
      return result.ok ? null : result.problem;
    },

    async approve({ transferId, userId, now }) {
      const result = await pool.query(
        `UPDATE oidc.model
            SET payload = payload || jsonb_build_object(
                  'approvedAt', COALESCE(payload->'approvedAt', to_jsonb($3::bigint)))
          WHERE kind = $1 AND id = $2 AND payload->>'accountId' = $4 AND expires_at > $5`,
        [KIND, transferId, seconds(now), userId, now],
      );
      return result.rowCount === 1;
    },

    async assertion({ client, transferId, fromSub, now }) {
      const transfer = await find(client.sector, transferId, now);
      if (transfer === null || (await userOfSub(client.sector, fromSub)) !== transfer.accountId) {
        return { ok: false, error: "not_found" };
      }
      // Before the person's Send, say nothing about whether they use the destination.
      if (transfer.approvedAt === undefined) return { ok: false, error: "not_approved" };
      const result = await evaluate(transfer, transfer.accountId, now);
      if (!result.ok) {
        return { ok: false, error: result.problem === "expired" ? "not_found" : "not_allowed" };
      }
      const secret = await deps.secretOf(transfer.toClientId);
      if (secret === undefined) throw new Error(`oidc: no secret for ${transfer.toClientId}`);
      const assertion = await deps.sign(
        {
          aud: transfer.toClientId,
          azp: client.clientId,
          sub: result.sub,
          jti: transfer.id,
          iat: transfer.approvedAt,
          exp: seconds(transfer.expiresAt),
          region: result.account.region,
          age_band: "adult",
          kind: transfer.kind,
          source: client.app,
          financial_year: transfer.financialYear,
          bundle_sha256: transfer.bundleSha256,
        },
        secret,
      );
      return { ok: true, assertion, expiresAt: transfer.expiresAt };
    },
  };
}
