/**
 * Storage for the simulation. Objects are generic jsonb-style rows by id and
 * type; the API layer knows their shapes. Two implementations: in memory (unit
 * tests, the standalone server) and Postgres (staging).
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export interface StoredObject {
  id: string;
  /** e.g. "customer", "checkout.session", "event". */
  type: string;
  /** Owning connected account (the `Stripe-Account` scope), or null for the platform. */
  account: string | null;
  /** The Stripe object as the API returns it. */
  data: JsonObject;
  /** Never returned: balances, card scenario, link targets. */
  internal: JsonObject;
  /** When the sweep should look at this object next. */
  dueAt: Date | null;
}

export interface IdempotencyRecord {
  scope: string;
  key: string;
  requestHash: string;
  status: number;
  body: string;
  createdAt: Date;
}

export interface Delivery {
  id: string;
  eventId: string;
  attempts: number;
  nextAttemptAt: Date;
  status: "pending" | "delivered" | "failed";
  lastStatusCode: number | null;
  lastError: string | null;
}

export interface ClaimedDelivery extends Delivery {
  event: JsonObject;
  eventCreatedAt: Date;
}

export interface DeliveryResult {
  attempts: number;
  status: "pending" | "delivered" | "failed";
  nextAttemptAt: Date;
  lastStatusCode: number | null;
  lastError: string | null;
}

/** Everything one request does happens inside one of these. */
export interface PaySimTx {
  get(id: string, opts?: { forUpdate?: boolean }): Promise<StoredObject | undefined>;
  put(obj: StoredObject): Promise<void>;
  /**
   * Objects of a type, oldest first (insertion order). `account` narrows to that scope, `null` meaning the
   * platform; leave it out for every scope.
   */
  list(type: string, account?: string | null): Promise<StoredObject[]>;
  /** Serialises requests sharing an idempotency key. */
  getIdempotency(
    scope: string,
    key: string,
    notBefore: Date,
  ): Promise<IdempotencyRecord | undefined>;
  putIdempotency(rec: IdempotencyRecord): Promise<void>;
  enqueueDelivery(d: {
    id: string;
    eventId: string;
    nextAttemptAt: Date;
    now: Date;
  }): Promise<void>;
  /** Objects whose `dueAt` has passed, locked against other processes. */
  claimDueObjects(now: Date, limit: number): Promise<StoredObject[]>;
}

export interface PaySimStore {
  /** Atomic: everything done through `tx` commits together or not at all. */
  transaction<T>(fn: (tx: PaySimTx) => Promise<T>): Promise<T>;
  /**
   * Pending deliveries due now. Each is leased until `now + leaseMs` so another
   * process (or the next tick) does not send it at the same time.
   */
  claimDeliveries(now: Date, limit: number, leaseMs: number): Promise<ClaimedDelivery[]>;
  recordDelivery(id: string, result: DeliveryResult, now: Date): Promise<void>;
  /** For tests and diagnostics. */
  listObjects(type?: string): Promise<StoredObject[]>;
  listDeliveries(): Promise<Delivery[]>;
}
