import { sql } from "drizzle-orm";
import type { Currency } from "@yourtal/contracts/money/currency";
import { toMinorUnits, toPoints } from "@yourtal/contracts/money";
import type { Region } from "@yourtal/contracts/region";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type { NewSaga, SagaPatch, SagaRepository, SagaState, StoredSaga } from "./saga.repository";

interface SagaRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  listing_id: string;
  region: Region;
  currency: Currency;
  quote_id: string;
  price_points: string | number;
  settlement_minor: string | number;
  state: SagaState;
  voucher_id: string | null;
  quote_expires_at: string | Date;
  reserved_until: string | Date | null;
}

const COLUMNS = sql`id::text, user_id::text, listing_id::text, region, currency, quote_id::text,
  price_points, settlement_minor, state, voucher_id::text, quote_expires_at, reserved_until`;

export class PostgresSagaRepository implements SagaRepository {
  constructor(private readonly db: AppDb) {}

  async create(saga: NewSaga): Promise<StoredSaga> {
    return this.one(sql`
      INSERT INTO checkout.saga (id, user_id, listing_id, region, currency, quote_id, price_points,
                                 settlement_minor, quote_expires_at)
      VALUES (${saga.id}::uuid, ${saga.userId}::uuid, ${saga.listingId}::uuid, ${saga.region},
              ${saga.currency}, ${saga.quoteId}::uuid, ${saga.pricePoints}, ${saga.settlementMinor},
              ${saga.quoteExpiresAt.toISOString()})
      RETURNING ${COLUMNS}`);
  }

  async findByQuote(quoteId: string, userId: string): Promise<StoredSaga | null> {
    return this.maybe(sql`SELECT ${COLUMNS} FROM checkout.saga
      WHERE quote_id = ${quoteId}::uuid AND user_id = ${userId}::uuid`);
  }

  async findById(id: string): Promise<StoredSaga | null> {
    return this.maybe(sql`SELECT ${COLUMNS} FROM checkout.saga WHERE id = ${id}::uuid`);
  }

  async findByVoucher(voucherId: string, userId: string): Promise<StoredSaga | null> {
    return this.maybe(sql`SELECT ${COLUMNS} FROM checkout.saga
      WHERE voucher_id = ${voucherId}::uuid AND user_id = ${userId}::uuid`);
  }

  async advance(id: string, from: SagaState, to: SagaState, patch: SagaPatch): Promise<StoredSaga> {
    const moved = await this.maybe(sql`
      UPDATE checkout.saga
         SET state = ${to}, updated_at = now(),
             voucher_id = COALESCE(${patch.voucherId ?? null}::uuid, voucher_id),
             reserved_until = COALESCE(${patch.reservedUntil?.toISOString() ?? null}::timestamptz, reserved_until)
       WHERE id = ${id}::uuid AND state = ${from}
      RETURNING ${COLUMNS}`);
    if (moved !== null) return moved;
    const now = await this.findById(id);
    if (now === null) throw new Error(`checkout saga ${id} disappeared`);
    return now;
  }

  async listUnfinished(now: Date, limit: number): Promise<readonly StoredSaga[]> {
    const result = await this.db.execute<SagaRow>(sql`
      SELECT ${COLUMNS} FROM checkout.saga
       WHERE (state = 'reserved' AND reserved_until < ${now.toISOString()}::timestamptz) OR state = 'burned'
       ORDER BY reserved_until LIMIT ${limit}`);
    return result.rows.map(toSaga);
  }

  private async maybe(query: ReturnType<typeof sql>): Promise<StoredSaga | null> {
    const row = (await this.db.execute<SagaRow>(query)).rows[0];
    return row === undefined ? null : toSaga(row);
  }

  private async one(query: ReturnType<typeof sql>): Promise<StoredSaga> {
    const saga = await this.maybe(query);
    if (saga === null) throw new Error("expected a checkout saga row");
    return saga;
  }
}

function toSaga(row: SagaRow): StoredSaga {
  return {
    id: row.id,
    userId: row.user_id,
    listingId: row.listing_id,
    region: row.region,
    currency: row.currency,
    quoteId: row.quote_id,
    pricePoints: toPoints(Number(row.price_points)),
    settlementMinor: toMinorUnits(Number(row.settlement_minor)),
    state: row.state,
    voucherId: row.voucher_id,
    quoteExpiresAt: new Date(row.quote_expires_at),
    reservedUntil: row.reserved_until === null ? null : new Date(row.reserved_until),
  };
}
