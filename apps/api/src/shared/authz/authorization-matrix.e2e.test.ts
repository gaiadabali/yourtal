import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 13.3.c: every role against every authorized route, in both regions, against
 * the real Cerbos policies. Each route's (kind, action) is read from its
 * @Authorize; each role signs in as an AU and an ID principal and asks about a
 * resource of that kind in AU and in ID. The whole allow-matrix is committed as
 * a snapshot, so any change to who may do what shows in review, and the red
 * lines below hold for every cell:
 * - no non-staff principal is allowed anything on another region's resource;
 * - admin is allowed nothing but platform settings (no data access, docs/17 §5);
 * - a signed-out visitor may only sign up, sign in or reset a password, browse
 *   and open-view campaigns, and browse auctions;
 * - a viewer (user) never buys points or touches the economy (red line 4).
 */
const apiSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(apiSrc, "../../..");
const PDP = process.env["PDP_BASE_URL"] ?? "http://127.0.0.1:26592";
const REGIONS = ["AU", "ID"] as const;
const STAFF = ["support", "moderator", "risk_analyst", "finance", "ops", "admin"] as const;
const ROLES = ["anonymous", "user", "business_user", "store_device", ...STAFF] as const;
type Role = (typeof ROLES)[number];

function controllerFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return controllerFiles(full);
    return entry.name.endsWith(".controller.ts") ? [full] : [];
  });
}

/** Every (kind, action) any route authorizes with. */
function authorizedActions(): Map<string, Set<string>> {
  const byKind = new Map<string, Set<string>>();
  const pattern = /@Authorize\(\{\s*kind:\s*"([a-z_]+)",\s*action:\s*"([a-z_]+)"/g;
  for (const file of controllerFiles(apiSrc)) {
    const source = readFileSync(file, "utf8").replace(/\s+/g, " ");
    for (const match of source.matchAll(pattern)) {
      const [, kind, action] = match;
      if (kind === undefined || action === undefined) continue;
      if (!byKind.has(kind)) byKind.set(kind, new Set());
      byKind.get(kind)?.add(action);
    }
  }
  return byKind;
}

interface JsonSchema {
  readonly properties?: Record<string, { type?: string | string[]; enum?: unknown[] }>;
}

const BUSINESS = "matrix-business";

/** Attributes of an ordinary, live resource, so a cell is decided by role and region, not by a draft state. */
const LIVE_ATTRS: Readonly<Record<string, Record<string, unknown>>> = {
  campaign: { state: "live", moderationState: "approved" },
  campaign_view: {
    state: "live",
    audience: "all_ages",
    openViewingEnabled: true,
    openViewingBudgetRemaining: 10,
  },
  charity: { state: "approved" },
  listing: { approvalState: "approved", audience: "all_ages" },
  team: { targetRole: "marketer" },
};

/** Actions on a regional kind that name no one resource: the list is walled in its query instead. */
const REGIONLESS_ACTIONS = new Set(["campaign_view.browse", "charity.list_mine"]);

/** A schema-valid resource of `kind` in `region`, owned by `ownerId` where ownership applies. */
function resourceAttr(kind: string, region: string, ownerId: string): Record<string, unknown> {
  const schema = JSON.parse(
    readFileSync(path.join(repoRoot, "policies/_schemas/resource", `${kind}.json`), "utf8"),
  ) as JsonSchema;
  const attr: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(schema.properties ?? {})) {
    const type = Array.isArray(prop.type) ? prop.type.find((t) => t !== "null") : prop.type;
    if (name === "region") attr[name] = region;
    else if (name === "businessId") attr[name] = BUSINESS;
    else if (name === "ownerId" || name === "sellerId") attr[name] = ownerId;
    else if (prop.enum !== undefined) attr[name] = prop.enum[0];
    else if (type === "boolean") attr[name] = false;
    else if (type === "number" || type === "integer") attr[name] = 0;
    else if (type === "array") attr[name] = [];
    else if (type === "string") attr[name] = `matrix-${name}`;
  }
  return { ...attr, ...LIVE_ATTRS[kind] };
}

/** Kinds whose resources carry a region (the rest are the caller's own, or platform-wide). */
function regional(kind: string): boolean {
  const schema = JSON.parse(
    readFileSync(path.join(repoRoot, "policies/_schemas/resource", `${kind}.json`), "utf8"),
  ) as JsonSchema;
  return schema.properties?.["region"] !== undefined;
}

function principal(role: Role, region: string) {
  const id = `matrix-${role}-${region}`;
  return {
    id,
    // Each role on its own, so a cell shows what that role grants (a business
    // user is always a user too; staff are tested without their own viewer role).
    roles: role === "business_user" ? ["user", "business_user"] : [role],
    attr: {
      jurisdiction: region,
      isSuspended: false,
      ageBand: "adult",
      businessRoles: role === "business_user" ? { [BUSINESS]: "owner" } : {},
      ...(role === "store_device"
        ? { deviceBusinessId: BUSINESS, deviceLocationId: "matrix-location" }
        : {}),
    },
  };
}

type Matrix = Record<string, Record<string, string[]>>;

async function allowMatrix(): Promise<Matrix> {
  const actions = authorizedActions();
  const matrix: Matrix = {};
  for (const role of ROLES) {
    for (const region of REGIONS) {
      const who = principal(role, region);
      const resources = [...actions.entries()].flatMap(([kind, acts]) =>
        REGIONS.map((resourceRegion) => ({
          actions: [...acts].sort(),
          resource: {
            kind,
            id: `${kind}-${resourceRegion}`,
            attr: resourceAttr(kind, resourceRegion, who.id),
          },
        })),
      );
      const response = await fetch(`${PDP}/api/check/resources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: `matrix-${role}-${region}`, principal: who, resources }),
      });
      const text = await response.text();
      expect(response.ok, text).toBe(true);
      const body = JSON.parse(text) as {
        results: {
          resource: { id: string };
          actions: Record<string, string>;
          validationErrors?: unknown[];
        }[];
      };
      const cell: Record<string, string[]> = {};
      for (const result of body.results) {
        expect(result.validationErrors ?? [], `${role}/${region} ${result.resource.id}`).toEqual(
          [],
        );
        cell[result.resource.id] = Object.entries(result.actions)
          .filter(([, effect]) => effect === "EFFECT_ALLOW")
          .map(([action]) => action)
          .sort();
      }
      matrix[`${role}@${region}`] = cell;
    }
  }
  return matrix;
}

describe("the authorization matrix", () => {
  it("holds the red lines in every cell, and matches the reviewed snapshot", async () => {
    const matrix = await allowMatrix();
    const allowed = (role: Role, region: string) =>
      Object.entries(matrix[`${role}@${region}`] ?? {}).filter(([, acts]) => acts.length > 0);

    for (const region of REGIONS) {
      const other = region === "AU" ? "ID" : "AU";
      for (const role of ["user", "business_user", "store_device"] as const) {
        const crossRegion = allowed(role, region)
          .filter(([id]) => id.endsWith(`-${other}`) && regional(id.slice(0, -`-${other}`.length)))
          .map(([id, acts]): [string, string[]] => [
            id,
            acts.filter((a) => !REGIONLESS_ACTIONS.has(`${id.split("-")[0] ?? ""}.${a}`)),
          ])
          .filter(([, acts]) => acts.length > 0);
        expect(crossRegion, `${role}@${region} across the region wall`).toEqual([]);
      }
      for (const [id] of allowed("admin", region)) {
        expect(
          id.startsWith("platform_setting-") || id.startsWith("staff_console-"),
          `admin: ${id}`,
        ).toBe(true);
      }
      for (const [id] of allowed("anonymous", region)) {
        expect(
          ["session-", "campaign_view-", "auction-"].some((prefix) => id.startsWith(prefix)),
          `anonymous: ${id}`,
        ).toBe(true);
      }
      const viewer = Object.fromEntries(allowed("user", region));
      for (const kind of ["billing", "ledger_adjustment", "platform_setting", "voucher_batch"]) {
        for (const r of REGIONS) {
          expect(viewer[`${kind}-${r}`] ?? [], `user@${region} on ${kind}-${r}`).toEqual([]);
        }
      }
    }

    await expect(JSON.stringify(matrix, null, 2) + "\n").toMatchFileSnapshot(
      "./__snapshots__/authorization-matrix.json",
    );
  }, 60_000);
});
