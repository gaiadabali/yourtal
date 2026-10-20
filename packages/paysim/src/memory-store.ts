import type {
  ClaimedDelivery,
  Delivery,
  DeliveryResult,
  IdempotencyRecord,
  PaySimStore,
  PaySimTx,
  StoredObject,
} from "./store";

interface State {
  objects: Map<string, StoredObject>;
  idempotency: Map<string, IdempotencyRecord>;
  deliveries: Map<string, Delivery>;
}

const idemKey = (scope: string, key: string): string => `${scope}\u0000${key}`;

/** In-memory store. One transaction at a time, rolled back on throw. */
export function createMemoryPaySimStore(): PaySimStore {
  let state: State = {
    objects: new Map(),
    idempotency: new Map(),
    deliveries: new Map(),
  };
  let tail: Promise<unknown> = Promise.resolve();

  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  }

  const tx: PaySimTx = {
    get(id) {
      const o = state.objects.get(id);
      return Promise.resolve(o === undefined ? undefined : structuredClone(o));
    },
    put(obj) {
      state.objects.set(obj.id, structuredClone(obj));
      return Promise.resolve();
    },
    getIdempotency(scope, key, notBefore) {
      const rec = state.idempotency.get(idemKey(scope, key));
      const live = rec !== undefined && rec.createdAt >= notBefore;
      return Promise.resolve(live ? structuredClone(rec) : undefined);
    },
    putIdempotency(rec) {
      state.idempotency.set(idemKey(rec.scope, rec.key), structuredClone(rec));
      return Promise.resolve();
    },
    enqueueDelivery(d) {
      state.deliveries.set(d.id, {
        id: d.id,
        eventId: d.eventId,
        attempts: 0,
        nextAttemptAt: d.nextAttemptAt,
        status: "pending",
        lastStatusCode: null,
        lastError: null,
      });
      return Promise.resolve();
    },
    claimDueObjects(now, limit) {
      const due = [...state.objects.values()]
        .filter((o) => o.dueAt !== null && o.dueAt <= now)
        .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))
        .slice(0, limit);
      return Promise.resolve(structuredClone(due));
    },
  };

  return {
    transaction(fn) {
      return exclusive(async () => {
        const snapshot = structuredClone(state);
        try {
          return await fn(tx);
        } catch (error) {
          state = snapshot;
          throw error;
        }
      });
    },
    claimDeliveries(now, limit, leaseMs) {
      return exclusive(() => {
        const out: ClaimedDelivery[] = [];
        const due = [...state.deliveries.values()]
          .filter((d) => d.status === "pending" && d.nextAttemptAt <= now)
          .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())
          .slice(0, limit);
        for (const d of due) {
          const event = state.objects.get(d.eventId);
          if (event === undefined) continue;
          d.nextAttemptAt = new Date(now.getTime() + leaseMs);
          out.push({
            ...structuredClone(d),
            event: structuredClone(event.data),
            eventCreatedAt: new Date(Number(event.data["created"]) * 1000),
          });
        }
        return Promise.resolve(out);
      });
    },
    recordDelivery(id, result: DeliveryResult) {
      return exclusive(() => {
        const d = state.deliveries.get(id);
        if (d !== undefined) Object.assign(d, result);
        return Promise.resolve();
      });
    },
    listObjects(type) {
      const all = [...state.objects.values()].filter((o) => type === undefined || o.type === type);
      return Promise.resolve(structuredClone(all));
    },
    listDeliveries() {
      return Promise.resolve(structuredClone([...state.deliveries.values()]));
    },
  };
}
