import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildDocument,
  countCrossFieldRefinements,
  isRecord,
  objectShapeKeys,
} from "./build-document";
import { CONTRACT_COMPONENTS } from "./schema-registry";

/**
 * The drift gate. YT-0031 AC3: "drift between schema and generated output
 * fails CI."
 *
 * Three separate things can drift, and each gets its own test, because they
 * fail for different reasons and a reviewer should be able to tell which at a
 * glance:
 *
 *   1. the checked-in document vs. what the schemas produce today;
 *   2. a schema exists but nobody put it in the document;
 *   3. a `.refine()` was added and its rule was not written down, so it
 *      vanishes from the document in silence.
 *
 * To regenerate after an intentional schema change:
 *
 *   pnpm --filter @yourtal/contracts openapi:update
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const documentPath = path.join(packageRoot, "openapi", "yourtal.openapi.json");
const srcDir = path.join(packageRoot, "src");

// Parsed rather than asserted: `as` is banned in this package (docs/13b
// section 2), and we have a schema library right here.
const packageJson = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")));

/** One component's schema object out of the built document. */
function componentSchema(id: string): Record<string, unknown> {
  const schema = buildDocument(packageJson.version).components.schemas[id];
  if (!isRecord(schema)) throw new Error(`no component schema for "${id}"`);
  return schema;
}

/**
 * Schemas deliberately kept out of the published contract, with the reason.
 * Anything added here is a decision someone has to defend in review, which
 * is the point of making it explicit rather than allowing the completeness
 * check to be loosened.
 */
/**
 * 1.2.a/1.2.b: every `ledger-internal` and `voucher-internal` operation type
 * (pricing, funding, rewards, wallet, economy, batches, lifecycle, redemption,
 * credentials, kill-switch, stats) plus the closed error enum they share
 * (1.2.c). These are the shape `FakeLedgerClient`/`HttpLedgerClient` and
 * their voucher twins speak to `services/ledger`/`services/voucher` over a
 * service-to-service boundary (4.1/4.5's HMAC-signed calls) -- never a
 * `/api/:tenantId/*` route a browser calls, so there is nothing here for
 * this registry (which documents the public/business-facing HTTP contract)
 * to publish. Same reasoning as `regionSettingSchema` below, which is why
 * that one lives in this same object rather than its own case.
 */
const LEDGER_AND_VOUCHER_INTERNAL_REASON =
  "ledger-internal/voucher-internal (1.2.a-c): an internal service-to-service operation type, not a public/business-facing HTTP contract -- see this file's comment above NOT_PUBLISHED.";

const NOT_PUBLISHED: Readonly<Record<string, string>> = {
  regionSettingSchema:
    "1.2.f's ledger-internal settings row (getSettings/proposeSetting/approveSetting). Internal to the ledger and 9.5.d's staff console, not a public/business-facing HTTP contract -- same reason ledger-internal and voucher-internal's own operation types are not routed through this registry.",

  // --- ledger-internal (1.2.a): pricing ---
  quoteRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  quoteSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  lockQuoteRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  priceListingRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  priceListingResultSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  quotePurchaseRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  quotePurchaseResultSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- ledger-internal: funding and allocations ---
  funderTypeSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  purchasePointsRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  allocationSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  holdRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  holdSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  returnGrantRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  campaignSpendSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- ledger-internal: earning and spending ---
  trustTierSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  grantKindSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  grantRewardRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  rewardAttestationSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  grantActionRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  grantSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  burnForVoucherRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  burnSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- ledger-internal: captures (4.6.f.2), posted by the voucher service ---
  captureVoucherRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  capturePostingSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- ledger-internal: holdback release notices (4.4.g) ---
  releaseSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  unnotifiedReleasesRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  unnotifiedReleasesSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  releasesNotifiedRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  releasesNotifiedSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  pointsUnlockedEventSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- ledger-internal: users (wallet) ---
  escrowRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  escrowSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  pendingBucketSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  ledgerBalanceSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  historyEntryKindSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  historyEntrySchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  historyRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- ledger-internal: economy ---
  coverageSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  economyDailyRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  economyDayRowSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  proposeRateRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  rateProposalSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  approveRateRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  fundMarketingRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  statementsRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  approvePayoutRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- ledger-internal/voucher-internal (1.2.c): the shared closed error enum ---
  ledgerErrorCodeSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  ledgerErrorSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- voucher-internal (1.2.b): batches ---
  requestBatchRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  batchSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  approveBatchRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- voucher-internal: lifecycle ---
  reserveRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  reservationSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  releaseRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  activateRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  revealRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  revealedCodeSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  qrTokenRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  qrTokenSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  verifyQrTokenRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  verifyQrTokenResultSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  voidVoucherRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- voucher-internal: wallet ---
  listForUserRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  listForUserResultSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  getVoucherRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- voucher-internal: device-authorized redemption ---
  authorizeAsDeviceRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  authorizationSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  captureAsDeviceRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  captureSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- voucher-internal: kill switches ---
  killSwitchScopeSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  setKillSwitchRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  killSwitchSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- voucher-internal: merchant credentials ---
  issueMerchantCredentialRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  merchantCredentialSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  rotateCredentialRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  revokeCredentialRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,

  // --- voucher-internal: merchant stats ---
  merchantCaptureStatsRequestSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
  merchantCaptureStatsSchema: LEDGER_AND_VOUCHER_INTERNAL_REASON,
};

function exportedSchemaNames(): string[] {
  const names: string[] = [];
  for (const domain of readdirSync(srcDir, { withFileTypes: true })) {
    if (!domain.isDirectory() || domain.name === "internal" || domain.name === "openapi") continue;
    for (const file of readdirSync(path.join(srcDir, domain.name))) {
      // Mock builders and tests are development scaffolding, not contract.
      if (!file.endsWith(".ts") || file.endsWith(".mock.ts") || file.endsWith(".test.ts")) continue;
      const source = readFileSync(path.join(srcDir, domain.name, file), "utf8");
      for (const match of source.matchAll(/^export const (\w+Schema)\b/gm)) {
        const name = match[1];
        if (name !== undefined) names.push(name);
      }
    }
  }
  return names;
}

/** `campaignKindSchema` -> `CampaignKind`, matching the registry's ids. */
function componentIdFor(schemaName: string): string {
  const base = schemaName.replace(/Schema$/, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

describe("the generated OpenAPI document", () => {
  it("matches what the Zod schemas produce right now", () => {
    const generated = buildDocument(packageJson.version);

    if (process.env.UPDATE_OPENAPI === "1") {
      writeFileSync(documentPath, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
    }

    const checkedIn: unknown = JSON.parse(readFileSync(documentPath, "utf8"));
    expect(
      checkedIn,
      "openapi/yourtal.openapi.json is stale. A schema changed without the document being " +
        "regenerated — run `pnpm --filter @yourtal/contracts openapi:update` and commit the result.",
    ).toEqual(generated);
  });

  it("is OpenAPI 3.1, because 3.0 would need a lossy rewrite", () => {
    expect(buildDocument(packageJson.version).openapi).toBe("3.1.0");
  });
});

describe("registry completeness", () => {
  it("every exported schema is either published or explicitly not", () => {
    const published = new Set(CONTRACT_COMPONENTS.map((component) => component.id));
    const missing = exportedSchemaNames()
      .filter((name) => NOT_PUBLISHED[name] === undefined)
      .filter((name) => !published.has(componentIdFor(name)));

    // Catches the realistic failure: someone adds a schema in another session,
    // it never reaches the document, and a Go service silently has no type for
    // it. Register it in schema-registry.ts, or list it in NOT_PUBLISHED with
    // a reason.
    expect(missing).toEqual([]);
  });

  it("component ids are unique", () => {
    const ids = CONTRACT_COMPONENTS.map((component) => component.id);
    expect(ids).toEqual([...new Set(ids)]);
  });
});

describe("cross-field rules", () => {
  // The rules JSON Schema cannot carry. If these counts disagree, a .refine()
  // was added or removed without the prose being updated — which means the
  // generated Go and TypeScript are quietly weaker than the Zod schema and
  // nothing else in the toolchain would have said so.
  it.each(CONTRACT_COMPONENTS.map((component) => [component.id, component] as const))(
    "%s documents every refinement it carries",
    (_id, component) => {
      expect(component.crossFieldRules).toHaveLength(countCrossFieldRefinements(component.schema));
    },
  );

  it("reaches the document, where generated code can see it", () => {
    const listing = componentSchema("Listing");

    expect(listing.description).toContain("cannot exceed faceValueMinor");
    expect(listing.description).toContain("NOT enforced by this schema");
  });

  it("finds the refinements hidden inside a discriminated union", () => {
    // Question's refinements sit on the union MEMBERS, not the union. A naive
    // count returns zero here and the whole check becomes decorative.
    const question = CONTRACT_COMPONENTS.find((component) => component.id === "Question");
    expect(countCrossFieldRefinements(question?.schema)).toBeGreaterThan(0);
  });
});

describe("faithfulness to the Zod schemas", () => {
  // The drift test proves the checked-in document matches what the generator
  // produces. It does NOT prove the generator produced the right thing — a
  // silently dropped field would pass it, because the document and the
  // regenerated document would agree with each other and both be wrong.
  //
  // This compares the document back against the Zod shapes directly, which is
  // the only check here that would catch zod changing what it emits.
  const objectComponents = CONTRACT_COMPONENTS.filter(
    (component) => objectShapeKeys(component.schema) !== undefined,
  );

  it("covers every object component", () => {
    // Guards the guard: if introspection silently stops working, the loop
    // below would pass vacuously over an empty list.
    expect(objectComponents.length).toBeGreaterThanOrEqual(6);
  });

  it.each(objectComponents.map((component) => [component.id, component] as const))(
    "%s exposes exactly the fields its Zod schema declares",
    (id, component) => {
      const properties = componentSchema(id).properties;
      const documented = isRecord(properties) ? Object.keys(properties).sort() : [];

      expect(documented).toEqual(objectShapeKeys(component.schema));
    },
  );
});

describe("integer width", () => {
  const INT32_MAX = 2_147_483_647;

  /** Every `{type: "integer"}` anywhere in the document, with its path. */
  function integerNodes(
    node: unknown,
    at = "$",
  ): { path: string; node: Record<string, unknown> }[] {
    if (Array.isArray(node)) {
      return node.flatMap((child, index) => integerNodes(child, `${at}[${String(index)}]`));
    }
    if (!isRecord(node)) return [];

    const here = node.type === "integer" ? [{ path: at, node }] : [];
    return [
      ...here,
      ...Object.entries(node).flatMap(([key, value]) => integerNodes(value, `${at}.${key}`)),
    ];
  }

  it("no integer that exceeds int32 is left without int64", () => {
    // Generators default `{"type":"integer"}` to int32. Our money types allow
    // 10,000,000,000 — about five times what an int32 holds — so without an
    // explicit int64 a generated Go struct would silently truncate a real
    // Rupiah amount. Caught once, in review; this keeps it caught.
    const offenders = integerNodes(buildDocument(packageJson.version).components.schemas)
      .filter(({ node }) => {
        const max = node.maximum;
        return typeof max !== "number" || max > INT32_MAX;
      })
      .filter(({ node }) => node.format !== "int64")
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("marks the money types int64 specifically", () => {
    expect(componentSchema("Points")).toMatchObject({ type: "integer", format: "int64" });
    expect(componentSchema("IdrMinorUnits")).toMatchObject({ type: "integer", format: "int64" });
  });

  it("leaves small bounded integers alone", () => {
    // Widening everything would be the lazy fix, and would make every small
    // count field an int64 for no reason. A campaign's questionCount maxes
    // at 5 (F10, TASKS.md 1.1.f) and stays a plain integer.
    const properties = componentSchema("Campaign").properties;
    const questionCount = isRecord(properties) ? properties.questionCount : undefined;

    expect(questionCount).toMatchObject({ type: "integer", maximum: 5 });
    expect(isRecord(questionCount) ? questionCount.format : "missing").toBeUndefined();
  });
});
