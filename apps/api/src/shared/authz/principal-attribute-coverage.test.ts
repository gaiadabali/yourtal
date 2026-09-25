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
    serviceSecret: "test-only-ledger-service-secret-not-real",
  },
  teenAccounts: false,
};

const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
const FROZEN_USER = "coverage-check-frozen-user";

/**
 * Every attribute key that a real call to `AsyncPrincipalResolver.resolve()` can produce,
 * across the inputs known to reach every optional-attribute branch that
 * exists today. Adding a new branch that sets a new key makes this set
 * bigger automatically; nothing here needs editing when that happens.
 */
async function populatableAttributes(): Promise<Set<string>> {
  const repo: PrincipalSecurityStateRepository = {
    findByUserId: (userId) =>
      Promise.resolve(
        userId === FROZEN_USER ? { valueFrozenUntil: new Date("2099-01-01T00:00:00.000Z") } : null,
      ),
  };
  // No profile/membership/staff-role rows in this suite (1.5.b): every
  // scenario below is header-driven, matching how the OTHER five optional
  // attributes here are already proved. async-principal-resolver.test.ts is
  // where the database overlay itself is exercised.
  const resolver = new AsyncPrincipalResolver(
    new PrincipalService(CONFIG),
    repo,
    {
      create: () => Promise.reject(new Error("unused")),
      findByUserId: () => Promise.resolve(null),
      update: () => Promise.reject(new Error("unused")),
      deleteByUserId: () => Promise.reject(new Error("unused")),
    },
    { listForUser: () => Promise.resolve([]) },
    { listForUser: () => Promise.resolve([]) },
  );

  const scenarios: FastifyRequest[] = [
    requestWith({}),
    requestWith({ "x-yt-user-id": "plain-user" }),
    requestWith({
      "x-yt-user-id": "owner-1",
      "x-yt-business-roles": JSON.stringify({ [BUSINESS_ID]: "owner" }),
    }),
    requestWith({ "x-yt-user-id": "suspended-user", "x-yt-suspended": "true" }),
    requestWith({ "x-yt-user-id": FROZEN_USER }),
  ];

  const keys = new Set<string>();
  for (const request of scenarios) {
    const principal = await resolver.resolve(request);
    for (const key of Object.keys(principal.attr)) {
      keys.add(key);
    }
  }
  return keys;
}

/**
 * Named, justified gaps only — never a bare exemption. Each entry is an
 * attribute this codebase genuinely cannot populate yet, and why, so the
 * reason is reviewable in a diff rather than implicit in a passing test.
 */
const KNOWN_UNPRODUCIBLE_ATTRIBUTES: Readonly<Record<string, string>> = {
  reauthenticatedAt:
    "Step-up re-auth timestamp (team.yaml's ownership-transfer-needs-fresh-reauth rule, docs/14 section 5). Pending the auth work in YT-0540/0541 — there is no session or re-auth event for PrincipalService to read yet.",
  hasPasskey:
    "Passkey registration state (wallet.yaml's high-value-redemption-needs-a-passkey rule, docs/14 section 5). Same pending-auth-work gap as reauthenticatedAt — whether a user has a passkey is an identity-provider fact, not something a header should assert.",
  goodwillCreditCeilingIdr:
    "Economy-owned (YT-0050) — the founder holds this ceiling (user_account.yaml). Populating it here would repeat the invented-number mistake YT-0576 flagged for a different figure.",
  deviceBusinessId:
    "derived_roles/business.yaml's store_device_of role reads this. 1.5.c adds StoreDevicePrincipalResolver and the DeviceCredentialVerifier port it calls, but the only binding today (NoDeviceCredentialVerifier) refuses every credential — there is no real device-credential store until 8.1.b, so resolve() always throws rather than ever returning a populated attr. This test's own populatableAttributes() only drives AsyncPrincipalResolver (the header-based user path), which is a second, independent reason this key stays here regardless.",
};

describe("principal attribute coverage — YT-0582 criterion 3", () => {
  it("every P.attr.* referenced in policies/** is populatable or a named, justified gap", async () => {
    const referenced = policyAttributeReferences();
    const populatable = await populatableAttributes();

    const uncovered = [...referenced.keys()]
      .filter((attr) => !populatable.has(attr))
      .filter((attr) => KNOWN_UNPRODUCIBLE_ATTRIBUTES[attr] === undefined)
      .sort();

    // An attribute a policy reads that NOTHING in this codebase can set.
    // Either make the resolver produce it, or add a named, justified entry
    // to KNOWN_UNPRODUCIBLE_ATTRIBUTES above — never a silent skip. The
    // failure message names exactly which attribute and, via
    // policyAttributeReferences(), where every reference to it lives.
    const locations = uncovered
      .map((attr) => `${attr}: ${(referenced.get(attr) ?? []).join(", ")}`)
      .join("\n");
    expect(
      uncovered,
      `unpopulatable attribute(s) referenced by policy:\n${locations}`,
    ).toStrictEqual([]);
  });

  it("KNOWN_UNPRODUCIBLE_ATTRIBUTES carries no stale entry", async () => {
    const referenced = policyAttributeReferences();
    const populatable = await populatableAttributes();

    const stale = Object.keys(KNOWN_UNPRODUCIBLE_ATTRIBUTES).filter(
      (attr) => !referenced.has(attr) || populatable.has(attr),
    );

    // Either the attribute is now populatable and the entry should be
    // removed, or nothing references it any more and the entry is dead —
    // both mean the written reason no longer describes anything real.
    expect(stale).toStrictEqual([]);
  });

  it("valueFrozenUntil specifically is populatable — the bug this ticket fixes", async () => {
    const populatable = await populatableAttributes();
    expect(populatable.has("valueFrozenUntil")).toBe(true);
  });

  it("the parser found real references, not an empty policy directory", () => {
    // If replayMigrations()-style parsing here silently returned nothing,
    // every check above would pass by comparing two empty sets — the exact
    // failure mode this file exists to prevent, reproduced inside itself.
    const referenced = policyAttributeReferences();
    expect(referenced.size).toBeGreaterThan(3);
    expect(referenced.has("isSuspended")).toBe(true);
    expect(referenced.has("valueFrozenUntil")).toBe(true);
  });
});
