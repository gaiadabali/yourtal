import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { envSchema } from "./env.schema";

/**
 * A drift test for the duplicate docs/13 says every unavoidable one needs.
 *
 * `PDP_BASE_URL`'s default here, the port `docker-compose.yml` maps Cerbos
 * to, and `.env.example`'s value are three copies of one fact, not one. They
 * had already drifted once — this schema defaulted to Cerbos's own port
 * (`3592`) while compose and `.env.example` agreed on `26592`, the mapped
 * host port — which meant a bare `pnpm dev` or `pnpm test` with no `.env`
 * pointed at a port nothing binds locally. Caught while wiring YT-0527's
 * live-PDP boot check, not by any test, because nothing compared the three.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("PDP_BASE_URL's default agrees with docker-compose and .env.example", () => {
  // `DATABASE_URL` is required since YT-0552, so the schema can no longer
  // be parsed from nothing. Supplied here only so the PDP default can be
  // read — this suite is about three copies of the Cerbos port, not about
  // the database.
  const schemaDefault = envSchema.parse({
    DATABASE_URL: "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
    CHECKPOINT_TOKEN_SECRET: "test-only-checkpoint-signing-key-not-a-real-secret",
  }).PDP_BASE_URL;

  it("matches the host port docker-compose.yml maps Cerbos to", () => {
    const compose = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8");
    // `"127.0.0.1:26592:3592"` under the cerbos service.
    const mapped = /cerbos:[\s\S]*?ports:\s*\n\s*-\s*"127\.0\.0\.1:(\d+):3592"/.exec(compose);
    expect(
      mapped,
      "could not find the cerbos service's port mapping in docker-compose.yml",
    ).not.toBeNull();
    expect(schemaDefault).toBe(`http://127.0.0.1:${mapped?.[1] ?? ""}`);
  });

  it("matches .env.example", () => {
    const envExample = readFileSync(path.join(repoRoot, ".env.example"), "utf8");
    const line = /^PDP_BASE_URL=(.+)$/m.exec(envExample);
    expect(line, "could not find PDP_BASE_URL in .env.example").not.toBeNull();
    expect(schemaDefault).toBe(line?.[1]?.trim());
  });
});

/**
 * The same drift, for the same reason, for `REDIS_URL` (YT-0540). Unlike
 * `PDP_BASE_URL` this one has never disagreed with the other two copies —
 * but it had never been compared either, and "has not drifted yet" is not
 * a property a schema default can claim on its own behalf.
 */
describe("REDIS_URL's default agrees with docker-compose and .env.example", () => {
  const schemaDefault = envSchema.parse({
    DATABASE_URL: "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
    CHECKPOINT_TOKEN_SECRET: "test-only-checkpoint-signing-key-not-a-real-secret",
  }).REDIS_URL;

  it("matches the host port docker-compose.yml maps Valkey to", () => {
    const compose = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8");
    // `"127.0.0.1:26379:6379"` under the redis service.
    const mapped = /redis:[\s\S]*?ports:\s*\n\s*-\s*"127\.0\.0\.1:(\d+):6379"/.exec(compose);
    expect(
      mapped,
      "could not find the redis service's port mapping in docker-compose.yml",
    ).not.toBeNull();
    expect(schemaDefault).toBe(`redis://127.0.0.1:${mapped?.[1] ?? ""}`);
  });

  it("matches .env.example", () => {
    const envExample = readFileSync(path.join(repoRoot, ".env.example"), "utf8");
    const line = /^REDIS_URL=(.+)$/m.exec(envExample);
    expect(line, "could not find REDIS_URL in .env.example").not.toBeNull();
    expect(schemaDefault).toBe(line?.[1]?.trim());
  });
});
