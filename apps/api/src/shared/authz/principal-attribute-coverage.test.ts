import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FastifyRequest } from "fastify";
import { AsyncPrincipalResolver } from "./async-principal-resolver";
import { PrincipalService } from "./principal.service";
import type { AppConfig } from "../../config/app-config";
import type { PrincipalSecurityStateRepository } from "../../modules/identity/persistence/principal-security-state.repository";

/**
 * YT-0582 criterion 3: a check that fails loudly when a policy references a
 * principal attribute nothing in this codebase can populate. That is what
 * let `valueFrozenUntil` sit unenforced for as long as it did — every layer
 * (the CEL, the schema, the fixtures) agreed with itself, and nothing ever
 * compared the policy repo's expectations against what `PrincipalService`
 * actually produces.
 *
 * ## Why this cannot pass vacuously
 *
 * The set of "populatable" attributes below is not a hand-maintained list —
 * it is the literal union of `Object.keys(principal.attr)` across real
 * calls to `AsyncPrincipalResolver.resolve()` over a battery of inputs
 * chosen to hit every branch that ever sets an optional attribute. Editing
 * a comment or a constant cannot make this test pass; only making the
 * resolver actually emit the key can. The set of "referenced" attributes is
 * parsed independently out of `policies/**\/*.yaml` by regex over `P.attr.*`,
 * the same "replay the source, don't trust a maintained list" shape
 * `schema-drift.test.ts` uses for migrated tables (YT-0555).
 *
 * `KNOWN_UNPRODUCIBLE_ATTRIBUTES` is the one place this test lets a gap
 * through, and it is not a blanket exemption: every entry is a named
 * attribute with a written reason, checked in BOTH directions by the second
 * test below, the same shape `TABLES_WITH_NO_MAPPING` uses. An attribute
 * that is neither populatable nor named here fails the first test, full
 * stop.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const policiesDir = path.resolve(here, "../../../../../policies");
const POLICY_SUBDIRS = ["derived_roles", "resource_policies"];

/** attribute name -> every `dir/file:line` it is referenced from. */
function policyAttributeReferences(): Map<string, string[]> {
  const refs = new Map<string, string[]>();
  for (const subdir of POLICY_SUBDIRS) {
    const dir = path.join(policiesDir, subdir);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue;
      const lines = readFileSync(path.join(dir, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        for (const match of line.matchAll(/P\.attr\.([A-Za-z0-9_]+)/g)) {
          const attr = match[1];
          if (attr === undefined) continue;
          const location = `${subdir}/${file}:${String(index + 1)}`;
          const existing = refs.get(attr);
          if (existing === undefined) {
            refs.set(attr, [location]);
          } else {
            existing.push(location);
          }
        }
      });
    }
  }
  return refs;
}

function requestWith(headers: Record<string, string>): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

const CONFIG: AppConfig = {
  nodeEnv: "test",
  port: 3001,
  pdp: { baseUrl: "http://127.0.0.1:26592", timeoutMs: 500 },
  databaseUrl: "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal",
  redisUrl: "redis://127.0.0.1:26379",
  ledger: {
    mode: "fake" as const,
    baseUrl: "http://127.0.0.1:26312",
    voucherBaseUrl: "http://127.0.0.1:26313",
  },
  teenAccounts: false,
