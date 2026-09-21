import { abandon, begin, complete } from "@yourtal/idempotency/idempotency";
import type { IdempotencyStore } from "@yourtal/idempotency/store";
import type { Job } from "pg-boss";
import { canonicalJson } from "./canonical-json";

/** 24 hours. Long enough to cover a producer's own retry window for the
 * enqueue call, and long enough that a duplicate enqueue arriving well
 * after the original job completed is still caught as a replay rather than
 * executed again. Callers with a different duplicate-arrival window (the
 * same kind of per-endpoint decision `@yourtal/idempotency`'s
 * `REDEMPTION_RETENTION_MS`/`LATE_ARRIVAL_INTERVAL_MS` document) should pass
 * their own `retentionMs`. */
export const DEFAULT_JOB_IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * `canonicalJson(undefined)` is `JSON.stringify(undefined)`, which is the
 * JS value `undefined`, not the string `"undefined"` — and
 * `platform.idempotency.body` is NOT NULL once a record is completed (the
 * `idempotency_completed_has_response` CHECK). A void handler (the common
 * case: most job handlers return nothing) must not send that through as
 * the stored "response". Written as a plain `unknown -> unknown` function
 * rather than inline against the generic `Result` type so the comparison
 * to `undefined` is checked against `unknown`, not against an
 * unconstrained type parameter.
 */
function toStoredResult(result: unknown): unknown {
  return result === undefined ? null : result;
}

/**
 * Every job this repo processes carries its own dedupe key. YT-0040 AC2.
 *
 * Not optional, and there is no default: a job with no key is a job nothing
 * can tell apart from a duplicate of itself, which is the exact failure
 * mode this wrapper exists to close.
 */
export interface IdempotentJobData {
  readonly idempotencyKey: string;
}

/**
 * Wraps a pg-boss job handler so the same logical unit of work cannot run
 * twice, no matter how many job ROWS carry it. YT-0040 AC2.
 *
 * ## What this defends against, and what it does not
 *
 * pg-boss already guarantees that a single job ROW is never picked up by
 * two workers at once (`FOR UPDATE SKIP LOCKED` under the fetch), and that
 * its own retries of that SAME row are sequential, never concurrent. That
 * is real, but it is a promise about ROWS, not about the BUSINESS EVENT a
 * row represents. A producer that retries an enqueue call after a timeout
 * — exactly the moment producers retry, same as for an HTTP request — can
 * create a SECOND row for the same event, and pg-boss will schedule and run
 * both, each holding its own row lock, entirely correctly by its own rules.
 * Two workers really can be running the same business operation at once.
 * That is the race this wrapper closes, by resting on
 * `@yourtal/idempotency`'s `putIfAbsent`, not by reimplementing it — see
 * the package's own doc comment for why a get-then-put cannot be made safe.
 *
 * ## The scoping decision
 *
 * `@yourtal/idempotency/key` scopes an HTTP key to the authenticated
 * principal, because an HTTP caller is untrusted: unscoped, an attacker who
 * can guess a key can pre-poison it, and two tenants could collide on the
 * same string. Neither threat is the one a job consumer faces — jobs are
 * enqueued by this repo's own trusted server code, not by a network caller,
 * so there is no attacker choosing a key to poison. What the same
 * `IdempotencyStore` still needs is a namespace: two unrelated queues could
 * legitimately reuse the same dedupe key string (an order id used as a key
 * in a "notify" queue and, separately, in a "settle" queue), and without a
 * distinct scope one queue's completed record would tell the other queue's
 * job "someone already ran that key" and skip real work.
 *
 * So the scope here is the QUEUE NAME, prefixed to keep this table's job
 * rows out of the same namespace as HTTP endpoints sharing the store
 * (`platform.idempotency` is genuinely shared — `docs/10` line 226): scope
 * `job:<queueName>`, key `data.idempotencyKey`. That is the equivalent
 * scoping decision for a consumer that has no authenticated principal to
 * scope to — the boundary that matters here is "which queue", not "which
 * caller".
 *
 * ## Handler failure releases the claim, deliberately
 *
 * On a thrown error, this calls `abandon()` rather than `complete()`. If it
 * completed the claim, pg-boss's OWN retry of the identical job row — the
 * mechanism the retry/backoff criterion is about — would come back to
 * `begin()` and find its own prior attempt sitting there, forever telling
 * it `in_progress`. `abandon` releases the key so the next legitimate
 * attempt (the retry OR a duplicate row racing in) goes through `begin()`
 * fresh. The two failure shapes this collapses are: a genuine transient
 * failure (the point of pg-boss retrying at all) and a duplicate ROW that
 * lost the race and should not have run the handler in the first place —
 * the loser case is handled below, before the handler is ever called, so
 * `abandon` on the failure path only ever releases a claim the winner held.
 */
export interface IdempotentWorkerOptions {
  readonly store: IdempotencyStore;
  readonly queueName: string;
  readonly retentionMs?: number;
  readonly now?: () => Date;
}

/**
 * The core logic, independent of pg-boss's own handler shape — a plain
 * `data in, result out` function, which is what makes it straightforward to
 * call twice concurrently in a test without a real pg-boss delivery in the
 * loop. `idempotentWorker` below is the thin adapter that gives pg-boss's
 * `work()` the batch-array shape it actually calls handlers with.
 */
export function idempotentJobHandler<Data extends IdempotentJobData, Result = void>(
  options: IdempotentWorkerOptions,
  handler: (data: Data) => Promise<Result>,
): (data: Data) => Promise<Result | undefined> {
  const scope = `job:${options.queueName}`;
  const retentionMs = options.retentionMs ?? DEFAULT_JOB_IDEMPOTENCY_RETENTION_MS;
  const now = options.now ?? (() => new Date());

  return async (data: Data): Promise<Result | undefined> => {
    if (typeof data.idempotencyKey !== "string" || data.idempotencyKey.length === 0) {
      // A job without a key is not "idempotent by default" — it is a
      // producer bug. Failing loudly here, before the handler runs, is what
      // makes the guarantee "by construction" rather than "by convention":
      // there is no path through this wrapper that executes a handler
      // without first having claimed a key.
      throw new Error(
        `idempotentWorker: job on queue "${options.queueName}" has no idempotencyKey`,
      );
    }

    const outcome = await begin(options.store, {
      scope,
      key: data.idempotencyKey,
      method: "JOB",
      path: options.queueName,
      rawBody: canonicalJson(data),
      startedAt: now(),
      retentionMs,
    });

    switch (outcome.kind) {
      case "fingerprint_mismatch":
        // Same key, different payload — the producer reused a dedupe key
        // for two different logical jobs. Not something to silently run OR
        // silently skip: surfacing it as a thrown error sends this job
        // through the normal retry/dead-letter path, where it is visible
        // rather than quietly dropped.
        throw new Error(
          `idempotentWorker: key "${data.idempotencyKey}" on queue "${options.queueName}" was reused for a different job payload`,
        );
      case "in_progress":
      case "replay":
        // Either this exact key is already being worked (a duplicate row
        // racing the winner) or it already finished (a duplicate that
        // arrived late). Either way the business effect has already
        // happened once, or is about to — running the handler again would
        // be the double-execution this wrapper exists to prevent. This job
        // ROW still completes successfully; it simply does no work.
        return undefined;
      case "proceed":
        break;
      default: {
        const unreachable: never = outcome;
        throw new Error(`idempotentWorker: unhandled outcome ${String(unreachable)}`);
      }
    }

    try {
      const result = await handler(data);
      await complete(options.store, scope, data.idempotencyKey, {
        status: 200,
        body: canonicalJson(toStoredResult(result)),
      });
      return result;
    } catch (error) {
      await abandon(options.store, scope, data.idempotencyKey);
      throw error;
    }
  };
}

/**
 * Adapts `idempotentJobHandler` to the shape `PgBoss#work` actually calls a
 * handler with — an array of jobs, even at the default `batchSize: 1`
 * (`WorkHandler<ReqData, ResData>` in pg-boss's own types).
 *
 * `batchSize` above 1 is out of scope for this skeleton: claiming an
 * idempotency key per job in a batch, one at a time, inside a single pg-boss
 * batch completion is a real design (partial-batch failure needs its own
 * answer) and not one this ticket needs to make. Pass `batchSize: 1` (the
 * default — do not override it) when calling `boss.work(name, options,
 * idempotentWorker(...))`; this throws rather than silently processing only
 * `jobs[0]` if that default is ever changed out from under it.
 */
export function idempotentWorker<Data extends IdempotentJobData, Result = void>(
  options: IdempotentWorkerOptions,
  handler: (data: Data) => Promise<Result>,
): (jobs: Job<Data>[]) => Promise<Result | undefined> {
  const perJob = idempotentJobHandler(options, handler);

  return async (jobs: Job<Data>[]): Promise<Result | undefined> => {
    const [job] = jobs;
    if (jobs.length !== 1 || job === undefined) {
      throw new Error(
        `idempotentWorker: expected batchSize 1 on queue "${options.queueName}", got ${String(jobs.length)} jobs — pass { batchSize: 1 } explicitly to boss.work()`,
      );
    }
    return perJob(job.data);
  };
}
