import { idempotencyRecordId } from "./key";
import { idempotencyRecordSchema } from "./record";
import type { IdempotencyRecord } from "./record";
import type { IdempotencyStore } from "./store";

/**
 * An in-memory `IdempotencyStore`, for tests and for local development
 * before YT-0022 provisions Postgres.
 *
 * **Not usable in production, and not for the obvious reason.** It is not
 * that the data is lost on restart — it is that this store is per-process.
 * Two instances behind a load balancer each have their own map, so a retry
 * that lands on the other instance finds nothing and executes the operation
 * a second time. An idempotency store that is not shared is not an
 * idempotency store; it is a cache that happens to deduplicate sometimes.
 *
 * JavaScript's single-threaded execution makes `putIfAbsent` atomic here for
 * free — there is no `await` between the read and the write. A real
 * implementation must earn that atomicity from the database
 * (`INSERT ... ON CONFLICT DO NOTHING RETURNING`).
 */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  putIfAbsent(record: IdempotencyRecord): Promise<IdempotencyRecord | undefined> {
    const validated = idempotencyRecordSchema.parse(record);
    const id = idempotencyRecordId(validated.scope, validated.key);

    const existing = this.records.get(id);
    // An expired record is an absent record: the key is free to reuse, and
    // reporting "in progress" from a row that died days ago would wedge a
    // legitimate retry until someone noticed.
    if (existing !== undefined && !hasExpired(existing, new Date(validated.startedAt))) {
      return Promise.resolve(existing);
    }

    this.records.set(id, validated);
    return Promise.resolve(undefined);
  }

  complete(scope: string, key: string, response: { status: number; body: string }): Promise<void> {
    const id = idempotencyRecordId(scope, key);
    const existing = this.records.get(id);
    if (existing === undefined) {
      // Completing a record nobody claimed means the caller's begin/complete
      // pairing is broken. Failing loudly beats writing a record whose
      // fingerprint nothing ever checked.
      throw new Error(`cannot complete an idempotency record that does not exist: ${key}`);
    }

    this.records.set(
      id,
      idempotencyRecordSchema.parse({ ...existing, state: "completed", response }),
    );
    return Promise.resolve();
  }

  abandon(scope: string, key: string): Promise<void> {
    this.records.delete(idempotencyRecordId(scope, key));
    return Promise.resolve();
  }

  prune(now: Date): Promise<number> {
    let removed = 0;
    for (const [id, record] of this.records) {
      if (hasExpired(record, now)) {
        this.records.delete(id);
        removed += 1;
      }
    }
    return Promise.resolve(removed);
  }

  /** Test helper. Not part of `IdempotencyStore`. */
  get size(): number {
    return this.records.size;
  }
}

function hasExpired(record: IdempotencyRecord, now: Date): boolean {
  return new Date(record.expiresAt).getTime() <= now.getTime();
}
