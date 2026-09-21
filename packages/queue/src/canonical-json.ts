/**
 * A deterministic `JSON.stringify`, keys sorted recursively. YT-0040.
 *
 * `@yourtal/idempotency`'s HTTP fingerprint hashes the raw request bytes
 * verbatim, on purpose (`fingerprint.ts`: "hashing the raw bytes avoids
 * needing a canonical JSON form... the alternative is a notorious source of
 * cross-language disagreement"). That reasoning does not transfer to a job
 * payload: a job's `data` is read back out of `pgboss.job.data`, a `jsonb`
 * column, and Postgres's `jsonb` storage does not preserve either key order
 * or the original number/whitespace formatting — two reads of the exact
 * same row are not guaranteed to serialize back to the same bytes. Hashing
 * "as received" would make the SAME job retry look like a fingerprint
 * mismatch depending on how Postgres happened to store it, which is a worse
 * failure than the byte-fidelity fingerprint.ts is protecting against.
 *
 * So job payloads are canonicalised before hashing instead: object keys
 * sorted at every level, arrays left in order (order is meaningful there).
 * This is intentionally narrower than full JSON canonicalisation (it does
 * not attempt to normalise number formatting) because both the producer and
 * every consumer of a job today are this same process, going through
 * `JSON.stringify`/`JSON.parse` and the `pg` driver's own jsonb codec, which
 * do not introduce that kind of drift on their own.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}
