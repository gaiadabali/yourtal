/**
 * `must-use-result` — a discarded `Result` is a discarded decision. YT-0500.
 *
 * `docs/13b` §4 requires this rule. `docs/14` §8 (A10) says why: value
 * operations fail closed, and a `Result` that nobody reads is a check whose
 * answer was thrown away. The dangerous line looks fine:
 *
 *     pdp.requireAction(principal, resource, "capture");   // no await, no check
 *
 * That compiles, runs, returns a rejected decision, and the code carries on
 * as though permission was granted. It is a **silently discarded permission
 * check** — and for an authorization or ledger call, it is the whole bug.
 *
 * ## Why this is a local rule and not a package
 *
 * `eslint-plugin-neverthrow` is the obvious answer and it was rejected: last
 * published in 2022, written for eslintrc rather than flat config, and
 * `docs/14` §7 puts a human gate plus a release cooldown on new dependencies
 * — none of which is worth spending on forty lines we can read. Being local
 * also means it fails with our wording and cites our docs.
 *
 * ## What counts as "used"
 *
 * Anything other than being the whole of an expression statement: assigned,
 * returned, awaited-then-used, passed as an argument, or chained through
 * `.map` / `.andThen` / `.match` / `.isOk()`. The rule therefore only fires
 * on the one shape that cannot be anything but a mistake — a call whose
 * result goes nowhere at all.
 *
 * `void` is the documented escape hatch, matching `no-floating-promises`:
 * `void store.complete(...)` says "deliberately not awaited" in a way a
 * reader and the linter agree on.
 */

const RESULT_TYPES = new Set(["Result", "ResultAsync", "Ok", "Err"]);

/** Whether a TypeScript type is (or resolves to) one of neverthrow's. */
function isResultType(checker, type) {
  const alias = type.aliasSymbol?.getName();
  if (alias !== undefined && RESULT_TYPES.has(alias)) return true;

  const symbol = type.getSymbol()?.getName();
  if (symbol !== undefined && RESULT_TYPES.has(symbol)) return true;

  // `Result<T, E>` is an alias for `Ok<T, E> | Err<T, E>`, so a union whose
  // every member is one of ours is one of ours.
  if (type.isUnion()) {
    return type.types.every((member) => isResultType(checker, member));
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require the Result of a neverthrow call to be used, so a failed check cannot be discarded.",
    },
    schema: [],
    messages: {
      mustUse:
        "This call returns a Result and nothing reads it, so a failure here is silently " +
        "discarded (docs/13b §4, docs/14 §8). Handle it, return it, or prefix with `void` " +
        "if discarding is genuinely intended.",
    },
  },

  create(context) {
    const services = context.sourceCode.parserServices;
    if (services?.program === undefined || services.esTreeNodeToTSNodeMap === undefined) {
      // No type information: this rule cannot work, and guessing from names
      // would produce false positives in a rule about correctness.
      return {};
    }
    const checker = services.program.getTypeChecker();

    function typeOf(node) {
      const tsNode = services.esTreeNodeToTSNodeMap.get(node);
      return tsNode === undefined ? undefined : checker.getTypeAtLocation(tsNode);
    }

    return {
      ExpressionStatement(node) {
        // `void expr` is the deliberate discard, as with floating promises.
        if (node.expression.type === "UnaryExpression" && node.expression.operator === "void") {
          return;
        }

        const inspected =
          node.expression.type === "AwaitExpression" ? node.expression : node.expression;

        const target = inspected.type === "AwaitExpression" ? inspected.argument : inspected;
        if (target.type !== "CallExpression") return;

        // For `await someResultAsync`, the interesting type is the awaited
        // one — ResultAsync resolves to a Result, and discarding that is the
        // same mistake one step later.
        const type = typeOf(inspected);
        if (type !== undefined && isResultType(checker, type)) {
          context.report({ node: target, messageId: "mustUse" });
        }
      },
    };
  },
};
