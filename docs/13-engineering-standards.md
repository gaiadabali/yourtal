# YourTal — Engineering Standards

**Date:** 2026-09-18 · **Status:** Binding. Every rule here is enforced by CI or deleted from this document.
**Companions:** [`13a-go-standards.md`](13a-go-standards.md) · [`13b-typescript-standards.md`](13b-typescript-standards.md) · stack is locked in [`15-stack-locked.md`](15-stack-locked.md) · security controls in [`14-security-engineering.md`](14-security-engineering.md).

Three rules govern the rest. **(1)** A standard that is not mechanically enforced is a preference — every section names the tool and the config key. **(2)** Follow the ecosystem: where Go, TypeScript, React or Stripe have a convention we take theirs verbatim, and local invention needs an ADR. **(3)** 300 lines is the file ceiling — a forcing function for decomposition, not a formatting rule. This document obeys it.

## 1. The 300-line rule

No source file exceeds **300 lines**, comments and blanks included. Warn at 250.

| Language       | Tool                                                                                                                  | Config                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| TS/TSX         | ESLint [`max-lines`](https://eslint.org/docs/latest/rules/max-lines)                                                  | `["error", {max: 300, skipBlankLines: false, skipComments: false}]`        |
| TS/TSX         | ESLint `max-lines-per-function`                                                                                       | `["error", {max: 80}]` — the real smell is usually one giant function      |
| Go             | `golangci-lint` → `revive` [`file-length-limit`](https://github.com/mgechev/revive/blob/master/RULES_DESCRIPTIONS.md) | `arguments: [{ max: 300, skip-comments: false, skip-blank-lines: false }]` |
| Go             | `golangci-lint` → `funlen`                                                                                            | `lines: 80, statements: 50`                                                |
| SQL/YAML/other | `scripts/check-file-length.sh`                                                                                        | Same 300, same exemption list                                              |

**Exemptions** live in one place — `tools/file-length-exemptions.txt` — and adding a line needs a reviewer. The complete list: generated code (`**/*.gen.ts`, `**/*_gen.go`, `packages/contracts/generated/**`, everything `sqlc` emits); Atlas migrations, which are immutable once merged; data not logic (`**/testdata/**`, `**/__fixtures__/**`, SQL schema dumps); Drizzle table definitions in `packages/db/src/schema/*.ts`, still split one file per Postgres schema; lockfiles. **Test files are not exempt** — a 600-line test file is a missing subtest split or a missing fixture builder.

**Why files get long, and the move for each.** A limit without a refactor vocabulary just gets `// eslint-disable`d. Name the move in the PR description.

| Symptom                                               | Move                                            | Concretely                                                                                              |
| ----------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Component renders 4 visual regions                    | **Extract subcomponent**                        | `campaign-card/` folder: `campaign-card.tsx` + `campaign-card-header.tsx` + `campaign-card-rewards.tsx` |
| 3+ `useState` plus an effect                          | **Extract hook**                                | `use-campaign-card.ts` alongside; the component becomes markup                                          |
| Long `switch` on a type field                         | **Table lookup**                                | `const handlers: Record<EventType, Handler>` — one line per entry, handlers in their own files          |
| Handler does parse → authz → compute → persist → emit | **Extract the middle**                          | Handler keeps orchestration; the compute step becomes a pure, independently testable function           |
| Long const blocks, variants, copy                     | **Colocate siblings**                           | `*.variants.ts` (cva), `*.constants.ts`, `*.types.ts` — once each passes ~30 lines                      |
| Go file with 5 methods on one struct                  | **Split by responsibility, not alphabetically** | `ledger.go` (type + constructor), `ledger_transfer.go`, `ledger_query.go`, `ledger_invariants.go`       |
| NestJS service doing 6 use-cases                      | **One use-case per file**                       | `campaign/application/publish-campaign.ts`; the service becomes a thin façade                           |
| One file holds three unrelated types                  | **Split the package/module**                    | Types that don't share state don't share a file                                                         |
| God service / manager                                 | **Extract a collaborator + interface**          | In Go the interface goes in the _consumer_ ([`13a`](13a-go-standards.md))                               |

**Anti-patterns:** hitting 299 by deleting comments; splitting a cohesive unit into `part-a`/`part-b`; a `utils` file that becomes a landfill. A split that makes the code harder to follow is a failed split — restructure instead.

## 2. Reusable component architecture

| Layer             | Lives in                          | Knows about                                                             | Example                                                                |
| ----------------- | --------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **1. Primitive**  | `packages/ui/src/<name>/`         | Nothing — no domain types, no fetching, no router                       | `Button`, `Sheet`, `Input`, `Skeleton` (Radix, shadcn-style, vendored) |
| **2. Composed**   | `packages/ui/src/<name>/`         | Other primitives only; still domain-free                                | `DataTable`, `ConfirmDialog`, `EmptyState`, `MoneyInput`               |
| **3. Feature**    | `apps/web/src/features/<domain>/` | Domain types from `@yourtal/contracts`; may fetch, may use hooks        | `CampaignCard`, `RedemptionScanner`, `PointsBalance`                   |
| **4. Page/route** | `apps/web/src/app/**`             | Composition, data loading, layout — **no JSX logic beyond arrangement** | `app/(user)/campaign/[id]/page.tsx`                                    |

**Dependency direction is strictly downward.** `packages/ui` never imports from `apps/`, never imports `@yourtal/contracts`, and holds no `"use client"` file that touches the network. A component needing a domain type belongs in layer 3. Packages expose **subpath exports** (`@yourtal/ui/button`), never a barrel — see [`13b`](13b-typescript-standards.md) §5.

**Extract when any of these holds** — not merely because a file is long: (1) **third use** — two usages are a coincidence, and duplication is cheaper than the wrong abstraction; (2) it owns **its own state machine** (open/closed, step, optimistic pending); (3) it is **independently testable and meaningful** — you can write its test without naming the parent; (4) it creates a **render boundary** you want (memoization, Suspense, error boundary, `"use client"` island). Promote layer 3 → 2 only when a _second surface_ needs it, and only after stripping domain types. Premature promotion is how a `ui` package becomes a landfill of one-off props.

**Compound components.** Anything with more than ~4 props configuring _layout_ rather than _behaviour_ becomes compound, with **flat named exports**, shadcn-style: `<Card><CardHeader><CardTitle/></CardHeader><CardContent/></Card>`. Shared state goes through a private Context inside the component folder. **No dot-notation statics** (`Card.Header`) — static properties on function components defeat tree-shaking and complicate the RSC boundary.

**Staying under 300 lines**, in the order things get extracted:

```
features/campaign/campaign-card/
├── campaign-card.tsx          markup + composition (≤150 lines)
├── use-campaign-card.ts       state, handlers, derived data
├── campaign-card-rewards.tsx  a visual region with its own logic
├── campaign-card.variants.ts  cva variants
└── campaign-card.test.tsx
```

Markup and logic stop sharing a file once the logic passes ~40 lines. Variants, constants and long types move to siblings at ~30 lines each. A subcomponent used by exactly one parent stays **inside that folder** — colocation beats a global `components/` directory.

## 3. Module boundaries

Six deployables ([`15`](15-stack-locked.md)); inside each, one folder per domain module. Every module owns a Postgres schema, a published interface, and nothing else is reachable.

| #   | Rule                                                                                                 | Enforced by                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | No import of another module's internals — only its published interface                               | TS: [`eslint-plugin-boundaries`](https://github.com/javierbrea/eslint-plugin-boundaries). Go: `depguard` path rules in `.golangci.yml`                                                                                                         |
| 2   | **No cross-module table reads. Ever.**                                                               | **Database grants, not lint.** Each module connects as its own Postgres role with `USAGE` on its own schema only, so a cross-schema query fails with a permission error in dev, not a surprise in prod ([`14`](14-security-engineering.md) §8) |
| 3   | No shared mutable in-process state between modules                                                   | Review — a module receives only its own dependencies                                                                                                                                                                                           |
| 4   | Cross-module calls are synchronous through the interface, or asynchronous via a pg-boss domain event | ADR required to add a third mechanism                                                                                                                                                                                                          |
| 5   | `packages/contracts` may be imported by everyone and imports nothing but `zod`                       | `eslint-plugin-boundaries` + `knip`                                                                                                                                                                                                            |
| 6   | Raw SQL outside `sqlc`/Drizzle builders is banned outside one allowlisted, reviewed file             | ESLint + `forbidigo` ([`14`](14-security-engineering.md) §5)                                                                                                                                                                                   |

```js
// eslint.config.js — note the capture: a feature may import its OWN domain's siblings only
settings: { "boundaries/elements": [
  { type: "contracts", pattern: "packages/contracts/**" }, { type: "ui", pattern: "packages/ui/**" },
  { type: "feature", pattern: "apps/web/src/features/*", capture: ["domain"] },
  { type: "module",  pattern: "apps/api/src/modules/*",  capture: ["domain"] },
  { type: "app", pattern: "apps/web/src/app/**" } ]},
rules: { "boundaries/element-types": ["error", { default: "disallow", rules: [
  { from: "ui",      allow: ["ui"] },
  { from: "feature", allow: ["contracts", "ui", ["feature", { domain: "${from.domain}" }]] },
  { from: "module",  allow: ["contracts", ["module", { domain: "${from.domain}" }]] },
  { from: "app",     allow: ["contracts", "ui", "feature"] } ]}]}
```

Cross-module reuse goes through `packages/ui` or `packages/contracts`, never sideways. **A published module interface** is one file at the module root, under 150 lines, containing only the interface, its DTOs and its sentinel errors — no DB rows, no ORM types, no transaction handles. Its signature is identical before and after the module becomes a network service; that is the entire point of the seam. Go form in [`13a`](13a-go-standards.md) §6, NestJS form in [`13b`](13b-typescript-standards.md) §7.

## 4. Testing strategy

**Seam tests are mandatory where two routes hand off.** Each route's own suite can pass while the handoff between them is broken — Phase U shipped a checkpoint route that crashed on any non-uuid campaign id _after the user had watched the whole video_, and both routes' suites were green. Every place one surface passes state to another gets an agreement test named `<a>-<b>-agreement.test.ts`, and it is sabotage-tested: break the producer, prove the test fails.

**A shared constant is a seam too — this is the second instance, and it was worse than the first.** YT-0405 built the region cookie _reader_; YT-0430 built the _writer_. Until the writer existed every screen silently fell back to a hardcoded default, and the **cookie name was a string literal in both features**. Had the two literals drifted, nothing would throw: an Australian user would simply see Rupiah, with every test in both features still green.

So: **any identifier two features must agree on — a cookie name, a storage key, a header, an event name, a hash input — has exactly one definition, and a round-trip test that exercises a non-default value.** Testing the default proves nothing, because the default is what a broken system falls back to. The region test resolves `"AU"` specifically for that reason.

Not one pyramid: a **pyramid in the value path, a testing trophy in the web app**.

| Layer           | Target                | Scope                                                                                                                                                                                                                                                       |
| --------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit (pure)** | ~60% of tests         | Ledger invariants, pricing arithmetic, earn rules, accrual state machine, Zod refinements. No I/O                                                                                                                                                           |
| **Integration** | ~30%                  | `testcontainers-go` / Vitest against **real Postgres 16 with real Atlas migrations**: transactions, constraints, idempotency, concurrent transfers, role grants. Real Redis for holds and locks. **No sqlmock, no in-memory fake, ever, in the value path** |
| **Contract**    | thin, mandatory       | [Pact](https://docs.pact.io/) (`pact-js` consumer / `pact-go` provider) across the six deployables' seams and the sister-app SDKs; `can-i-deploy` gates release. Generated-client drift against `packages/contracts` also fails CI                          |
| **E2E**         | ≤ 25 specs            | Playwright, below                                                                                                                                                                                                                                           |
| **Mutation**    | quarterly, not per-PR | `gremlins` on the ledger and pricing packages; StrykerJS on `packages/contracts` money helpers                                                                                                                                                              |

**Must have tests** — blocking, no "follow-up ticket": **ledger** (double-entry balance, append-only enforcement, idempotency replay, concurrent-transfer serialization, hash-chain continuity); **pricing** (`points_price = (S / B) × demand_multiplier`, multiplier bounds, price-lock expiry, rounding direction _proven_ to favour the platform); **solvency** (`Reserve / (points × B) ≥ 1.0`, and that unfunded issuance is blocked); **redemption network** (authorize/capture/void/refund state machine, hold expiry, HMAC verification, replay rejection, enumeration defence); **reward engine** (caps, velocity limits, risk-gate rejection); **watch session** (checkpoint accrual, resume correctness, no double-credit on retry); **idempotency middleware** (same key + same body replays, same key + different body rejects); **object-level authz** against Cerbos ([`14`](14-security-engineering.md) §5); and **every money/points rounding site** — rounding bugs are the cheapest way to lose real money. Every value-path bug fix ships with a regression test citing the incident ID.

**Coverage policy, honest version.** Global coverage percentages are a [known-poor target](https://martinfowler.com/bliki/TestCoverage.html), and Google's own guidance treats coverage as [a signal, not a goal](https://testing.googleblog.com/2020/08/code-coverage-best-practices.html). So: the ledger, pricing, voucher/redemption and idempotency packages are **hard-gated at 90% line coverage and 100% of branches in invariant checks**; everything else is **reported and never gated**; React components have no coverage target at all (behaviour tests via Testing Library where there is logic, none for pure markup); diff coverage is an informational PR comment — a reviewer may demand tests, a bot may not. **Explicitly rejected:** a repo-wide 80% gate. It manufactures assertion-free tests that execute code to colour a report, and makes reviewers argue about a number instead of the risk.

**Playwright scope** — only journeys where failure costs money or trust, against an ephemeral seeded environment: earn → checkpoint → points credited · store purchase → points burn → voucher issued · **merchant scan → redemption → settlement** · advertiser campaign create → fund → publish · OIDC login from a sister app via Zitadel · offline voucher QR with the network disabled. Everything else is a unit or integration test. The 25-spec cap is a budget: delete before adding.

## 5. API conventions

REST + OpenAPI 3.1 generated from Zod, aligned with [Stripe's API](https://docs.stripe.com/api) deliberately and almost verbatim — it is the best-documented convention set in payments and our merchants' developers already know it.

| Concern    | Rule                                                                                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resources  | Plural `snake_case` nouns: `/v1/point_transfers`, `/v1/voucher_batches`, `/v1/watch_sessions`. Nouns only; actions are sub-resources: `POST /v1/redemptions/{id}/capture`                                            |
| Fields     | `snake_case` on the wire; Go struct tags and generated TS types handle the rest                                                                                                                                      |
| IDs        | Opaque and prefixed, Stripe-style: `led_txn_01J…`, `vch_…`, `rdm_…`, `cmp_…`. ULID inside. Never expose a bigint PK                                                                                                  |
| Versioning | `/v1/` is permanent. Breaking changes ship as **dated versions** via a `YourTal-Version: 2026-09-18` header, pinned per account at first call; additive changes are unversioned. 12-month minimum deprecation window |
| Money      | Integer **minor units** + `currency`: `{"amount": 150000, "currency": "idr"}`. Points are integers with no currency. No floats on the wire, ever                                                                     |
| Timestamps | **RFC 3339 UTC strings** — a deliberate deviation from Stripe's Unix integers; two jurisdictions and readable audit logs beat convention here                                                                        |
| Expansion  | `?expand[]=merchant`, one level, as Stripe. No arbitrary nesting                                                                                                                                                     |

**Error envelope** — one shape, every endpoint, every status ≥ 400:

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "insufficient_points",
    "param": "amount",
    "message": "Balance 120 is below the required 500.",
    "request_id": "req_01J…",
    "doc_url": "https://docs.yourtal.com/errors/insufficient_points"
  }
}
```

`type` ∈ `api_error | invalid_request_error | authentication_error | permission_error | rate_limit_error | idempotency_error | value_error`. `code` is a stable machine string **never reused for a second meaning** — codes are append-only and live in `packages/contracts`. `message` is human-readable, safe to log, and never carries PII or a raw SQL error. Note that no endpoint answers "is this voucher valid" without moving value ([`14`](14-security-engineering.md) §6).

**Idempotency** is mandatory on every `POST` that moves value (transfers, redemptions, purchases, payouts): an `Idempotency-Key` header holding a client-generated UUIDv7. The server stores key + request-body hash + status + response for **24 hours**. Replay with the same body returns the original response plus `Idempotent-Replay: true`; the same key with a different body returns `409 idempotency_error`; a concurrent in-flight request on the same key returns `409`; a missing header on a value endpoint returns `400`.

**Pagination is cursor-only.** `GET /v1/point_transfers?limit=20&starting_after=led_txn_01J…` → `{"object": "list", "data": [...], "has_more": true, "url": "/v1/point_transfers"}`. `limit` defaults to 20, caps at 100. Offset pagination is banned outright: against an append-only ledger under concurrent writes it silently skips and duplicates rows.

## 6. Git and review

| Concern    | Rule                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branching  | Trunk-based, short-lived branches off `main` named `<type>/<scope>-<slug>` (`feat/ledger-hash-chain`). Nothing lives longer than **3 days**                                                                                                                                                                                           |
| Commits    | [Conventional Commits](https://www.conventionalcommits.org/) 1.0.0, enforced by `commitlint` on a `commit-msg` hook and again in CI. Scope is the module: `feat(ledger):`, `fix(redemption):`                                                                                                                                         |
| Merge      | **Squash only.** The PR title becomes the conventional commit; `main` stays linear and every commit is releasable. `changesets` handles package versions                                                                                                                                                                              |
| PR size    | **Target ≤ 400 lines changed, hard cap 800** (generated files and lockfiles excluded). Defect detection collapses past roughly 400 LOC, and [review latency drives everything else](https://google.github.io/eng-practices/review/reviewer/speed.html). A bot comments at 400, blocks at 800                                          |
| Review SLA | First response within **one working day**. A stale PR is a merge-conflict factory                                                                                                                                                                                                                                                     |
| Approvals  | **One** reviewer by default. **Two, one a CODEOWNER,** for `services/{ledger,voucher,watch}/**`, `packages/db/migrations/**`, auth and authorization, idempotency middleware, `.github/workflows/**`, `infra/**`, any new dependency in a value-zone service ([`14`](14-security-engineering.md) §7), and any change to this document |
| CODEOWNERS | Required for every top-level path: `services/ledger/ @yourtal/value-path`, `packages/ui/ @yourtal/design-system`, `infra/ @yourtal/platform`, `docs/adr/ @yourtal/tech-leads`                                                                                                                                                         |
| Force-push | Fine on your own branch before review; never after an approval; never to `main` (branch protection)                                                                                                                                                                                                                                   |

Review comments use conventional prefixes — `blocking:`, `suggestion:`, `question:`, `nit:` — so an author can tell a preference from a defect.

## 7. CI gates

Every check blocks merge unless marked otherwise. Turborepo caching keeps the PR pipeline under **10 minutes**; anything slower moves to row 19.

| #   | Gate                    | Tool / command                                                                                                                                                                               |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Format                  | `prettier --check` · `gofumpt -l` (non-empty output fails)                                                                                                                                   |
| 2   | Lint (TS, type-aware)   | `eslint --max-warnings=0 --report-unused-disable-directives`                                                                                                                                 |
| 3   | Lint (Go)               | `golangci-lint run` with the [`13a`](13a-go-standards.md) §8 config                                                                                                                          |
| 4   | Types                   | `tsc --noEmit` across every package · `go vet ./...`                                                                                                                                         |
| 5   | **File length**         | Gates 2 and 3 (`max-lines`, `revive:file-length-limit`) + `scripts/check-file-length.sh` for everything else                                                                                 |
| 6   | Dead code               | `knip` — unused files, exports, dependencies                                                                                                                                                 |
| 7   | Contract drift          | `sqlc diff` · Zod → OpenAPI → TS/Go regeneration must produce no diff                                                                                                                        |
| 8   | Unit + integration      | `vitest run` · `go test -race -shuffle=on ./...` (testcontainers)                                                                                                                            |
| 9   | Value-path coverage     | `go test -coverprofile`, gated at 90% on the §4 package list                                                                                                                                 |
| 10  | Contract tests          | Pact consumer publish + provider verify + `pact-broker can-i-deploy`                                                                                                                         |
| 11  | Migration safety        | `atlas migrate lint --latest` — blocks destructive and data-dependent changes; a non-`CONCURRENTLY` index build or a `NOT NULL` without default needs an expand/contract plan in the PR body |
| 12  | Bundle size             | [`size-limit`](https://github.com/ai/size-limit) against the ≤170 KB gz initial-JS budget from [`10`](10-tech-stack.md) §2.1                                                                 |
| 13  | Web vitals              | `@lhci/cli` against LCP ≤ 2.0s, INP ≤ 200ms, CLS ≤ 0.1 on the mobile throttling profile                                                                                                      |
| 14  | Secret scanning         | `gitleaks` (full history) + GitHub push protection. A hit fails the build **and** triggers rotation                                                                                          |
| 15  | SAST                    | `semgrep` on the diff; CodeQL nightly ([`14`](14-security-engineering.md) §9)                                                                                                                |
| 16  | Dependencies            | Lockfile-only installs with `--ignore-scripts`; `trivy` fails on HIGH/CRITICAL with a known fix; Renovate 7-day cooldown ([`14`](14-security-engineering.md) §7)                             |
| 17  | SBOM + provenance       | `syft` → **CycloneDX** attestation per artifact; SLSA provenance verified at deploy                                                                                                          |
| 18  | IaC                     | `terraform validate` + `checkov`; plan posted to the PR                                                                                                                                      |
| 19  | E2E (`main` + release)  | Playwright against an ephemeral seeded environment                                                                                                                                           |
| 20  | _Nightly, non-blocking_ | Mutation tests, full Lighthouse suite, `go test -count=10` flake hunt, DAST against staging, base-image rescan                                                                               |

**No gate is bypassed by a re-run.** Admin override requires an incident ticket and is logged.

## 8. Documentation in code

**ADRs use [MADR 4.0](https://adr.github.io/madr/)** at `docs/adr/NNNN-kebab-title.md`, numbers never reused, status `Proposed → Accepted → Superseded by NNNN`. One page — context, decision, consequences, alternatives rejected — and **immutable once accepted**: you supersede it, you do not edit it. Anything already locked in [`15`](15-stack-locked.md) has its reasoning in [`10`](10-tech-stack.md) and needs no retrospective ADR; changing it does.

| Needs an ADR                                                      | Does not                                       |
| ----------------------------------------------------------------- | ---------------------------------------------- |
| Adding a language, datastore, queue or paid vendor                | Choosing a library inside an existing category |
| Changing a module boundary or splitting a deployable              | Adding a route or a table inside a module      |
| Anything touching ledger semantics, money rounding or idempotency | Refactoring inside a module                    |
| Auth, authorization or data-residency changes                     | Copy, styling, component extraction            |
| Deviating from this document or from [`15`](15-stack-locked.md)   | Following them                                 |

**Doc comments.** In Go, every exported identifier has a doc comment starting with its own name (`revive:exported`), and every module has a `doc.go` stating its responsibility and published interface. In TypeScript, TSDoc on every export of `packages/contracts`, `packages/ui` and the SDKs — read by people who cannot read the implementation — while internal app code needs no ceremony. **Comments explain _why_**: one restating the code gets deleted in review, and non-obvious invariants, regulatory constraints and "this looks wrong but isn't" cases are exactly what they are for, especially in the ledger. `// TODO(handle, YT-0123): …` is the only accepted TODO form and is linted; a TODO without a task ID is deleted. Every Postgres schema carries a `README.md` naming its owning module, its invariants, and the roles granted on it.

**The short version:** 300-line files enforced by `max-lines` and `revive:file-length-limit`; module boundaries enforced by lint _and_ Postgres grants; no cross-module table reads; no barrel files; Server Components by default; tests mandatory and coverage-gated only where value moves; Stripe's API conventions verbatim; two reviewers on anything that touches money.

## Generated code: two constraints that bind every service

**1. Integer width is never implicit.** A bare `{"type":"integer"}` in JSON Schema carries no width, and generators default to **int32** (~2.1bn). Our IDR and Points schemas permit **10,000,000,000 in the schema's declared unit** — already ~4.7× over int32, and ~470× over it if that unit becomes sen (see the open decision in `docs/16`). `FaceValueIdr int32` would have silently truncated a legitimate Rupiah amount in the first Go value-zone service, inside a file headed _DO NOT EDIT_. **The int64 requirement holds under either reading; only the magnitude of the overflow changes.** **Every integer exceeding int32 carries `format: "int64"`, and a test fails if one slips through.** Found in YT-0031 before any Go service existed.

**2. The OpenAPI document is permanently a weaker contract than the Zod schemas.** JSON Schema cannot express cross-field rules, so `.refine()` vanishes silently into the generated document, the Go types and any client. There are 12 such rules across 5 schemas — _settlementValueIdr cannot exceed faceValueIdr_, _expiringPoints cannot exceed availablePoints_, and so on. These are **economic invariants**, not cosmetic validation.

This is not fixable, so it is contained: each rule is declared as prose in the registry, emitted into the component description so it reaches generated Go as a doc comment, and a test asserts the declared count matches the actual refinement count — adding a `.refine()` without documenting it fails CI.

**The consequence for the stack:** any service enforcing a cross-field rule must **run Zod, or re-implement the rule and test it**. Generated types alone are not enough. This falls hardest on exactly the Go services in `docs/15` — ledger, pricing, voucher, redemption — because they hold the invariants that matter most. Budget for re-implementation with tests in each, and treat a Go service that trusts generated types for validation as a defect.

**3. Canonicalisation is one idea, pinned by a test.** Any value the platform hashes or signs across a language boundary — the idempotency fingerprint, the merchant HMAC request, the voucher QR payload — uses **one** canonical shape, and a test pins the **exact hex digest** rather than merely asserting the function is stable. These are wire contracts: a Go service computing the fingerprint differently from the TypeScript one makes a legitimate retry look like a mismatch, and a correct client is told to fix a correct request. Hash **raw bytes**, not canonical JSON — stricter than necessary, never wrong, and it sidesteps canonical-JSON, which is a notorious source of cross-language disagreement.

**Policies are the source of truth for what an action requires — not the ticket, and not the brief.** A screen must never offer an action the policy would refuse, and must never **fabricate a step the policy does not require**. Both are the same defect seen from opposite sides. This has already been caught once: a brief asked for a two-person-approval flow on the Team screen, and `policies/` has no such rule — dual approval is scoped to bulk voucher issuance, material settlement-value decreases and credential rotation, none of which are `team` actions. The implementation checked, found the brief wrong, stated the real position and pointed at where dual approval actually lives. **When a brief and a policy disagree, the policy wins and the brief gets fixed.**

**A fixture can describe a world that cannot exist; a database cannot.** Seeding the _same_ generators into real Postgres (YT-0519) immediately exposed that `generateVoucher` invented a `listingId`, a `merchantId` and a face value with **no relation to any listing** — because nothing in an in-process fixture requires them to agree. Inserted as-is they violated the foreign key. Had they somehow not, the result would have been worse: a voucher for listing L, issued by a different merchant, at a face value that listing never offered — **a state no real flow can reach, and the first person to debug against one loses a day.**

So a seed **derives** dependent records from the records actually inserted, and asserts the agreement. Beyond exercising the real path, seeding into a real schema **proves the fixtures were describing a reachable world in the first place** — which is a stronger guarantee than any fixture test can offer.

## A suite that silently skips is worse than one that fails

Until 2026-09-19, **no workflow ran a single Postgres-backed test.** `packages/db`, the Postgres idempotency store and the Go ledger all skip or fail without a database — so the deferred balance trigger, one-of-eight concurrent claims winning, and an unbalanced transfer refused at COMMIT were all **green in CI by never running**. Every one of those is a guarantee the plan rests on, and CI was reporting success for work it had not done.

**A failing suite tells you something is wrong. A skipping suite tells you nothing while looking like it told you something good.** So: every integration suite runs against real service containers in CI, and the workflow **fails the build if any test reports SKIP** — suites cannot quietly opt out of the thing they exist to prove.

The generalisation: **a test that cannot run in CI is documentation, not verification.** If a guarantee matters, the environment that proves it belongs in the pipeline, not on one developer's machine.

**Serialisation failures are worst when the database is emptiest — a fresh-database load test is harsher than production.** The ledger's balance trigger reads `ledger.entry WHERE transfer_id = …` at COMMIT, and under SERIALIZABLE that takes a **page-granular** SIRead predicate lock. While the table and its index are small, every transfer's read lands on the **same index page**, so each conflicts with every other despite touching entirely different transfers. Contention falls as the table grows.

Two consequences. **A developer meets this before an operator does**, and will reasonably conclude the design is broken when it is not. And **retry jitter matters more than the backoff growth**: without it every conflicting writer wakes at the same instant and collides again, turning contention into a thundering herd. Retrying is only safe because the transaction is idempotent end to end — which is the actual precondition, not the retry policy.

**The general class: a process that did less than it claims, reporting the same result as one that did everything.** A test suite that silently skips and a deletion that silently omits three of nine domains are the same defect wearing different clothes — and in both cases the honest implementation is _harder to write and reports worse news_. That is exactly why the tempting version wins by default.

**The rule: partial completion is a distinct outcome from success, and it names what was not done and who owes it.** Never a boolean where a report belongs. And distinguish **not implemented** from **failed** — they send different people looking.

**Never store a value you can derive — it is a second source of truth, and when the two disagree the derivation is right and the stored copy is the bug.** This has now decided three designs independently: `Balance` is a projection over entries rather than a column; a point purchase records **points allocated** and **cash received** as two facts with **no price-per-point column** between them; and where a duplicate is genuinely unavoidable — sqlc needs its own `db/schema.sql` copy — it carries a **drift test** that fails naming the exact columns.

The rule, in order of preference: **derive it; if you cannot, guard the copy with a drift test; never leave an unguarded duplicate.** The tell is that the stored version is always the one that looks like a convenience.

## Two agents, one working tree

Running two streams concurrently in a single checkout **cost a verification, not just time**. The frontend stream could not re-run the 320px and 200%-zoom suites because a partial `packages/contracts` change from the backend stream was live on disk: `tsc` failed on files the frontend had never touched, and a half-written `.next` from the failed build destroyed the good one from the successful build minutes earlier.

Note what the damage actually was. No code was lost and no wrong code shipped — what was lost was **the ability to prove something**, and it was lost silently: the failure surfaced as a type error in someone else's feature, which reads like a regression rather than like contention.

**The rule:** parallel streams may share a tree only while they share no build. The moment one owns a package the other compiles against — `packages/contracts` is exactly that package here — they need separate worktrees, or the second stream needs to be told to verify _before_ the first starts rather than after.

**The tell:** a build that succeeded and then failed with no diff of your own in between. That is never flakiness. Check `git status` on the packages you consume before you conclude anything about your own change.

**And the same rule applies to `git add -A`.** Committing a shared tree stages whatever another stream happens to have half-written, so the message describes one change and the commit contains several — including work that does not build yet. Stage your own paths. This was learned by doing it: a commit labelled as a one-file ticket carried a partial currency migration, and the honest repair is to amend the message to say so rather than to rewrite the history into something tidier than the truth.

## A seeded generator is idempotent only for a fixed contract

Adding one property to a schema changed **every id below it**. The mock generators draw from a seeded faker in field order, so an inserted field shifts every subsequent draw — every downstream uuid becomes a different uuid. `ON CONFLICT DO NOTHING` then conflicts with nothing and inserts a whole second catalogue: 30 listings became 60.

**That is not idempotency failing. It is idempotency working perfectly on data that is no longer the same data** — the keys really are new. Which is why it is dangerous: the mechanism is behaving correctly and the outcome is still wrong, so the instinct to go and debug the upsert leads nowhere.

The guarantee a seeded generator actually offers is **"idempotent for a fixed contract"**. After any contract change the supported path is a reset (`pnpm dev:fresh`), not a re-seed (`pnpm db:seed`).

A corollary about partially-working commands: `pnpm dev:fresh` had never worked — the seed read `process.env.DATABASE_URL` and pnpm does not load `.env`, so migrations applied and the seed then failed. **A documented command that completes two of its three steps is worse than one that does not exist**, because it leaves a half-built state that looks deliberate.

## Two constraints worth copying

Both came out of the ledger proof work and generalise:

- **Make the bad state unrepresentable rather than validated.** A voucher names a branch; a composite foreign key `(listing_id, location_id)` → `listing_location` means it cannot name a branch its own listing does not serve. A jsonb column would have matched the Zod shape more directly and bought nothing. The failure being prevented is a customer sent to a shop that has never heard of the offer.
- **Do not offer the degraded mode as a constructor option.** The invariant checker takes an `Alerter` as a required argument, so there is no way to build one that can only log — because the version that can only log is the version that ships. The placeholder is named `LoggingAlerter`, for what it is, and carries the warning: _a pager that cannot fail is a pager that cannot tell you it did not reach anyone._
