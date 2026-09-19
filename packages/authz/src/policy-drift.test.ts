import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { businessRoleSchema, principalRoleSchema } from "./roles";
import { principalAttrSchema } from "./principal";
import { RESOURCE_ACTIONS, RESOURCE_KINDS } from "./resources";

/**
 * The seam between TypeScript and the policy repo, asserted in both
 * directions.
 *
 * Without this, drift is silent and one-sided in the worst way: an action
 * added here but not to a policy is permanently DENY, which looks like a
 * broken feature; an action added to a policy but not here is a rule nobody
 * can reach, which looks like coverage. Both are the kind of bug that is
 * found in production by a merchant who cannot redeem a voucher.
 *
 * These tests read the actual YAML. They do not re-encode it.
 */

const policiesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../policies");

interface ResourcePolicyFile {
  resourcePolicy?: {
    resource?: string;
    rules?: { actions?: string[]; roles?: string[]; derivedRoles?: string[] }[];
  };
}

function readResourcePolicies(): Map<string, ResourcePolicyFile["resourcePolicy"]> {
  const dir = path.join(policiesDir, "resource_policies");
  const policies = new Map<string, NonNullable<ResourcePolicyFile["resourcePolicy"]>>();
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".yaml"))) {
    const parsed = parse(readFileSync(path.join(dir, file), "utf8")) as ResourcePolicyFile;
    const policy = parsed.resourcePolicy;
    if (policy?.resource === undefined) {
      throw new Error(`${file} is not a resource policy`);
    }
    policies.set(policy.resource, policy);
  }
  return policies;
}

/** Every action named by any rule, wildcards excluded. */
function actionsIn(policy: NonNullable<ResourcePolicyFile["resourcePolicy"]>): Set<string> {
  const actions = new Set<string>();
  for (const rule of policy.rules ?? []) {
    for (const action of rule.actions ?? []) {
      if (action !== "*") actions.add(action);
    }
  }
  return actions;
}

const policies = readResourcePolicies();

describe("resource kinds", () => {
  it("the TypeScript registry and the policy repo cover the same kinds", () => {
    expect([...policies.keys()].sort()).toEqual([...RESOURCE_KINDS].sort());
  });

  it.each([...RESOURCE_KINDS])("%s defines the same actions on both sides", (kind) => {
    const policy = policies.get(kind);
    expect(policy, `no resource policy for kind "${kind}"`).toBeDefined();

    const inPolicy = [...actionsIn(policy!)].sort();
    const inTypeScript = [...RESOURCE_ACTIONS[kind]].sort();

    // An action in TS with no rule is permanently DENY; an action in the
    // policy with no TS entry is a rule no caller can reach.
    expect(inPolicy).toEqual(inTypeScript);
  });
});

describe("roles", () => {
  const rolesUsedInPolicies = new Set<string>();
  for (const policy of policies.values()) {
    for (const rule of policy?.rules ?? []) {
      for (const role of rule.roles ?? []) {
        if (role !== "*") rolesUsedInPolicies.add(role);
      }
    }
  }

  it("every role named in a policy exists in the TypeScript enum", () => {
    const known = new Set<string>(principalRoleSchema.options);
    expect([...rolesUsedInPolicies].filter((role) => !known.has(role))).toEqual([]);
  });

  it("the business role list matches the principal JSON Schema exactly", () => {
    const schema = JSON.parse(
      readFileSync(path.join(policiesDir, "_schemas/principal.json"), "utf8"),
    ) as {
      properties: {
        businessRoles: { additionalProperties: { enum: string[] } };
        jurisdiction: { enum: string[] };
      };
    };

    expect(schema.properties.businessRoles.additionalProperties.enum).toEqual([
      ...businessRoleSchema.options,
    ]);
    expect(schema.properties.jurisdiction.enum).toEqual(["ID", "AU"]);
  });

  it("the principal attributes match the principal JSON Schema exactly", () => {
    const schema = JSON.parse(
      readFileSync(path.join(policiesDir, "_schemas/principal.json"), "utf8"),
    ) as { properties: Record<string, unknown> };

    // Both sides are strict, so an attribute known to only one of them is a
    // request the PDP will reject or a field policies can never read.
    expect(Object.keys(schema.properties).sort()).toEqual(
      Object.keys(principalAttrSchema.shape).sort(),
    );
  });
});

describe("the admin boundary", () => {
  it("admin appears in exactly one resource policy", () => {
    // docs/17 section 5: "Admin: role grants, feature flags, kill switches --
    // no direct data access." That holds only while this stays true. If a
    // future change grants admin something for convenience, this test is the
    // thing that says no. policies/tests/admin_boundary_test.yaml asserts the
    // same boundary from the PDP's side.
    const kindsGrantingAdmin = [...policies.entries()]
      .filter(([, policy]) =>
        (policy?.rules ?? []).some((rule) => (rule.roles ?? []).includes("admin")),
      )
      .map(([kind]) => kind);

    expect(kindsGrantingAdmin).toEqual(["platform_setting"]);
  });
});
