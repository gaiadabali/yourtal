import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { objectShapeKeys } from "../openapi/build-document";
import { campaignSchema } from "../campaign/campaign";
import { listingSchema } from "../listing/listing";
import { merchantLocationSchema } from "../listing/merchant-location";
import { voucherSchema } from "../voucher/voucher";
import { campaignTermsSchema } from "../campaign/campaign-terms";
import { campaignRewardConfigSchema } from "../campaign/campaign-reward-config";
import { watchSessionSchema } from "../watch/watch-session";
import { businessSchema } from "../business/business";
import { businessMemberSchema } from "../business/business-member";
import { billingContactSchema } from "../business/billing-contact";
import { kybDocumentSchema } from "../business/kyb-document";
import { userProfileSchema } from "../identity/user-profile";

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
      // RENAME COLUMN, added by YT-0513 — and its absence was a hole in this
      // gate rather than an omission in its scope.
      //
      // A rename is the one schema change that leaves the column COUNT
      // unchanged, so every "does each field have a column" assertion below
      // still had the same number of things to compare and simply compared
      // the wrong ones. Replaying only ADD and DROP meant a migration that
      // renamed `face_value_idr` to `face_value_minor` was invisible here:
      // the gate went on asserting against a name the database no longer
      // had, and would have reported drift against the CONTRACT for
      // correctly following the migration.
      //
      // Postgres takes one rename per ALTER statement, so this does not
      // need to handle a list.
      for (const renamed of body.matchAll(
        /RENAME COLUMN\s+(?:IF EXISTS\s+)?(\w+)\s+TO\s+(\w+)/gi,
      )) {
        const from = renamed[1]?.toLowerCase();
        const to = renamed[2]?.toLowerCase();
        if (from === undefined || to === undefined) continue;
        columns.delete(from);
        columns.add(to);
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
    columnsWithNoField: {
      lifecycle_state:
        "MERCHANT-side visibility (active/paused/retired), added by the store module's listing-management migration (20260920040000). Deliberately separate from the customer-facing `status` enum, the same split campaignSchema's lifecycle_state/status makes: a customer never sees a listing that is not active at all, so pausing removes it from the browse/offer-detail query rather than adding a value to the public enum.",
    },
  },
  {
    name: "voucherSchema",
    schema: voucherSchema,
    table: "voucher.vouchers",
    fieldsAwaitingStorage: {},
    fieldsWithNoColumn: {
      location:
        "Denormalised by id. The voucher carries the whole merchantLocation object so it stays honourable offline (docs/17 §3), but the table stores location_id and relies on the composite foreign key to store.listing_location.",
      status:
        "DERIVED, deliberately (YT-0142). The wallet-facing status comes from `state` plus `void_reason` through `publicVoucherStatusOf`. Storing both would be two copies of one fact — the same call YT-0101 made for campaigns — and the stored copy is the one that goes stale.",
      code: "NEVER stored in plaintext (docs/15 rule 7). voucher.code_custody holds a SHA-256 for lookup and an envelope-encrypted copy for display, in a table `yourtal_app` cannot read at all. A voucher is a bearer instrument, so a readable code column means one leaked credential is the whole float; encrypting the column in place would not work either, because `WHERE code = $1` against ciphertext needs deterministic encryption.",
    },
    columnsWithNoField: {
      location_id: "Holds the `location` field's id. See the note on that field.",
      state:
        "The INTERNAL lifecycle — minted, allocated and held have no public form, and `voucherSchema.status` is derived from this. See `voucher-lifecycle.ts`.",
      void_reason:
        "Why a voucher was voided, and an input to the derivation rather than a footnote on it: voided-by-transfer became somebody else's and its value still exists, voided-for-fraud did not, and a wallet must say which.",
      batch_id:
        "The issuance batch (YT-0141), which carries the funding record and the two-person approval. Not on the contract because a holder has no business knowing which batch minted their voucher.",
      version:
        "Optimistic concurrency on state transitions (YT-0142). A storage concern with no meaning to any consumer of the contract.",
    },
  },
  {
    name: "campaignSchema",
    schema: campaignSchema,
    table: "campaign.campaigns",
    fieldsAwaitingStorage: {},
    fieldsWithNoColumn: {
      chapters:
        "A relation, not a column. campaign.chapter, keyed (campaign_id, ordinal), with no end_seconds because a chapter's end IS the next one's start (YT-0101/YT-0548).",
      videoSource:
        "A relation, not a column. campaign.video_source stores `kind` plus per-kind fields behind a CHECK, so the discriminated union stays additive rather than becoming a jsonb convention.",
      status:
        "DERIVED, deliberately. The viewer-facing status comes from `lifecycle_state` through `publicStatusOf` (YT-0101). Storing both would be two copies of one fact, and the copy is what goes stale.",
    },
    columnsWithNoField: {
      lifecycle_state:
        "The AUTHORING state, which no viewer-facing contract carries — draft, in_review and rejected have no public form. `campaignSchema.status` is derived from it.",
      rejection_reason:
        "Console-only, and null unless the campaign is rejected. A viewer is never shown why a campaign they cannot see was refused.",
    },
  },
  {
    name: "campaignTermsSchema",
    schema: campaignTermsSchema,
    table: "campaign.terms_version",
    fieldsAwaitingStorage: {},
    fieldsWithNoColumn: {},
    columnsWithNoField: {},
  },
  {
    name: "campaignRewardConfigSchema",
    schema: campaignRewardConfigSchema,
    table: "campaign.reward_config",
    fieldsAwaitingStorage: {},
    fieldsWithNoColumn: {},
    columnsWithNoField: {},
  },
  {
    name: "watchSessionSchema",
    schema: watchSessionSchema,
    table: "watch.session",
    fieldsAwaitingStorage: {},
    fieldsWithNoColumn: {},
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
  {
    // YT-0555: the business module had a live API surface and zero rows in
    // this table — the drift gate ran, and had nothing to say about it.
    name: "businessSchema",
    schema: businessSchema,
    table: "business.business_accounts",
    fieldsAwaitingStorage: {},
    fieldsWithNoColumn: {},
    columnsWithNoField: {
      created_at:
        "An audit timestamp with a database default, the same convention as merchantLocationSchema's created_at above — nothing in the product reads it and putting it on the schema would oblige every caller constructing a Business to invent one.",
      updated_at:
        "Bumped by the persistence layer on every UPDATE; write-side bookkeeping with no reader on the contract side.",
    },
  },
  {
    name: "businessMemberSchema",
    schema: businessMemberSchema,
    table: "business.business_members",
    fieldsAwaitingStorage: {},
    fieldsWithNoColumn: {},
    columnsWithNoField: {
      id: "A surrogate key with no meaning to any consumer of the contract. A membership is identified by (businessId, userId) — business_members_business_id_user_id_key enforces the fact the contract already assumes: one membership row per person per business.",
    },
  },
  {
    name: "billingContactSchema",
    schema: billingContactSchema,
    table: "business.billing_contacts",
    fieldsAwaitingStorage: {},
    fieldsWithNoColumn: {},
    columnsWithNoField: {},
  },
  {
    name: "kybDocumentSchema",
    schema: kybDocumentSchema,
    table: "business.kyb_documents",
    fieldsAwaitingStorage: {},
    fieldsWithNoColumn: {},
    columnsWithNoField: {},
  },
  {
    name: "userProfileSchema",
    schema: userProfileSchema,
    table: "identity.user_profile",
    fieldsAwaitingStorage: {},
    fieldsWithNoColumn: {
      ageBand:
        "DERIVED, deliberately (1.4.a). Computed from date_of_birth when the profile is read, never stored — the same call campaignSchema.status and voucherSchema.status make for their own derived fields, and for the same reason: a stored age band is a fact that goes stale the day a birthday passes with no write to refresh it.",
    },
    columnsWithNoField: {
      date_of_birth: "Holds the `ageBand` field's source. See the note on that field.",
      guardian_email:
        "Internal only (1.4.b/1.4.f) — never returned to any client. A teen account's guardian has no login of their own yet, so there is nothing this field would even be serialised TO.",
      parent_consent_status:
        "Internal only, same reason as guardian_email — no guardian-facing surface exists yet to show it to.",
      trust_tier:
        'F12: "the tier is never shown to users" — deliberately absent from every public contract, not merely unmapped.',
      suspended_at:
        "Enforced through the PDP's ALLOW/DENY (policies/resource_policies/user_account.yaml), never returned to any client as a field of its own — the same call identity.principal_security_state's freeze makes for itself.",
      created_at: "Audit-only. No contract exposes when an account was created.",
      updated_at: "Audit-only. No contract exposes when a profile was last changed.",
    },
  },
];

/**
 * Every table the migrations create, that is not the `table` of some
 * `MAPPINGS` entry above — with the reason it has none. YT-0555's second
 * criterion: a per-schema opt-in list (`MAPPINGS` itself) silently excludes
 * whatever nobody remembered to add, which is the same failure `MAPPINGS`
 * exists to catch, one level up. So the universe here is not "the schemas
 * someone thought to list" — it is `TABLES`, parsed independently from the
 * migrations themselves — and the two checks below assert every migrated
 * table is accounted for on exactly one side, the same shape YT-0536's
 * `BOUNDARY_NAMES` check applies to the fault-exercise table.
 *
 * A table that is genuinely a relation already documented under a mapped
 * schema's `fieldsWithNoColumn` (e.g. `store.listing_location` under
 * `listingSchema.locations`) says so and points back at that note rather
 * than repeating it. A table with a real, tracked, not-yet-wired contract
 * (e.g. `campaign.chapter`/`campaign.video_source`, and the question-bank
 * tables) says that too, and names the ticket boundary — YT-0555 closes the
 * business gap; it does not open new work in campaign or question-bank.
 */
const TABLES_WITH_NO_MAPPING: Readonly<Record<string, string>> = {
  "ledger.account":
    "Internal ledger primitive (docs/13b, YT-0552/YT-0554). No public contract mirrors a row of this table 1:1 — balanceSchema and walletHistoryEntrySchema are the derived public views, computed from ledger.entry rather than read directly off any one ledger table.",
  "ledger.transfer": "Same ledger-internals note as ledger.account above.",
  "ledger.entry":
    "The append-only ledger fact table asserted by ledger-constraints.test.ts (YT-0554's role-separation fix — yourtal_app is refused INSERT). No public contract mirrors a row of it; see ledger.account's note.",
  "ledger.allocation": "Same ledger-internals note as ledger.account above.",
  "ledger.grant": "Same ledger-internals note as ledger.account above.",
  "ledger.point_purchase": "Same ledger-internals note as ledger.account above.",
  "ledger.backing_rate": "Same ledger-internals note as ledger.account above.",
  "ledger.backing_rate_approval":
    "The two-person-approval append-only twin of ledger.backing_rate (20260925183000_rate_governance.sql) -- same ledger-internals note as ledger.account above: nothing outside the ledger reads an approval row directly.",
  "ledger.daily_proof": "Same ledger-internals note as ledger.account above.",
  "ledger.allocation_hold":
    "EM-08 (4.4.e, 20260925195500_allocation_holds.sql): a reward session's in-flight reservation against its allocation, moved only through the four SECURITY DEFINER verbs. Same ledger-internals note as ledger.account above.",
  "ledger.allocation_return": "Same ledger-internals note as ledger.account above.",
  "ledger.burn":
    "4.3.e (20260925196000_ledger_burns.sql): the exactly-once-per-saga record behind burnForVoucher/getBurn. Same ledger-internals note as ledger.account above.",
  "ledger.burn_reinstatement":
    "K13's exactly-once reinstatement of a burn (same migration). Same ledger-internals note as ledger.account above.",
  "ledger.marketing_funding":
    "K6/EM-02 (4.4.h, 20260925195000_k6_marketing_backing.sql): a two-person funding decision for marketing cash. Same ledger-internals note as ledger.account above -- `yourtal_app` is REVOKEd from it entirely, so there is no path from a read of this table into any response this API could ever serve.",
  "ledger.grant_release":
    "Holdback releases (4.4.g), ledger-internal. The wallet's pending buckets are the public view, computed by the ledger, not a row mirror.",
  "ledger.quote":
    "Stored quotes (4.1.b), ledger-internal. ledger-internal's quoteSchema is what callers see, built by the ledger route, not a row mirror.",
  "ledger.quote_lock": "Same as ledger.quote: an append-only lock record for a stored quote.",
  "ledger.listing_price":
    "The ledger-owned listing price (4.9.a). ledger-internal's priceListingResultSchema is the public view; apps/api reads only listing id and points.",
  // pg-boss's own schema, installed verbatim from its v40 construction plan by
  // 20260921234000_pgboss_schema.sql (YT-0040). These are a VENDOR's internal
  // tables, not this project's: nothing in `packages/contracts` describes them,
  // nothing should, and a public contract mirroring a queue row would couple our
  // API shape to a dependency's migration history. They are mapped here rather
  // than excluded from the scan because this ledger IS the record of that
  // decision -- the gate's whole point is that a schema arriving with no entry
  // anywhere fails the same day, and "it is a vendor's" has to be written down
  // rather than assumed by the next reader.
  //
  // Read through `pgboss.job`/`pgboss.queue` directly for observability
  // (packages/queue/src/observability.ts) rather than through a contract: YT-0027
  // owns graphing it, and a SELECT on a vendor table is honest about what it is.
  "pgboss.job":
    "pg-boss's job table -- vendor-internal, installed by its own v40 construction plan (YT-0040). No public contract mirrors a queue row, and one should not: it would tie our API shape to pg-boss's migration history. Queried directly by packages/queue/src/observability.ts.",
  "pgboss.job_common": "Same pg-boss vendor-schema note as pgboss.job above (YT-0040).",
  "pgboss.job_dependency": "Same pg-boss vendor-schema note as pgboss.job above (YT-0040).",
  "pgboss.queue": "Same pg-boss vendor-schema note as pgboss.job above (YT-0040).",
  "pgboss.queue_stats":
    "Same pg-boss vendor-schema note as pgboss.job above (YT-0040). Unused at runtime -- the client sets persistQueueStats:false, because pg-boss maintains this partition with CREATE TABLE under whichever role calls supervise(), and yourtal_app holds no DDL grant (docs/14 section 8).",
  "pgboss.schedule": "Same pg-boss vendor-schema note as pgboss.job above (YT-0040).",
  "pgboss.subscription": "Same pg-boss vendor-schema note as pgboss.job above (YT-0040).",
  "pgboss.version":
    "Same pg-boss vendor-schema note as pgboss.job above (YT-0040). Holds the single row '40' -- the schema version the migration installs and the pinned pg-boss 12.30.0 client expects. A drift between the two is a real defect, which is why the dependency is pinned exact rather than caret-ranged.",
  "pgboss.warning": "Same pg-boss vendor-schema note as pgboss.job above (YT-0040).",
  "pgboss.bam": "Same pg-boss vendor-schema note as pgboss.job above (YT-0040).",
  "platform.idempotency":
    "The @yourtal/idempotency package's own dedupe store (packages/idempotency/src/postgres-store.ts) — infrastructure, not a domain contract.",
  "platform.region_setting":
    "1.2.f's per-region economy settings (F12/F23) -- a config store, not a domain entity. `regionSettingSchema` (ledger-internal/settings.ts) types the getSettings/proposeSetting/approveSetting operations, not a row-shaped public contract, and is listed in openapi.test.ts's NOT_PUBLISHED for the same reason.",
  "platform.ledger_fake_allocation":
    "1.2.d's FakeLedgerClient backing store (platform.ledger_fake_*), shared by api and worker so `LEDGER_MODE=fake` behaves like the real service. It exists only to give the ledger-internal operations (1.2.a, themselves listed in openapi.test.ts's NOT_PUBLISHED) real semantics before 4.1 lands; nothing reads a row of it directly the way a domain contract would, and 4.9.e retires the whole fake once every live route exists.",
  "platform.ledger_fake_hold":
    "Same FakeLedgerClient note as platform.ledger_fake_allocation above.",
  "platform.ledger_fake_grant":
    "Same FakeLedgerClient note as platform.ledger_fake_allocation above.",
  "platform.ledger_fake_burn":
    "Same FakeLedgerClient note as platform.ledger_fake_allocation above.",
  "platform.ledger_fake_escrow":
    "Same FakeLedgerClient note as platform.ledger_fake_allocation above.",
  "platform.ledger_fake_backing_rate":
    "Same FakeLedgerClient note as platform.ledger_fake_allocation above.",
  "platform.ledger_fake_quote":
    "Same FakeLedgerClient note as platform.ledger_fake_allocation above.",
  "platform.ledger_fake_rate_proposal":
    "Same FakeLedgerClient note as platform.ledger_fake_allocation above.",
  "platform.ledger_fake_marketing_fund":
    "Same FakeLedgerClient note as platform.ledger_fake_allocation above.",
  "platform.ledger_fake_point_purchase":
    "Same FakeLedgerClient note as platform.ledger_fake_allocation above.",
  "platform.voucher_fake_batch":
    "1.2.d's FakeVoucherClient backing store (platform.voucher_fake_*) -- same reason as platform.ledger_fake_allocation above, for voucher-internal (1.2.b) instead of ledger-internal.",
  "platform.voucher_fake_voucher":
    "Same FakeVoucherClient note as platform.voucher_fake_batch above.",
  "platform.voucher_fake_authorization":
    "Same FakeVoucherClient note as platform.voucher_fake_batch above.",
  "platform.voucher_fake_capture":
    "Same FakeVoucherClient note as platform.voucher_fake_batch above.",
  "platform.voucher_fake_kill_switch":
    "Same FakeVoucherClient note as platform.voucher_fake_batch above.",
  "platform.voucher_fake_credential":
    "Same FakeVoucherClient note as platform.voucher_fake_batch above.",
  "voucher.merchant_signature_seen":
    "Same redemption-network note as voucher.authorization below -- a merchant-terminal signature replay-protection table (20260925194200), not a row a holder or merchant ever reads directly.",
  "platform.sim_outbox":
    "1.6's shared simulated-driver outbox (red line 11) -- infrastructure a reviewer reads through /dev/inbox, not a domain contract any consumer parses.",
  "store.listing_location":
    "The join table behind listingSchema.locations, named in that mapping's fieldsWithNoColumn above. A pure many-to-many join on two foreign keys, with no field of its own to map.",
  "store.listing_price_revision":
    "Settlement-value audit trail (YT-0130/131/132). No public contract — a merchant reads the result through listingSchema's settlement value, never this row.",
  "store.settlement_decrease_request":
    "Two-person-approval workflow table for a material settlement decrease (YT-0575). No public contract; its state is surfaced through the approval endpoint's own response.",
  "voucher.batch":
    "The issuance batch named in voucherSchema's columnsWithNoField.batch_id above — carries the funding record and two-person approval (YT-0141). No public contract of its own for the same reason: a holder has no business knowing which batch minted their voucher.",
  "voucher.code_custody":
    "Holds the voucher's SHA-256 lookup hash and envelope-encrypted display copy (docs/15 rule 7, see voucherSchema's code note above). yourtal_app cannot read this table in full; no public contract represents it, by design.",
  "voucher.event":
    "Append-only voucher lifecycle event log backing voucher-lifecycle.ts's state derivation. No public contract mirrors an event row directly.",
  "voucher.authorization":
    "Redemption-network internals (20260920000016_redemption_network.sql) — merchant-terminal authorization plumbing. No public contract; a holder or merchant never reads this table's rows directly.",
  "voucher.capture": "Same redemption-network note as voucher.authorization above.",
  "voucher.refund": "Same redemption-network note as voucher.authorization above.",
  "voucher.merchant_credential": "Same redemption-network note as voucher.authorization above.",
  "voucher.kill_switch": "Same redemption-network note as voucher.authorization above.",
  "voucher.redemption_attempt": "Same redemption-network note as voucher.authorization above.",
  "watch.coverage":
    "The raw evidence rows behind watch-coverage.ts's range arithmetic (YT-0120/YT-0551). That module exports functions and types over server-computed ranges, not a persisted object schema, so there is no contract to map.",
  "watch.checkpoint_nonce":
    "The spend record that makes a checkpoint token single-use (YT-0121). watch-checkpoint-token.ts's CheckpointClaims is what a token CARRIES, not what this table stores — the row exists to be conflicted with, and its columns are the burn's own bookkeeping. Deliberately has no public contract: a nonce is a value a client presents once and must never be able to enumerate or read back.",
  "campaign.chapter":
    "Already declared as a relation under campaignSchema.chapters above. campaignChapterSchema also exists standalone (packages/contracts/src/campaign/campaign-chapter.ts) but has not been given its own MAPPINGS row — a tracked gap in the campaign module, out of YT-0555's scope (business module only).",
  "campaign.video_source":
    "Already declared as a relation under campaignSchema.videoSource above. campaignVideoSourceSchema also exists standalone but has not been given its own MAPPINGS row — same tracked gap as campaign.chapter, out of YT-0555's scope.",
  "campaign.question":
    "question-bank.ts/presented-question.ts define contract schemas for this table's data; neither has a MAPPINGS row yet — a tracked gap in the question-bank module, out of YT-0555's scope (business module only).",
  "campaign.question_answer_key": "Same question-bank note as campaign.question above.",
  "campaign.question_response":
    'Per-user checkpoint answers with their server-measured latency (YT-0122). Deliberately has no public contract and never will: `yourtal_app` holds INSERT and NO SELECT on it, so the application cannot read a row back — that missing grant IS the criterion "never exposed per-user to the business". A contract schema would describe a shape no application code can legitimately construct from a read.',
  "campaign.question_option": "Same question-bank note as campaign.question above.",
  "identity.principal_security_state":
    "The 72h SIM-swap / account-recovery freeze read into AsyncPrincipalResolver.resolve() (YT-0582, docs/14 section 5). No public contract — a principal's freeze is enforced through the PDP's ALLOW/DENY, never returned to any client as a field of its own.",
  "identity.credential":
    "YT-0540. One row per (userId, kind) holding an Argon2id hash — never returned to any client, and secret_hash is never a field on a public contract by construction. Adding a phone-OTP or OIDC kind (YT-0541) is a new row, not a new mapping.",
  "identity.session":
    "YT-0540. The server-side session record behind AuthService/SessionService — id is a SHA-256 hash of an opaque bearer token, never readable back through any endpoint (see auth.service.test.ts's own proof of that). AuthController's own responses carry the raw token once, at issuance; this row is never serialised.",
  "identity.verification_token":
    "YT-0540. Password-reset and email-verification tokens, hashed at rest like identity.session.id above. Single-use via consumed_at (see the migration's own header); no public contract represents a row of it, only the confirm endpoints' generic ok/token_invalid outcome.",
};

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

    // Both former gaps are closed by YT-0101's migration: `chapters` and
    // `videoSource` now have storage as relations. The list is empty, and
    // that is the state it should stay in — a new entry here needs a
    // deliberate edit and a ticket, not a quiet append.
    expect(gaps).toStrictEqual([]);
  });
});

/**
 * YT-0555's second criterion: every migrated table is accounted for on
 * exactly one side of `MAPPINGS` / `TABLES_WITH_NO_MAPPING`, checked in both
 * directions. This is what makes the gate fail when a mapped SCHEMA goes
 * missing, not only when a mapped FIELD does — a new module landing with
 * tables and no entry anywhere fails here immediately, the same day, in the
 * package where it was added. Before YT-0555 this is exactly how the whole
 * business module went unmapped without the suite ever going red.
 */
describe("table coverage", () => {
  it("every migrated table is mapped or has a written reason for why not", () => {
    const mappedTables = new Set(MAPPINGS.map((mapping) => mapping.table));

    const uncovered = [...TABLES.keys()]
      .filter((table) => !mappedTables.has(table))
      .filter((table) => TABLES_WITH_NO_MAPPING[table] === undefined);

    // A table with no MAPPINGS row and no entry in TABLES_WITH_NO_MAPPING.
    // Map it, or write down why it has no contract, in this file.
    expect(uncovered).toStrictEqual([]);
  });

  it("TABLES_WITH_NO_MAPPING carries no stale entry", () => {
    const mappedTables = new Set(MAPPINGS.map((mapping) => mapping.table));
    const tableNames = new Set(TABLES.keys());

    const stale = Object.keys(TABLES_WITH_NO_MAPPING).filter(
      (table) => mappedTables.has(table) || !tableNames.has(table),
    );

    // Either the table gained a MAPPINGS row and this line was not removed,
    // or the table no longer exists in the migrations at all. Both mean the
    // reason on file no longer describes anything real.
    expect(stale).toStrictEqual([]);
  });
});
