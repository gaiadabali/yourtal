// Flat config for the whole workspace. Encodes docs/13b-typescript-standards.md.
// Type-aware linting is ON by design (13b §2) — TypeScript is pinned to 5.9.x
// because typescript-eslint peers at >=4.8.4 <6.1.0 and TS 7 would silently
// disable every no-unsafe-* rule below.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";

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
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
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
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
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

  prettier,
);
