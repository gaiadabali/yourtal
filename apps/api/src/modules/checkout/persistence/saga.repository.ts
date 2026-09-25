import type { Region } from "@yourtal/contracts/region";
import type { Currency } from "@yourtal/contracts/money/currency";
import type { MinorUnits, Points } from "@yourtal/contracts/money";

export type SagaState = "quoted" | "reserved" | "burned" | "done" | "released" | "voided";

export interface StoredSaga {
  readonly id: string;
  readonly userId: string;
  readonly listingId: string;
  readonly region: Region;
  readonly currency: Currency;
  readonly quoteId: string;
  readonly pricePoints: Points;
  readonly settlementMinor: MinorUnits;
  readonly state: SagaState;
  readonly voucherId: string | null;
  readonly quoteExpiresAt: Date;
  readonly reservedUntil: Date | null;
}

export type NewSaga = Omit<StoredSaga, "state" | "voucherId" | "reservedUntil">;

export interface SagaPatch {
  readonly voucherId?: string;
  readonly reservedUntil?: Date;
}

/** `checkout.saga`. Every state change is a compare-and-set on the old state. */
export interface SagaRepository {
  create(saga: NewSaga): Promise<StoredSaga>;
  findByQuote(quoteId: string, userId: string): Promise<StoredSaga | null>;
  findById(id: string): Promise<StoredSaga | null>;
  /** Moves `from` → `to`; if another process moved it first, returns the row as it now is. */
  advance(id: string, from: SagaState, to: SagaState, patch: SagaPatch): Promise<StoredSaga>;
  /** Sagas left `reserved` past their reservation, or `burned` and not yet done. */
  listUnfinished(now: Date, limit: number): Promise<readonly StoredSaga[]>;
}

export const SAGA_REPOSITORY = Symbol("SAGA_REPOSITORY");
