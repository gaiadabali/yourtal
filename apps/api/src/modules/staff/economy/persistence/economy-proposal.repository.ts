import type { Pool } from "pg";
import type { EconomyProposal, EconomyProposalKind } from "@yourtal/contracts/staff/economy";
import type { Region } from "@yourtal/contracts/region";

export const ECONOMY_PROPOSAL_REPOSITORY = Symbol("ECONOMY_PROPOSAL_REPOSITORY");

export interface NewEconomyProposal {
  readonly kind: EconomyProposalKind;
  readonly region: Region;
  readonly summary: string;
  readonly payload: Record<string, unknown>;
  readonly proposedBy: string;
  readonly reason?: string | undefined;
}

export interface EconomyProposalRow {
  readonly id: string;
  readonly kind: EconomyProposalKind;
  readonly region: Region;
  readonly summary: string;
  readonly payload: Record<string, unknown>;
  readonly result: Record<string, unknown> | null;
  readonly proposedBy: string;
  readonly approvedBy: string | null;
  readonly status: "pending" | "approved" | "rejected";
  readonly reason: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

/**
 * `staff.economy_proposal` (migration 20260928000000): the read model for
 * "what is awaiting a second approver" across 9.5's four two-person flows.
 * See that migration's own header for why this table exists alongside
 * `ledger-internal`'s own propose/approve rows rather than instead of them.
 */
export interface EconomyProposalRepository {
  create(input: NewEconomyProposal): Promise<EconomyProposalRow>;
  findById(id: string): Promise<EconomyProposalRow | null>;
  listPending(region: Region, kind?: EconomyProposalKind): Promise<readonly EconomyProposalRow[]>;
  listAll(region: Region, kind: EconomyProposalKind): Promise<readonly EconomyProposalRow[]>;
  /** Approves and stamps the ledger's own result, in one row -- same "decided once" shape as `region_setting`. */
  approve(
    id: string,
    approvedBy: string,
    result: Record<string, unknown>,
    note?: string,
  ): Promise<EconomyProposalRow>;
  reject(id: string, decidedBy: string, note?: string): Promise<EconomyProposalRow>;
}

interface Row {
  id: string;
  kind: string;
  region: string;
  summary: string;
  payload: unknown;
  result: unknown;
  proposed_by: string;
  approved_by: string | null;
  status: string;
  reason: string | null;
  created_at: string;
  decided_at: string | null;
}

function toRow(row: Row): EconomyProposalRow {
  return {
    id: row.id,
    kind: row.kind as EconomyProposalKind,
    region: row.region as Region,
    summary: row.summary,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    result: row.result === null ? null : (row.result as Record<string, unknown>),
    proposedBy: row.proposed_by,
    approvedBy: row.approved_by,
    status: row.status as EconomyProposalRow["status"],
    reason: row.reason,
    createdAt: new Date(row.created_at).toISOString(),
    decidedAt: row.decided_at === null ? null : new Date(row.decided_at).toISOString(),
  };
}

export function toEconomyProposal(row: EconomyProposalRow): EconomyProposal {
  return {
    id: row.id,
    kind: row.kind,
    region: row.region,
    summary: row.summary,
    proposedBy: row.proposedBy,
    approvedBy: row.approvedBy,
    status: row.status,
    reason: row.reason,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

export class PostgresEconomyProposalRepository implements EconomyProposalRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: NewEconomyProposal): Promise<EconomyProposalRow> {
    const result = await this.pool.query<Row>(
      `INSERT INTO staff.economy_proposal (kind, region, summary, payload, proposed_by, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.kind,
        input.region,
        input.summary,
        JSON.stringify(input.payload),
        input.proposedBy,
        input.reason ?? null,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("economy_proposal insert returned no row");
    return toRow(row);
  }

  async findById(id: string): Promise<EconomyProposalRow | null> {
    const result = await this.pool.query<Row>(
      `SELECT * FROM staff.economy_proposal WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row === undefined ? null : toRow(row);
  }

  async listPending(
    region: Region,
    kind?: EconomyProposalKind,
  ): Promise<readonly EconomyProposalRow[]> {
    const result = kind
      ? await this.pool.query<Row>(
          `SELECT * FROM staff.economy_proposal
            WHERE region = $1 AND kind = $2 AND status = 'pending'
            ORDER BY created_at DESC`,
          [region, kind],
        )
      : await this.pool.query<Row>(
          `SELECT * FROM staff.economy_proposal
            WHERE region = $1 AND status = 'pending'
            ORDER BY created_at DESC`,
          [region],
        );
    return result.rows.map(toRow);
  }

  async listAll(region: Region, kind: EconomyProposalKind): Promise<readonly EconomyProposalRow[]> {
    const result = await this.pool.query<Row>(
      `SELECT * FROM staff.economy_proposal
        WHERE region = $1 AND kind = $2
        ORDER BY created_at DESC
        LIMIT 100`,
      [region, kind],
    );
    return result.rows.map(toRow);
  }

  async approve(
    id: string,
    approvedBy: string,
    result: Record<string, unknown>,
    note?: string,
  ): Promise<EconomyProposalRow> {
    const query = await this.pool.query<Row>(
      `UPDATE staff.economy_proposal
          SET approved_by = $2, status = 'approved', result = $3, decided_at = now(),
              decision_note = COALESCE($4, decision_note)
        WHERE id = $1 AND status = 'pending'
        RETURNING *`,
      [id, approvedBy, JSON.stringify(result), note ?? null],
    );
    const row = query.rows[0];
    if (row === undefined) throw new Error(`no pending economy_proposal ${id} exists`);
    return toRow(row);
  }

  async reject(id: string, decidedBy: string, note?: string): Promise<EconomyProposalRow> {
    // No dedicated `rejected_by` column (a rejection needs no two-person
    // CHECK the way an approval does): who decided is folded into the note.
    const decisionNote = `rejected by ${decidedBy}${note ? `: ${note}` : ""}`;
    const query = await this.pool.query<Row>(
      `UPDATE staff.economy_proposal
          SET status = 'rejected', decided_at = now(), decision_note = $2,
              approved_by = NULL
        WHERE id = $1 AND status = 'pending'
        RETURNING *`,
      [id, decisionNote],
    );
    const row = query.rows[0];
    if (row === undefined) throw new Error(`no pending economy_proposal ${id} exists`);
    return toRow(row);
  }
}
