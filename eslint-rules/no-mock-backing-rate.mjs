/**
 * 4.9.d: B (the backing rate) never reaches a browser. The server prices
 * every listing; the mock rates in `@yourtal/contracts/money/mock-backing-rate`
 * are left only where they already are, until their owners remove them.
 */

/** The only files that may still name a mock backing rate. */
const ALLOWED = [
  // Removed by B's 6.6.b.
  "apps/web/features/burn/burn-data.ts",
  "apps/web/features/wallet/wallet-history.ts",
  // Removed by C's 7.8.c.
  "apps/web/features/console/campaign-builder/campaign-reward-risk.ts",
  // The contract mocks and the constant itself; 13.5.c deletes them.
  "packages/contracts/src/money/mock-backing-rate.ts",
  "packages/contracts/src/listing/listing.mock.ts",
  "packages/contracts/src/region/region-mock-au-listing.ts",
  "packages/contracts/src/wallet/wallet-history.mock.ts",
];

const MOCK_NAME = /^MOCK_BACKING_RATE/;
const MOCK_MODULE = /(^|\/)money\/mock-backing-rate(\.ts)?$/;

function isAllowed(filename) {
  const normalised = filename.split("\\").join("/");
  return ALLOWED.some((file) => normalised.endsWith(file));
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "No new use of a mock backing rate: the server computes every price (4.9.d).",
    },
    schema: [],
    messages: {
      mockRate:
        "A mock backing rate cannot be used here. Points prices come from the server (the ledger's listing price or a quote); B never reaches a browser.",
    },
  },

  create(context) {
    if (isAllowed(context.filename)) return {};
    const reportModule = (node, source) => {
      if (typeof source === "string" && MOCK_MODULE.test(source))
        context.report({ node, messageId: "mockRate" });
    };
    return {
      Identifier(node) {
        if (MOCK_NAME.test(node.name)) context.report({ node, messageId: "mockRate" });
      },
      ImportDeclaration(node) {
        reportModule(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") reportModule(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) reportModule(node, node.source.value);
      },
    };
  },
};
