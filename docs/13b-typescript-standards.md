# YourTal — TypeScript, React & Next.js Standards

**Date:** 2026-09-18 · **Status:** Binding. Companion to [`13-engineering-standards.md`](13-engineering-standards.md); stack locked in [`15-stack-locked.md`](15-stack-locked.md).
**Scope:** `apps/web` (Next.js App Router — user app, advertiser console, merchant portal), `apps/api` (NestJS on the Fastify adapter), `services/media-worker`, and every package under `packages/`. The 300-line rule applies unchanged.

## 1. tsconfig

Base in `packages/tsconfig`, extended by every package. `skipLibCheck: true` is allowed (speed); `allowJs` is not. Beyond `"strict": true`, these earn their place:

| Flag                                                         | Why                                                                                                                                  |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `noUncheckedIndexedAccess`                                   | `arr[i]` and `record[key]` become `T \| undefined` — kills the most common runtime crash class. Locked in [`15`](15-stack-locked.md) |
| `exactOptionalPropertyTypes`                                 | `{x?: number}` stops accepting `{x: undefined}`; matters when "unset" and "cleared" mean different things to the ledger              |
| `noImplicitOverride`                                         | Prevents silent base-method drift, which NestJS inheritance invites                                                                  |
| `noFallthroughCasesInSwitch`                                 | Cheap, catches real bugs in discriminated-union handling                                                                             |
| `verbatimModuleSyntax`                                       | Forces `import type`; stops server-only modules leaking into client bundles                                                          |
| `isolatedModules` + `moduleResolution: "bundler"` + `noEmit` | SWC/esbuild correctness; Turbo runs `tsc --noEmit` as a gate, bundlers emit                                                          |

Decorator support (`experimentalDecorators`, `emitDecoratorMetadata`) is enabled **only** in `apps/api`, never in `apps/web` or `packages/*`.

## 2. No `any`

`@typescript-eslint/no-explicit-any` is an error, as are `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-return` and `no-unsafe-argument` — which need type-aware linting, which is on. Untyped input is `unknown` until a Zod schema narrows it. Non-null `!` and `as` casts are banned in `packages/contracts` and all value-path code; elsewhere they need an adjacent comment stating the invariant. Every disable carries a reason and a task ID — `// eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party types, YT-0412` — and `--report-unused-disable-directives` is on so stale ones fail the build.

## 3. Zod at the boundaries

`packages/contracts` is the **only** definition of an API shape: Zod → OpenAPI 3.1 → TS and Go types, and regeneration producing a diff fails CI. Types are derived with `z.infer`, never hand-written alongside.

**Parse at every process boundary:** HTTP bodies, params and responses; environment variables at startup, failing fast; pg-boss job payloads; third-party webhooks (Xendit, Stripe, Cloudflare Stream, Deepgram); JSONB columns read through Drizzle; anything out of `localStorage` or the Serwist cache. **Do not** parse on internal function calls — the type system already covers that, and the cost is real on the watch-session path.

In NestJS this is a global `ZodValidationPipe` (`nestjs-zod`), not per-controller decorators, so a new endpoint cannot forget it. In React, the same schema drives React Hook Form through `zodResolver`; a form never declares its own shape.

## 4. Errors: `neverthrow`

Use [`neverthrow`](https://github.com/supermacro/neverthrow)'s `Result<T, E>` for every _expected_ failure in NestJS use-cases, BFF handlers, SDK clients and server actions. It beats a hand-rolled union for three concrete reasons: combinators (`andThen`, `map`, `combine`), `ResultAsync` for the async path, and the `neverthrow/must-use-result` ESLint rule that turns an ignored result into a build failure.

- `E` is always a **discriminated union on `type`** — never a bare string, never `Error`:
  `type RedeemError = { type: "insufficient_points"; short: number } | { type: "voucher_expired"; expiredAt: string } | { type: "merchant_suspended" }`.
- `throw` is reserved for programmer errors and unrecoverable states, caught by React error boundaries and one top-level exception filter.
- Exactly **one adapter per app** maps `E.type` → HTTP status + the `code` of the standard error envelope ([`13`](13-engineering-standards.md) §5). A NestJS exception filter is that adapter; controllers never build an error body themselves.
- `switch` over `E.type` is exhaustive by `noFallthroughCasesInSwitch` plus a `never` default — adding a variant breaks every consumer at compile time, which is the intent.

## 5. Barrel files: banned

**Barrel files are banned outright** ([`15`](15-stack-locked.md), "Explicitly not used"). No `index.ts` whose only job is re-export, anywhere — apps, packages, feature folders, test helpers. Barrels defeat tree-shaking and force bundlers, linters and test runners to build the whole module graph per file: Marvin Hagemeister measured [60–80% tooling slowdowns from barrel files](https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/), and Vercel shipped [`optimizePackageImports`](https://vercel.com/blog/how-we-optimized-package-imports-in-next-js) purely to undo the damage in Next.js.

| Instead         |                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inside an app   | Import the real path: `import { CampaignCard } from "@/features/campaign/campaign-card"`                                                                                              |
| Across packages | **Subpath exports** in `package.json`: `"./button": "./src/button/button.tsx"` → `import { Button } from "@yourtal/ui/button"`. The map is the public API; there is no `src/index.ts` |
| Enforcement     | ESLint `no-restricted-imports` blocks `*/index` patterns and deep `packages/*/src/**` paths; [`knip`](https://knip.dev) fails CI on unused files, exports and dependencies            |

`export *` is banned for the same reason, in every file, including within a package.

## 6. Naming

Files and directories are `kebab-case` everywhere, components included (`campaign-card.tsx` exports `CampaignCard`), matching Next.js's own route files. Types and components are `PascalCase` with no `I` prefix, no `T` prefix, no `Type` suffix. Functions and variables are `camelCase`; booleans read as predicates (`isRedeemable`, `hasFunding`, `canCashOut`). `SCREAMING_SNAKE` is only for module-level literals. Hooks take a `use-` file prefix and `use` function prefix, one per file. Props types are named `CampaignCardProps` and declared immediately above the component, never inlined into the signature. Schemas pair as `campaignSchema` + `type Campaign = z.infer<typeof campaignSchema>`. NestJS files carry their role: `campaign.controller.ts`, `campaign.service.ts`, `publish-campaign.use-case.ts`.

## 7. NestJS (`apps/api`)

| Rule                        |                                                                                                                                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Module = domain             | One Nest module per domain (campaign, store, merchant, moderation), each owning **one Postgres schema and one DB role**. Cross-module access goes through the other module's exported provider interface, never its repository, and never its tables ([`13`](13-engineering-standards.md) §3) |
| Controllers are thin        | Route, validate (global Zod pipe), authorize (Cerbos guard), call one use-case, map the `Result`. **Under 80 lines**; no business logic, no Drizzle import                                                                                                                                    |
| Use-cases, not god services | One file per use-case exporting one function or one small class. A `CampaignService` with six public methods gets split the moment it passes 300 lines — usually well before                                                                                                                  |
| Data access                 | Drizzle query builders in a repository per module. `sql.raw` and string-built SQL are banned outside one allowlisted, reviewed file ([`14`](14-security-engineering.md) §5)                                                                                                                   |
| Transactions                | Opened in the use-case via `db.transaction`, never in a controller or a repository method                                                                                                                                                                                                     |
| DI                          | Constructor injection with interface tokens. No `forwardRef` — a circular dependency means the boundary is wrong                                                                                                                                                                              |
| Config                      | One Zod-parsed config object at bootstrap. `process.env` is read in exactly one file                                                                                                                                                                                                          |
| Adapter                     | Fastify. No Express middleware, no `@types/express` in the tree                                                                                                                                                                                                                               |

## 8. React and the Next.js App Router

| Rule                     |                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default                  | **Server Component.** A file gets `"use client"` only for state, effects, event handlers or a browser API                                                                                                                                                                                                                                                                                               |
| `"use client"` placement | **Leaf files only** — never on `page.tsx`, `layout.tsx` or `template.tsx`, which drags the whole subtree into the client bundle. Push the directive down to the smallest interactive unit                                                                                                                                                                                                               |
| Enforcement              | `server-only` imported by every data-access module, `client-only` where relevant; ESLint `no-restricted-imports` forbids `@yourtal/db`, `drizzle-orm` and secret-reading modules from any `"use client"` file                                                                                                                                                                                           |
| Data fetching            | Server Components and Route Handlers only. Client components receive props or use TanStack Query against our own API — never a direct `fetch` to a third party, which would leak a key and bypass the egress proxy                                                                                                                                                                                      |
| Props                    | Serializable across the RSC boundary: IDs and primitives, not class instances or functions (Server Actions excepted). Props are typed by a named `…Props` interface, never inline, never `React.FC`                                                                                                                                                                                                     |
| File structure           | One component per file. Order: imports → `Props` type → component → local subcomponents, and only if they will never be reused                                                                                                                                                                                                                                                                          |
| Suspense                 | Every async subtree gets an explicit `loading.tsx` or `<Suspense fallback>`, and fallbacks are layout-stable — CLS ≤ 0.1 is a CI gate                                                                                                                                                                                                                                                                   |
| Heavy modules            | `hls.js`, visx charts and the QR scanner are `next/dynamic` with `ssr: false`, loaded on intent — never in the shell bundle                                                                                                                                                                                                                                                                             |
| **Initial JS per route** | **≤ 200 KB gzipped** hard gate; any route above **180 KB** needs a written justification in the PR. _Revised 2026-09-19: the original 170 KB predated measuring the Next 16 + React 19 framework floor of ~147 KB, which left only 23 KB for application code — not achievable. The real gate is the outcome (LCP ≤ 2.0 s, TBT ≤ 200 ms on mid-tier Android over 4G); KB is a guardrail, not the goal._ |
| Server Actions           | Allowed for mutations from forms; each one re-validates its input with the same Zod schema and re-checks authorization. The client is never trusted because it is "our own" code                                                                                                                                                                                                                        |

**No prop-drilling**, in this order: (1) **composition** — pass `children`/slots instead of data; (2) **React Context** only for ambient, rarely-changing values (theme, locale, session, jurisdiction, feature flags); (3) **TanStack Query** for all server state. Context is never a cache and never holds server data. More than **two** pass-through levels fails review.

**State placement:** URL first (filters, tabs, pagination — shareable and back-button-correct), then server state in TanStack Query, then local `useState`. A global client store is not in the stack; adding one needs an ADR.

## 9. Testing

Vitest for units, Testing Library for component behaviour, Playwright for the ≤25 E2E specs ([`13`](13-engineering-standards.md) §4). Component tests assert **behaviour and accessible roles**, never implementation details or class names; a component with no logic gets no test. NestJS use-cases are tested against a real Postgres via testcontainers with the module's own restricted role — mocking the repository proves nothing about a constraint. `packages/contracts` tests are the ones that matter most: every schema has a round-trip test and a rejection table of malformed input.
