// Flat config for the whole workspace. Encodes docs/13b-typescript-standards.md.
// Type-aware linting is ON by design (13b §2) — TypeScript is pinned to 5.9.x
// because typescript-eslint peers at >=4.8.4 <6.1.0 and TS 7 would silently
// disable every no-unsafe-* rule below.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import mustUseResult from "./eslint-rules/must-use-result.mjs";
import noVendorSdk from "./eslint-rules/no-vendor-sdk.mjs";
import { builtinRules } from "eslint/use-at-your-own-risk";

// A second copy of no-restricted-syntax, so a rule set can warn while the first errors.
const restrictedSyntaxWarn = builtinRules.get("no-restricted-syntax");

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/.lighthouseci/**",
      "**/*.config.{js,mjs,cjs,ts}",
      "**/lighthouserc.cjs",
      "**/vitest.setup.ts",
      "scripts/**",
      // Plain build/codegen tooling, not typechecked source. Type-aware
      // linting needs a file in a tsconfig project; these are not, by
      // design, so exclude them rather than force them into one.
      "**/openapi/*.mjs",
      "packages/*/scripts/**/*.mjs",
      "apps/*/scripts/**/*.mjs",
      // HLS media fixtures. MPEG transport streams use the .ts extension,
      // which collides with TypeScript, so ESLint tries to parse binary video
      // as source and every segment reports "not found by the project
      // service". `.gitattributes` already declares these binary; this is the
      // same fact stated to the linter. Found by the FIRST CI run that ever
      // executed: 72 errors there, 0 locally, because every package's lint
      // script was scoped to `src` and never looked at `fixtures`.
      "packages/media/fixtures/**",
      // YT-0424: the Serwist service worker. `apps/web/app/sw.ts` runs in a
      // Service Worker global scope and is deliberately excluded from
      // `apps/web/tsconfig.json` (see that file's comment) — Serwist's own
      // build bundles it independently via esbuild, not through the app's
      // TypeScript project, so there is no tsconfig project for type-aware
      // linting to find it in, same category as the HLS fixtures above.
      // `apps/web/public/**` is that file's generated, gitignored build
      // output (`public/sw.js`) — never source, nothing to lint.
      "apps/web/app/sw.ts",
      "apps/web/public/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    linterOptions: {
      // 13b §2: stale disables must fail the build, not linger.
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      // --- §2 No `any` ---
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",

      // Underscore prefix is the established "intentionally unused" marker —
      // e.g. a parameter kept for a not-yet-implemented signature.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],

      // --- §5 Barrel files are banned outright ---
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/index", "**/index.ts", "**/index.js"],
              message:
                "Barrel files are banned (13b §5). Import the real path, or use a package subpath export.",
            },
            {
              group: ["@yourtal/*/src/**"],
              message:
                "Deep imports into another package's src are banned (13b §5). Use its subpath export.",
            },
          ],
        },
      ],

      // --- §1 tsconfig intent, enforced at lint level too ---
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],

      // `onClick={() => close()}` is idiomatic React, not a defect. 13b does
      // not ask for this rule, and it fires on almost every event handler.
      "@typescript-eslint/no-confusing-void-expression": "off",

      // Numbers in template literals are idiomatic and safe; 13b does not ask
      // for this. Kept strict for the types that actually stringify badly.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },

  // React hooks correctness. Two agents wrote `eslint-disable
  // react-hooks/exhaustive-deps` comments before this plugin was configured,
  // which meant those disables suppressed nothing and the rule never ran.
  {
    files: ["**/*.{jsx,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // §5: `export *` is banned in every file, including within a package.
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportAllDeclaration",
          message: "`export *` is banned (13b §5) — it defeats tree-shaking.",
        },
      ],
    },
  },

  // §2: casts and non-null assertions are banned outright in contracts,
  // which is value-path code. Elsewhere they need a justifying comment,
  // which lint cannot check — so they stay warnings there.
  {
    files: ["packages/contracts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
    },
  },

  // Tests may assert on shapes the strict rules would otherwise reject.
  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      // `() => setOpen(false)` and jsdom polyfill stubs are normal in tests.
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },

  // YT-0500: a discarded Result is a discarded decision. docs/13b §4 asks
  // for `neverthrow/must-use-result`; that plugin is eslintrc-era and last
  // published in 2022, so the rule is local — see eslint-rules/.
  //
  // Scoped to the two packages that use neverthrow rather than applied
  // repo-wide: it needs type information, and turning a type-aware rule on
  // across apps/web while another session is mid-change buys risk for no
  // benefit, since nothing there returns a Result.
  {
    files: ["apps/api/**/*.ts", "packages/authz/**/*.ts", "packages/drivers/**/*.ts"],
    plugins: { yt: { rules: { "must-use-result": mustUseResult } } },
    rules: { "yt/must-use-result": "error" },
  },

  // YT-0535: every external boundary stays behind the driver seam. Applied
  // repo-wide, unlike `must-use-result`, because the rule needs no type
  // information and the thing it prevents — a vendor import in domain code —
  // is exactly as wrong in apps/web as in apps/api. The adapters that are
  // ALLOWED to import a vendor are named inside the rule rather than here,
  // so the allowlist sits next to the reasoning for it.
  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}", "services/**/*.ts"],
    plugins: { ytBoundary: { rules: { "no-vendor-sdk": noVendorSdk } } },
    rules: { "ytBoundary/no-vendor-sdk": "error" },
  },

  // Area B: the viewer's features use design tokens only. C turns the same
  // rules on for its own features in 7.8.
  {
    files: [
      "apps/web/features/{auth,campaign,player,checkpoint,quick,store,burn,wallet,me,streak,shell,onboarding,region,open-view,public,notifications,rum}/**/*.{ts,tsx}",
    ],
    ignores: [
      "**/*.test.{ts,tsx}",
      // The OG image is drawn by satori outside the CSS, so it needs literal colours.
      "apps/web/features/public/public-og-card.tsx",
    ],
    plugins: { "yt-b": { rules: { "prefer-primitives": restrictedSyntaxWarn } } },
    rules: {
      "no-restricted-syntax": [
        "error",
        // Restated: this rule replaces, not extends, the repo-wide one above.
        {
          selector: "ExportAllDeclaration",
          message: "`export *` is banned (13b §5) — it defeats tree-shaking.",
        },
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
          message: "Use a colour token, not a raw hex value.",
        },
        {
          selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]",
          message: "Use a colour token, not a raw hex value.",
        },
        {
          selector: "Literal[value=/text-\\[[0-9.]+px\\]/]",
          message: "Use a type role (text-caption, text-body-sm, ...), not a pixel size.",
        },
        {
          selector: "TemplateElement[value.raw=/text-\\[[0-9.]+px\\]/]",
          message: "Use a type role (text-caption, text-body-sm, ...), not a pixel size.",
        },
      ],
      // Primitives and catalogue copy, not raw elements and literals. Warnings
      // for now; they become errors in 6.1.
      "yt-b/prefer-primitives": [
        "warn",
        {
          selector: "JSXOpeningElement[name.name=/^(button|select|table|input)$/]",
          message:
            "Use the @yourtal/ui primitive (Button, NativeSelect, DataTable, Input) instead.",
        },
        {
          selector: "JSXText[value=/[A-Za-z]/]",
          message: "User-facing copy comes from the message catalogues, not a JSX literal.",
        },
        {
          selector:
            "JSXAttribute[name.name=/^(aria-label|title|placeholder|alt)$/] > Literal[value=/[A-Za-z]/]",
          message: "User-facing copy comes from the message catalogues, not a JSX literal.",
        },
      ],
    },
  },

  prettier,
);
