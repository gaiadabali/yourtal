/**
 * YT-0535: no domain code imports a vendor SDK.
 *
 * ## What this is actually protecting
 *
 * The decision of 2026-09-19 holds every third-party connection behind a
 * simulator. That only works while the vendors stay behind the seam — one
 * `import Xendit from "xendit-node"` in a use-case and the boundary is no
 * longer switchable, no longer simulatable, and no longer visible to the
 * parity suite (YT-0539) that is supposed to be watching it.
 *
 * It is not a style rule. `docs/03` risk 41 is that a simulator is our guess
 * about a vendor wearing a green test; the mitigation depends on the set of
 * boundaries being **enumerable**, and a direct vendor import is precisely a
 * boundary that is not in the enumeration.
 *
 * ## Why an allowlist of adapter directories rather than a global ban
 *
 * Somebody has to call the vendor. `packages/drivers` is where a driver
 * lives; `packages/media` is the object-storage adapter, which uses the S3
 * client deliberately so the R2 path is exercised rather than stubbed. Both
 * are adapters by design. Everywhere else — domain, use-cases, UI — has no
 * business knowing which vendor exists.
 *
 * ## Why the vendor list is explicit rather than heuristic
 *
 * A heuristic ("anything that looks like an SDK") would be wrong in both
 * directions, and a rule that cries wolf gets disabled. This list is meant
 * to be edited: adding a vendor to `package.json` and not to this list is
 * the mistake the rule cannot catch, so the review question is "which
 * boundary is this, and is it in the registry?"
 */

/** Module prefixes that mean "we are talking to a named third party". */
const VENDOR_MODULES = [
  "xendit",
  "xendit-node",
  "stripe",
  "@stripe/",
  "midtrans",
  "midtrans-client",
  "twilio",
  "@sendgrid/",
  "nodemailer",
  "openai",
  "@anthropic-ai/",
  "@google-cloud/",
  "@aws-sdk/",
  "aws-sdk",
  "cloudflare",
  "whatsapp-web.js",
  "@whiskeysockets/",
];

/** Directories allowed to import a vendor SDK, because they ARE the adapter. */
const ADAPTER_DIRECTORIES = ["packages/drivers/", "packages/media/"];

function isVendorModule(source) {
  return VENDOR_MODULES.some((vendor) => source === vendor || source.startsWith(vendor));
}

function isAdapter(filename) {
  const normalised = filename.split("\\").join("/");
  return ADAPTER_DIRECTORIES.some((directory) => normalised.includes(directory));
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Vendor SDKs may only be imported by an adapter, so every external boundary stays behind the driver seam (YT-0535).",
    },
    schema: [],
    messages: {
      vendorInDomain:
        'Vendor SDK "{{source}}" cannot be imported here. Every external boundary goes through a driver in packages/drivers, with a simulated and a live implementation (YT-0535) — a direct import makes the boundary unswitchable, unsimulatable, and invisible to the parity suite. Add an interface and a driver, then depend on that.',
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (isAdapter(filename)) {
      return {};
    }

    function check(node, source) {
      if (typeof source === "string" && isVendorModule(source)) {
        context.report({ node, messageId: "vendorInDomain", data: { source } });
      }
    }

    return {
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ImportExpression(node) {
        if (node.source.type === "Literal") check(node, node.source.value);
      },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type === "TSExternalModuleReference") {
          check(node, node.moduleReference.expression.value);
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          node.arguments[0]?.type === "Literal"
        ) {
          check(node, node.arguments[0].value);
        }
      },
    };
  },
};
