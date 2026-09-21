import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id, per this ticket's first criterion. `@node-rs/argon2` rather than
 * the `argon2` package on npm: it ships prebuilt native bindings for every
 * platform this repo runs on (this machine included — verified before this
 * file was written), where `argon2` needs a native toolchain at install
 * time. Both wrap the same reference implementation.
 *
 * The library's defaults are already Argon2id with OWASP-recommended cost
 * parameters (19 MiB memory, 2 iterations, 1 degree of parallelism as of
 * this version) — not overridden here, so a future upgrade of the library
 * that raises its own defaults raises ours too, rather than this file
 * pinning today's numbers forever.
 *
 * The encoded output is a single self-describing string — algorithm,
 * version, parameters, salt and hash all in one — which is exactly what
 * `identity.credential.secret_hash` stores. There is no separate salt
 * column because there is nothing to put in it that this string does not
 * already carry.
 */

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext);
}

/**
 * Verifies a plaintext against an Argon2id hash. Never throws on a
 * mismatch — a wrong password is an expected outcome, not an exceptional
 * one, so callers get a boolean rather than a try/catch.
 */
export async function verifyPassword(encodedHash: string, plaintext: string): Promise<boolean> {
  try {
    return await verify(encodedHash, plaintext);
  } catch {
    // A malformed hash (never produced by `hashPassword`, but a defensive
    // boundary against a corrupted row) is a mismatch, not a crash — the
    // caller's question is "does this prove the password", and a string
    // that cannot even be parsed as a hash cannot prove it.
    return false;
  }
}
