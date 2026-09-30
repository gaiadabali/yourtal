import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool, PoolClient } from "pg";
import type { Region } from "@yourtal/contracts/region";

/**
 * The region a request is walled to in Postgres (13.5.e, F89). The row-level
 * security policies read `yourtal.region`; every connection checked out while
 * a scope is active sets it, and every other checkout clears it, so a pooled
 * connection never carries one request's region into the next.
 */
export const regionScope = new AsyncLocalStorage<{ readonly region: Region }>();

const SET_REGION = "SELECT set_config('yourtal.region', $1, false)";

type ConnectCallback = (
  err: Error | undefined,
  client: PoolClient | undefined,
  done: (release?: unknown) => void,
) => void;

/** Wraps `pool.connect`, which `pool.query` also goes through. */
export function regionScopedPool<T extends Pool>(pool: T): T {
  const connect = pool.connect.bind(pool) as (cb?: ConnectCallback) => Promise<PoolClient> | void;
  const patched = (callback?: ConnectCallback): Promise<PoolClient> | void => {
    // Read at call time, not when a client frees up: a waiting checkout must
    // not take the region of whichever request released the client.
    const region = regionScope.getStore()?.region ?? "";
    if (callback === undefined) {
      return (connect() as Promise<PoolClient>).then(async (client) => {
        try {
          await client.query(SET_REGION, [region]);
        } catch (error) {
          client.release(error instanceof Error ? error : true);
          throw error;
        }
        return client;
      });
    }
    connect((err, client, done) => {
      if (err || !client) {
        callback(err, client, done);
        return;
      }
      client.query(SET_REGION, [region]).then(
        () => {
          callback(undefined, client, done);
        },
        (error: unknown) => {
          done(error);
          callback(error instanceof Error ? error : new Error(String(error)), undefined, () => {});
        },
      );
    });
  };
  (pool as unknown as { connect: typeof patched }).connect = patched;
  return pool;
}

const STAFF_ROLES: ReadonlySet<string> = new Set([
  "support",
  "moderator",
  "risk_analyst",
  "finance",
  "ops",
  "admin",
]);
const REQUEST_REGION = Symbol("yt:region-scope");

interface ScopedPrincipal {
  readonly roles: readonly string[];
  readonly attr: { readonly jurisdiction?: Region };
}

/**
 * Called by PdpGuard once a request is allowed. Anonymous callers carry only a
 * placeholder jurisdiction, and staff work across regions by design (their
 * queues take a region filter), so neither is walled here; Cerbos still is.
 */
export function markRequestRegion(request: object, principal: ScopedPrincipal): void {
  const region = principal.attr.jurisdiction;
  if (region === undefined || principal.roles.includes("anonymous")) return;
  if (principal.roles.some((role) => STAFF_ROLES.has(role))) return;
  Reflect.set(request, REQUEST_REGION, region);
}

export function requestRegion(request: object): Region | undefined {
  const region: unknown = Reflect.get(request, REQUEST_REGION);
  return region === "AU" || region === "ID" ? region : undefined;
}
