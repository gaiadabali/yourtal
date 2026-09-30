/**
 * 4.9.d: B (the backing rate) never reaches a browser. The server prices
 * every listing. 13.5.c deleted the last mock rate; this keeps a new one out.
 */

const MOCK_NAME = /^MOCK_BACKING_RATE/;
const MOCK_MODULE = /(^|\/)money\/mock-backing-rate(\.ts)?$/;

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
