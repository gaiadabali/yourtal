import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { objectShapeKeys } from "../openapi/build-document";
import { campaignSchema } from "../campaign/campaign";
import { listingSchema } from "../listing/listing";
import { merchantLocationSchema } from "../listing/merchant-location";
import { voucherSchema } from "../voucher/voucher";

/**
 * The contracts ↔ migrations drift gate.
 *
 * ## Why it lives in `packages/contracts` and not in `packages/db`
 *
 * A contract landing without its migration has now cost two streams their
 * verification. YT-0502 added `locations` to `listingSchema`; the table did
 * not follow, and `packages/db` silently dropped from 23 tests to 10. The
 * same shape hit `apps/web` when a contract landed ahead of it.
 *
 * Both times the schema change was *fine in the package that made it* and
 * broke somewhere else, hours later, in someone else's feature. So the check
 * belongs here: this suite runs in the package where the change is made, and
 * fails in the same command that made it. `packages/db` already depends on
 * `@yourtal/contracts`, so putting it there would reproduce exactly the
 * delay it exists to remove. Reading the sibling package's `.sql` files from
 * disk creates no package dependency — the same trick `openapi.test.ts` uses
 * to compare against a checked-in document.
 *
 * ## It replays the migrations rather than reading the final CREATE TABLE
 *
 * `store.listings` is declared with `district text NOT NULL` in migration
 * 0004 and loses it to `DROP COLUMN` in 0009. A gate that read only
 * `CREATE TABLE` would insist on a column that has not existed for two
 * migrations, and one that read only the live database would need Postgres —
 * which would put it back in the slow, far-away place. So `ADD COLUMN` and
 * `DROP COLUMN` are applied in filename order, which is the order Atlas
 * applies them in.
 *
 * ## Every exception is written down with a reason
 *
 * A field with no column, or a column with no field, is often correct — a
 * relation lives in a join table, a denormalised object is stored by its id.
 * What is never correct is *nobody noticing*. So both directions are checked
 * and each exemption needs a sentence, in the same spirit as
 * `openapi.test.ts`'s `NOT_PUBLISHED`.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../../../db/migrations");

/** Column names per `schema.table`, after replaying every migration. */
function replayMigrations(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();

  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = stripComments(readFileSync(path.join(migrationsDir, file), "utf8"));

    for (const match of sql.matchAll(/CREATE TABLE\s+([\w.]+)\s*\(/gi)) {
      const name = match[1];
      const open = match.index + match[0].length - 1;
      if (name === undefined) continue;
      tables.set(name.toLowerCase(), new Set(columnsInBody(balancedBody(sql, open))));
    }

    for (const match of sql.matchAll(/ALTER TABLE\s+([\w.]+)([\s\S]*?);/gi)) {
      const name = match[1]?.toLowerCase();
      const body = match[2];
      if (name === undefined || body === undefined) continue;
      const columns = tables.get(name);
      if (columns === undefined) continue;

      for (const added of body.matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?(\w+)/gi)) {
        if (added[1] !== undefined) columns.add(added[1].toLowerCase());
      }
      for (const dropped of body.matchAll(/DROP COLUMN\s+(?:IF EXISTS\s+)?(\w+)/gi)) {
        if (dropped[1] !== undefined) columns.delete(dropped[1].toLowerCase());
      }
    }
  }

  return tables;
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/** The text between a `(` and its matching `)`. */
function balancedBody(sql: string, openIndex: number): string {
  let depth = 0;
  for (let index = openIndex; index < sql.length; index += 1) {
    const character = sql[index];
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) return sql.slice(openIndex + 1, index);
    }
  }
  throw new Error("Unbalanced parentheses in a migration's CREATE TABLE");
}

/** Table-level constraints are not columns, however they are written. */
const NOT_A_COLUMN = new Set([
  "constraint",
  "primary",
  "unique",
  "foreign",
  "check",
  "exclude",
  "like",
]);

function columnsInBody(body: string): string[] {
  const columns: string[] = [];
  let depth = 0;
  let current = "";

  const flush = (): void => {
    const first = current.trim().split(/\s+/)[0]?.toLowerCase();
    if (first !== undefined && first.length > 0 && !NOT_A_COLUMN.has(first)) {
      columns.push(first);
    }
    current = "";
  };

  for (const character of body) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      flush();
      continue;
    }
    current += character;
  }
  flush();
  return columns;
}

function snakeCase(field: string): string {
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

interface Mapping {
  readonly name: string;
  readonly schema: unknown;
  readonly table: string;
  /** Contract fields with no column of their own, and why that is correct. */
  readonly fieldsWithNoColumn: Readonly<Record<string, string>>;
  /**
   * Contract fields that SHOULD have storage and do not.
   *
   * Kept separate from `fieldsWithNoColumn` on purpose. Both let the gate go
   * green, but one says "this is by design" and the other says "this is a
   * known gap with a ticket", and collapsing them into one list is how the
   * second quietly becomes the first. The list is asserted below, so adding
   * a gap is a deliberate edit to this file rather than a passing build.
   */
  readonly fieldsAwaitingStorage: Readonly<Record<string, string>>;
  /** Columns no contract field produces, and why. */
  readonly columnsWithNoField: Readonly<Record<string, string>>;
}

const MAPPINGS: readonly Mapping[] = [
  {
    name: "listingSchema",
    schema: listingSchema,
    table: "store.listings",
    fieldsAwaitingStorage: {},
    fieldsWithNoColumn: {
      locations:
        "A relation, not a column. Stored as store.merchant_location rows joined through store.listing_location (YT-0502), so that a voucher's branch can be constrained to one its listing actually offers.",
    },
    columnsWithNoField: {},
  },
  {
    name: "voucherSchema",
    schema: voucherSchema,
    table: "voucher.vouchers",
    fieldsAwaitingStorage: {},
    fieldsWithNoColumn: {
      location:
        "Denormalised by id. The voucher carries the whole merchantLocation object so it stays honourable offline (docs/17 §3), but the table stores location_id and relies on the composite foreign key to store.listing_location.",
    },
    columnsWithNoField: {
      location_id: "Holds the `location` field's id. See the note on that field.",
    },
  },
  {
    name: "campaignSchema",
    schema: campaignSchema,
    table: "campaign.campaigns",
    fieldsWithNoColumn: {},
    fieldsAwaitingStorage: {
      chapters:
        "NO STORAGE ANYWHERE. campaignSchema gained chapters and campaign.campaigns did not follow, so a chapter exists only in the mock generators and could not survive a round trip through Postgres. Found by this gate on its first run, which is what it is for.",
      videoSource:
        "NO STORAGE ANYWHERE. Same landing as `chapters`. A campaign read back from the database has no video to play.",
    },
    columnsWithNoField: {},
  },
  {
    name: "merchantLocationSchema",
    schema: merchantLocationSchema,
    table: "store.merchant_location",
    fieldsWithNoColumn: {},
    fieldsAwaitingStorage: {},
    columnsWithNoField: {
      created_at:
        "An audit timestamp with a database default. Deliberately not on the contract: nothing in the product reads it, and putting it on the schema would oblige every caller constructing a location to invent one.",
      merchant_id:
        "The owning merchant. Not on merchantLocationSchema because a location is always read through its listing, which already names the merchant; the column exists so a branch cannot be re-parented by editing a listing.",
    },
  },
];

const TABLES = replayMigrations();

describe("the migrations parser", () => {
  // If the parser silently returned nothing, every drift test below would
  // pass by comparing two empty sets — the failure mode this whole file
  // exists to stop, reproduced inside the check itself.
  it("found the catalogue tables", () => {
    for (const mapping of MAPPINGS) {
      expect(TABLES.get(mapping.table)?.size ?? 0).toBeGreaterThan(3);
    }
  });

  it("applied DROP COLUMN, not just CREATE TABLE", () => {
    // `store.listings.district` is created in 0004 and dropped in 0009.
    // If this fails, the parser is reading declarations rather than state.
    expect(TABLES.get("store.listings")?.has("district")).toBe(false);
    expect(TABLES.get("store.merchant_location")?.has("district")).toBe(true);
  });

  it("applied ADD COLUMN", () => {
    expect(TABLES.get("voucher.vouchers")?.has("location_id")).toBe(true);
  });
});

describe.each(MAPPINGS)("$name against $table", (mapping) => {
  const fields = objectShapeKeys(mapping.schema);
  const columns = TABLES.get(mapping.table);

  it("has a column for every contract field", () => {
    expect(fields, `${mapping.name} is not an object schema`).toBeDefined();
    expect(columns, `${mapping.table} is not in the migrations`).toBeDefined();

    const unstored = (fields ?? [])
      .filter((field) => mapping.fieldsWithNoColumn[field] === undefined)
      .filter((field) => mapping.fieldsAwaitingStorage[field] === undefined)
      .filter((field) => columns?.has(snakeCase(field)) !== true);

    // A contract field with nowhere to be stored. Add the column in
    // packages/db/migrations, or record why it has none in this file's
    // `fieldsWithNoColumn` — the exemption needs a sentence, not a pass.
    expect(unstored).toStrictEqual([]);
  });

  it("has a contract field for every column", () => {
    const produced = new Set((fields ?? []).map(snakeCase));
    const orphans = [...(columns ?? [])]
      .filter((column) => !produced.has(column))
      .filter((column) => mapping.columnsWithNoField[column] === undefined);

    // A column nothing in the contract writes. Usually a field that was
    // renamed or removed and left its storage behind.
    expect(orphans).toStrictEqual([]);
  });
});

/**
 * The gaps, enumerated. Not a failure — a ledger.
 *
 * `pnpm verify` stays green with these outstanding, which is the only way a
 * gate like this can be adopted at all: one that went red on every existing
 * gap would be turned off the day it landed. What it must not do is let a
 * gap become invisible, so the exact set is pinned here. A new one fails
 * this test until somebody writes it down, and closing one fails it until
 * somebody removes the line.
 */
describe("known storage gaps", () => {
  it("are exactly the ones on record", () => {
    const gaps = MAPPINGS.flatMap((mapping) =>
      Object.keys(mapping.fieldsAwaitingStorage).map((field) => `${mapping.name}.${field}`),
    ).sort();

    expect(gaps).toStrictEqual(["campaignSchema.chapters", "campaignSchema.videoSource"]);
  });
});
