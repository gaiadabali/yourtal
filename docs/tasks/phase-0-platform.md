# Phase 0 · Platform

> Platform services for Phase 0. Legal and infrastructure are in [`phase-0-foundation.md`](phase-0-foundation.md).

## Platform

### YT-0030 · Monorepo skeleton
`doing` · P0 · platform · 3d · dep: —

- **Audited against the tree 2026-09-19: mostly built, never recorded.** It sat at `todo` while blocking three tasks that its own deliverable already satisfies — the graph looked more blocked than the repo was
- [x] pnpm workspaces + Turborepo; `apps/web`, `apps/api`, `services/*`, `packages/*` — all present and building
- [ ] ⚠️ **Module-boundary lint rule — genuinely missing.** `eslint-rules/` holds only `must-use-result.mjs` and `eslint.config.mjs` declares no boundary rule, so a cross-module import fails nothing today. **About an hour of work, and it unblocks three tasks** — the cheapest item on the board

### YT-0031 · Contracts package and codegen
`review` · P0 · platform · 4d · dep: YT-0030

- [x] Zod schemas are the single source of truth; OpenAPI 3.1 generated — 17 components with proper `$ref`s. **TS client deliberately not generated**: `paths` is empty so there is nothing to generate, and TS types already derive from the schemas via `z.infer` per `docs/13b` §3, which satisfies the AC's intent. openapi-generator's `typescript-fetch` was tried and rejected — it emits `[key: string]: any` index signatures that make everything assignable and that our own lint rejects. Generate a real client with **openapi-typescript** once endpoints exist
- [x] Go types generated from the same OpenAPI document — 24 files, `go build` and `go vet` clean in a golang:1.25 container
- [x] Drift fails CI — three gates: document drift, Go drift, and Go compiles
- [x] **Money widths pinned to `int64`** — 175 tests passing, 6 money fields marked. See the two findings below

### YT-0507 · `business` and `kyb_document` resource kinds
`review` · P0 · platform · 2d · dep: YT-0035, YT-0100

- Verified: policies 375 assertions (up from 322), authz 36, api 97. **`GET /business` widened from owner+admin to all six roles — confirmed correct**, and `docs/17` §2.1 now has explicit Profile and KYB columns so it is no longer an inference. KYB stays owner+admin: director identity and tax registration are sensitive. `ops` has `approve`/`reject` on `kyb_document` but **no route calls them** — the review queue is unbuilt
- [ ] `policies/` has **no `business` resource kind** — only `team` (roster) and `billing` (spend), so "edit a business's own profile" has no policy to ask
- [ ] KYB submit/list currently borrow **`team:view`** as a proxy. It is a tested action rather than an invented one, but not a designed fit — and `team:view` is owner/admin-only, so marketer, finance and analyst cannot see the business profile or KYB, which is likely narrower than intended
- [ ] Add both kinds with actions designed against `docs/17` §2.1, and repoint `apps/api`
- The agent correctly declined to invent an action rather than guess at the policy model

### YT-0508 · Promote business shapes into contracts
`review` · P0 · platform · 2d · dep: YT-0031, YT-0100

- Verified: contracts 215 tests, OpenAPI and Go regenerated, Go builds and vets clean
- [ ] `@yourtal/contracts/business` has no shape for **members, billing contact or KYB documents**; all three were modelled locally inside `apps/api`
- [ ] Promote them, mirroring `apps/api/src/modules/business/domain/*.ts`, which were designed against `docs/17` directly
- [ ] Required before the advertiser console (YT-0440+) can share the types

### YT-0512 · `apps/web` imports an undeclared package
`review` · P0 · web · 1h · dep: YT-0509

- [x] Already fixed on disk; the tracker was stale. `apps/web` imports `BusinessTeamRole` from `@yourtal/contracts/business/team-role`, and the file this ticket blamed for a syntax error **does not exist**
- [ ] Six files under `apps/web/features/console/` import `@yourtal/authz`, which **`apps/web/package.json` has never declared** — absent from every commit, and `.npmrc` hoists only eslint and prettier, so the specifier was never resolvable
- [ ] **Not caused by YT-0509.** The files are untracked, so they never passed through CI; authz was never an `apps/web` dependency at any commit
- [ ] **Fix: import `BusinessTeamRole` from `@yourtal/contracts/business/team-role`**, which `apps/web` already depends on — exactly what YT-0509 made possible. Adding an `authz` dependency to a web app would be the worse fix
- [ ] Separately, `features/onboarding/onboarding-region-derived.ts` currently has syntax errors (unterminated template literal) — in-flight, not related

### YT-0509 · Invert the contracts → authz dependency
`review` · P0 · platform · 1d · dep: YT-0508

- [x] Done as specified: `businessTeamRoleSchema` moved to contracts, authz imports it and **keeps its drift test against `principal.json`** — 36/36, so the Cerbos guarantee survived the move. `contracts` deps are now `{zod}` only. Verified acyclic
- [x] Renamed to **`businessTeamRole`** because `contracts/business.ts` already exported `businessRoleSchema` meaning advertiser/supplier/redeemer. Two concepts competing for one name is how a member record ends up with "supplier" as a job title; a test asserts the option sets never overlap
- [ ] **Drop the back-compat alias.** `@yourtal/authz/roles` re-exports under the old names so three packages did not need renaming mid-flight. Correct call then; remove once `apps/web` and `apps/api` migrate, or the alias becomes permanent
- [ ] **Architect call: invert it.** Move the six-role enum **into `packages/contracts`**; `packages/authz` imports it and **keeps its drift test against `policies/_schemas/principal.json`**
- [ ] Roles appear in API payloads (a business member carries one), so the role _vocabulary_ is a contract concern. Cerbos policy is an _implementation_ of authorization over that vocabulary
- [ ] The objection — "moving it couples contracts to the Cerbos policy repo" — only holds if the **drift test moves too. It does not.** Contracts owns the vocabulary and never learns about Cerbos; authz owns enforcement and proves its policy matches. The coupling stays in the package already coupled
- [ ] Verify no cycle and no bundle regression after the move
- Raised by the implementer, who correctly declined to refactor the spine on their own reading

### YT-0510 · Delete duplicate business shapes from `apps/api`
`review` · P0 · platform · 1h · dep: YT-0508

- [x] `apps/api/src/modules/business/domain/` deleted, 25 import sites repointed. Code lines diffed pair-by-pair first: billing-contact and kyb-document identical, business-member differed only in import path. api 97→72 tests is those 25 moving to contracts (229→258), not lost coverage
- [x] A newer doc comment on the `apps/api` copy — that `ops` has `approve`/`reject` reserved with a policy-level DENY but no route calls them — was **merged forward before deleting.** That detail would otherwise have been silently lost, which is the usual way a delete-the-duplicate task loses information
- [ ] `apps/api` holds local copies of business-member, billing-contact and kyb-document, now superseded by contracts
- [ ] Delete and re-point; two definitions of a shared shape is how they drift apart

### YT-0511 · Repo-wide formatting gate
`review` · P0 · infra · 1h · dep: —

- [x] 53 files formatted across `apps/api`, `packages/{contracts,authz,consent,jurisdiction}` and `policies/`; `.github/workflows/format.yml` added running `prettier --check .`
- [ ] ⚠️ **The gate is RED until someone runs `pnpm format` once.** `apps/web` and `packages/ui` carry ~186 unformatted files, deliberately left because rewriting them mid-change buys a merge conflict and nothing else. **Check landed, cleanup outstanding**

### YT-0528 · The remaining seven DSAR handlers
`todo` · P0 · platform · 5d · dep: YT-0036
- [ ] Two of nine domains have handlers (`anonymiseVouchers`, `eraseBusinessMemberships`). **Seven do not, so a deletion request returns `complete: false` today** — correctly, and it is a **launch blocker**
- [ ] Each service owner writes their own: the orchestrator already names the domain and the owner in the failure
- [ ] Per-domain action must match `docs/36`'s typed plan — `erase`, `anonymise` or `retain` — and a non-erasure must carry its basis
- [ ] `risk_signals` stays `retain`: erasure on request would make deletion the last step of the attack
- [ ] Ledger and audit rows stay append-only — erasing one destroys the proof that every *other* user's balance is correct


### YT-0524 · Reporting contract gaps
`todo` · P0 · platform · 3d · dep: YT-0031
- [ ] **Five advertiser metrics cannot be reported because the contracts cannot carry them.** Found by YT-0443, which showed named gap panels rather than fabricating charts
- [ ] No chapter field on a campaign, so completion-by-chapter is unreportable
- [ ] No question-response record, so accuracy and recall are unreportable
- [ ] **No `campaignId` on a voucher, so redemptions cannot be attributed to the campaign that caused them** — this is the closed-loop conversion the whole advertiser pitch rests on (`docs/18`), and it is currently unmeasurable
- [ ] Each gap closes a metric that `docs/01` sells; until then the panels stay honest

### YT-0525 · Migrate hand-built forms to React Hook Form
`review` · PU · web · 2d · dep: —
- [ ] `docs/15` locked RHF + Zod resolver, but neither was ever installed — **now installed (2026-09-19)**
- [x] Migrated the three genuine multi-field forms; Server Components and single-field forms left alone, matching this ticket’s own carve-outs
- [ ] ⚠️ **`/onboarding/[region]/consent` measured 181.1 KB gz — over the 180 KB justify line**, for React Hook Form on a three-checkbox form. Under the 200 KB hard gate, so not a failure, but it is exactly the trade `docs/13b` §8 says must be stated rather than absorbed: is RHF worth a few KB on a form this small, or should that one stay hand-built?
- [ ] ⚠️ **`phone-verification-flow.tsx` is 301 lines — one over the ceiling**, pre-existing and untouched by this work. Needs `PhoneEntryStep` / `CodeEntryStep` extracted
- [ ] The campaign builder hand-built its forms against an uninstalled lock. Migrate them
- [ ] Hand-rolled validation, error and dirty-state handling across a multi-step builder is exactly where form bugs live

### YT-0526 · Testable HLS fixture for the player
`review` · PU · web · 1d · dep: YT-0521
- [ ] YT-0412's keyboard-seeking AC is **untestable, not failing**: the shared placeholder stream's 59 MB segment aborts before the video reports a duration
- [x] ✅ **Closed for real this time, verified on disk 2026-09-20.** `use-watch-session.ts` reads `campaign.videoSource.manifestUrl` at both call sites; `features/player/video-source.ts` and `apps/web/public/media` are **deleted**, taking 9 MB and the duplicate fixture with them. The origin is now the only HLS path, so per-segment delivery logging is exercised by the real player rather than by a test alone
- ⚠️ **Correction 2026-09-20: this was reported closed and is not.** Both campaign mocks now carry a correct local manifest URL, guarded by a sabotage-tested drift test — but `use-watch-session.ts` **never reads `campaign.videoSource`**. It uses its own `MOCK_HLS_MANIFEST_URL`. The contract field carries a correct value the player ignores, which is worse than an obviously-missing one because it looks done from the contract side
- ⚠️ **Two HLS fixtures exist.** `packages/media/fixtures` (2.7 MB, 19 files, served from MinIO) and `apps/web/public/media` (9.0 MB, 28 files, served from Next). Two sessions built them in parallel, unaware, and **their file headers give the same three reasons** — multi-segment, genuinely multi-bitrate, local. Independent convergence on the design; pure waste on the artifact
- ✅ **DECIDED: the MinIO origin is canonical.** Production never serves video from `public/`, and the origin is the only one that produces **per-segment delivery logs** — the `docs/22` control that survived the web-fraud audit. A player wired to the fixture that cannot be logged means that control can never be exercised end to end, which would make YT-0521 decorative
- The `public/` copy is the duplicate that **looks like a convenience**, which `docs/13` names as the tell. It is 9 MB in git forever, and only one file references it. If a no-Docker path is genuinely wanted later it gets its own task, an owner and a drift test — not an unowned second copy
- [ ] `use-watch-session.ts` reads `campaign.videoSource.manifestUrl`; `features/player/video-source.ts` and `apps/web/public/media` are deleted in the same pass
- [ ] Player and e2e tests pass against the origin, with `pnpm dev:up` as the stated prerequisite
- [ ] Serve a small, real, multi-segment HLS fixture from the local MinIO origin (YT-0521)
- [ ] Then close YT-0412's Playwright criterion against it


### YT-0502 · Listing contract: multiple merchant locations
`review` · P0 · platform · 2d · dep: YT-0031

- [x] `listingSchema` carries a **`locations` array** (min 1), not a single `district: string` — `packages/contracts/src/listing/merchant-location.ts`
- [x] Each location has an id, name, address and district, so a voucher can name **which branch honours it** — `voucherSchema.location` (denormalised, same reasoning as `merchantName`: must stay honourable offline)
- [ ] Surfaced in the offer page, the voucher detail and the merchant redemption portal — **not done here.** That is `apps/web` (out of this seat's editable scope) and the BFF endpoint (separate ticket); this ticket lands the contract those surfaces need
- Found by Phase U (YT-0421). This is a **product gap, not a UI gap**: a multi-branch merchant can currently show only one outlet, and which branch honours a voucher is load-bearing for redemption and for disputes
- **Breaking change to `apps/web`**, flagged per CLAUDE.md: 9 files read `.district` directly (`store-facets.ts`, `store-listing-card.tsx`, `store-offer-card.tsx`, `public-merchant.ts`, `public-merchant-content.tsx`, `public-offer-content.tsx`, `console-header.tsx`, `opengraph-image.tsx`, `public-merchant.test.ts`) and will fail to compile against the new shape until the UI stream updates them to read `locations[]`. Everything inside `packages/contracts` (mocks, region fixtures, tests) is already updated and green
- Verified 2026-09-19: `pnpm --filter @yourtal/contracts test` — 299/299 passing; typecheck and lint clean; OpenAPI document regenerated and Go models regenerated (`MerchantLocation` added)

### YT-0503 · Campaign contract: chapters and video source
`review` · P0 · platform · 2d · dep: YT-0031

- [x] Chapter markers (start, title, reward weight) on the campaign contract — `packages/contracts/src/campaign/campaign-chapter.ts`. No stored `endSeconds` or absolute per-chapter reward: both are derived (`chapterEndSeconds`, `chapterRewardPoints`) from the campaign's own `durationSeconds`/`rewardPoints`, per docs/13's "never store a value you can derive" — `rewardWeight` is what apps/web's local fake calls a weight already, this makes it the contract's own field instead of a client-side back-loading table
- [x] A video-source field the player can resolve without guessing — `campaignVideoSourceSchema` (`{kind: "hls", manifestUrl}`), additive shape for a later `mp4`/renditions variant
- [ ] Replaces the local fakes Phase U left commented in the player — **the contract is in place; deleting `apps/web/features/player/chapter.ts`, `derive-chapters.ts` and `video-source.ts` in favour of it is `apps/web` work**, out of this seat's editable scope. `chapterRewardPoints` reproduces `derive-chapters.ts`'s `distributeBackLoaded` exactly (same docs/06 §3 worked example, `[1,1,1,2,5]` → `[200,200,200,400,1000]` on 2,000 points) so the swap should be a straight replacement
- New cross-field rules on `campaignSchema` (6 total now, up from 2): long_form requires ≥1 chapter and quick requires none; first chapter starts at 0; chapter starts strictly increasing; every chapter starts before `durationSeconds`
- **Breaking change to `apps/web`**: `campaignSchema.parse({...})` literal calls in `burn-data.ts`, `burn-test-fixtures.ts`, `video-player.test.tsx`, `reports-metrics.test.ts`, `reports-fixtures.ts`, `reports-campaign-overview-table.test.tsx` will fail validation without `chapters`/`videoSource`. `mockCampaigns`/`generateCampaign` consumers are unaffected
- Verified 2026-09-19: same full-suite run as YT-0502, same result

### YT-0504 · Wallet contract: points history and ledger projection
`review` · P0 · platform · 3d · dep: YT-0031, YT-0041

- [x] A history entry shape covering earn, burn, expiry, reversal and adjustment — `packages/contracts/src/wallet/wallet-history.ts`, with `points`/`direction` (never a signed delta, to keep the branded non-negative `Points` type intact) and a cross-field rule per directional kind
- [ ] Derived from real ledger entries, not recomputed client-side from `docs/09` §4.1's formula — **PARTIAL. The contract side is done: `points` now travels WITH the entry rather than being re-derived from a formula at display time, which is what makes replacing `apps/web/features/wallet/wallet-history.ts` possible.** What is NOT done: there is no real ledger yet for anything to be derived FROM (YT-0044's invariant checker and the ledger service are separate, undone tasks), so `wallet-history.mock.ts`'s generator still computes a mock burn cost from an illustrative backing rate — same category of gap as every other mock generator in this package, not a new one
- [x] Plain-language descriptions per `docs/17` §3, never transaction codes — descriptions are prose (`"Menyelesaikan video X — dapat N poin"`), pinned by a test that rejects anything shaped like a bare code
- Not region/locale-aware yet (mock descriptions are Indonesian-only) — consistent with every other mock generator in this package today, and with TASKS.md's already-flagged, not-yet-re-cut AU-primary question; not solved here
- Verified 2026-09-19: same full-suite run as YT-0502/0503, same result

### YT-0505 · Reconcile pnpm-lock.yaml across sessions
`todo` · P0 · infra · 1h · dep: —

- [ ] The committed lockfile references `packages/authz` and `packages/jurisdiction`, which are not yet committed — `pnpm install --frozen-lockfile` is inconsistent until they land
- [ ] `quality.yml` runs exactly that, so CI is red for a fresh clone until reconciled
- [ ] Land the missing workspaces, then verify a clean clone installs frozen

### YT-0032 · Zitadel deployed, realm per country
`todo` · P0 · platform · 5d · dep: YT-0516

- **Deferred 2026-09-20 per decision N-3.** Auth is email and password behind an IdentityProvider seam (YT-0540/0541); Zitadel stays in the local stack and off the critical path. Kept because per-region realm isolation is still the right answer for a deployed multi-region identity provider — it no longer gates anything.
- Re-parented onto the local stack (YT-0516): this needed _a_ service, not a _managed_ one. The cloud task now covers deployment only.
- [ ] Self-hosted per region, backed by its own Postgres schema
- [ ] Realms isolated; no cross-region user lookup is possible

### YT-0033 · Phone OTP login flow
`todo` · P0 · platform · 5d · dep: YT-0540, YT-0538

- **Re-parented 2026-09-20: `YT-0032` → `YT-0540`, `YT-0538`.** This needed **a login and an OTP channel**, not *Zitadel specifically*. Chained to a task N-3 deferred, it was transitively blocking **20 tasks** — the third time this session a deferral was written in prose while the `dep:` line kept the old gate, and the graph follows the `dep:` line.
- The OTP channel is YT-0538’s simulator until a provider is engaged, which is exactly the point of the driver seam: the **verify step is real code** even while the token is simulated, so engaging a real provider is a driver swap rather than a rewrite.
- ⚠️ Note YT-0542: the fraud model rests on a phone anchor, and email-and-password alone makes a fake account nearly free. This task is what closes that, so it is worth more than its position suggests.
- [ ] OTP via an Indonesian-capable provider; rate-limited per number, per IP, per device
- [ ] Enumeration-safe responses; SIM-swap risk documented
- [ ] One number maps to one account per region

### YT-0034 · OIDC client for the first sister app
`todo` · P0 · platform · 3d · dep: YT-0033

- [ ] Authorization Code + PKCE, refresh-token rotation with reuse detection
- [ ] Scoped consent screen naming the requesting app and the data it gets
- [ ] End-to-end login proven from the sister app

### YT-0035 · Cerbos policies and decision point
`review` · P0 · platform · 4d · dep: YT-0030

- [x] Role model per `docs/17` §2.1/§2.2: flat principal roles plus **tenant-scoped business roles via Cerbos derived roles** (a flat role cannot answer "admin of _which_ business"), and merchant staff as `store_device` sessions rather than personal accounts. Supersedes the older role list in `docs/02`
- [x] Policies version-controlled and unit-tested — 14 resource policies, 2 derived-role files, 15 JSON schemas, 12 suites, **322 assertions passing** against Cerbos 0.55.0 (verified 2026-09-19). Suites assert **denies as well as allows**, covering the invariants that are really product rules: no business role can grant points; exactly one owner with step-up-gated transfer; all three two-person approvals; store devices limited to redeem/lookup/today; separation of duties; support cannot change a phone number; anonymous can watch but never earn; unfunded open views refused; `admin` reaches no data anywhere
- [x] `packages/authz`: PDP client, typed principal/resource/action registry, and a drift test that fails CI when a TS action has no backing policy — 34 tests passing, largest file 209 lines, no barrels
- Note: the PDP client is **hand-rolled against the Cerbos Check Resources API** rather than using `@cerbos/http` — one endpoint, stable shape, Zod-parsed response, per `docs/14` §7 ("a one-line utility is written, not installed"). Recorded as a deliberate decision

### YT-0500 · PDP enforcement across API routes
`review` · P0 · platform · 3d · dep: YT-0035, YT-0100

- [x] Every API route resolves authorization through the PDP, never ad hoc
- [x] A route without an authz decorator fails CI
- [x] **`neverthrow/must-use-result` wired into `eslint.config.mjs`** — `docs/13b` §4 requires it, and without it an unhandled authz `Result` is a **silently discarded permission check**. Deferred from YT-0035 because the plugin is legacy-format (last published 2022) and enabling it edits the shared config Phase U lints against; `docs/14` §7 puts a human gate on new dependencies. Evaluate the plugin, a maintained fork, or a custom rule
- [x] Split out of YT-0035 because it cannot be satisfied before `apps/api` exists
- [x] Authorization left controller bodies entirely: `@Authorize({kind, action})` + `PdpGuard`, nine routes converted. The decorator is **generic over `kind`**, so an action the kind does not define is a **compile error** rather than a permanent DENY found in production
- [x] Undeclared routes fail CI **and are refused at runtime** — when a build check and a runtime check disagree, the one that ships must be the safe one. An undeclared route is refused _without asking the PDP_, so a fabricated decision never reaches the audit log
- [x] `must-use-result` written as a **local flat-config rule**, not the 2022-era eslintrc plugin. Scoped to `apps/api` and `packages/authz`, since nothing in `apps/web` returns a Result. **Found nine genuinely discarded Results on first run**, all in test setup — hardened rather than exempted, so a broken fixture now fails at the line that broke
- [x] The last ad-hoc check removed: `create-business` threw from its own body, one endpoint answering its own question where no policy suite could see it. Now `business:create` in the policy repo, anonymous denied explicitly

### YT-0501 · Field RUM for real INP
`review` · P0 · web · 3d · dep: YT-0404

- [x] Budget rating uses `docs/08` §3.1’s own numbers rather than Lighthouse’s looser CWV defaults, and device class is labelled a **heuristic** because Safari and Firefox expose neither `hardwareConcurrency` nor `deviceMemory`
- [ ] ⚠️ **There is nowhere to send the samples.** No event-ingestion contract exists (YT-0059 is still `todo`), so the sink logs in development and is a **silent no-op in production rather than faking delivery**. Every sample already carries the segmentation a p75-and-alert pipeline needs; only the transport is missing, and only `rum-sink.ts` changes when YT-0059 lands
- [x] **A self-inflicted regression caught and fixed in the same pass:** mounting the reporter in the shared shell pulled `web-vitals` into every `(app)` route and pushed `/business/campaigns` to 200.9 KB, over the hard gate. Now dynamically loaded — telemetry not needed before interactivity has no business in that budget
- [ ] INP is a **field** metric and Lighthouse cannot measure it; TBT ≤ 200 ms is the lab proxy and must be labelled as a proxy wherever it appears
- [ ] Real-user monitoring reports p75 INP, LCP and CLS segmented by country, connection and device class
- [ ] Alert when p75 on mid-tier Android breaches the budget in the field, not only in CI

### YT-0036 · Consent service v1
`review` · P0 · platform · 5d · dep: YT-0030

- [x] Purpose-scoped, versioned consent records per jurisdiction — closed purpose enum, so _"to improve our services"_ (named in `docs/19` as the classic insufficient PDP formulation) **cannot be asked**, with a test asserting that exact string is rejected. Campaign questions and research answers are separate purposes per `docs/01`. Receipt-derived targeting is its own sensitive purpose gated to P2. Records are append-only — no `granted` boolean to flip — and a same-instant grant/withdraw tie resolves to **withdrawn**, the only direction that cannot be undone after data has been used
- [x] Other services query the decision, not the record — **satisfied structurally: there is no exported way to fetch raw records for a purpose.** `prohibitedIn` is checked **before** any record is read, so a granted consent can never reach an allow, with tests that fail if someone "optimises" the order. This encodes `docs/19` §6.4: Australia's fair-and-reasonable test applies **regardless of consent**, so `behavioural_profiling` and `purchase_history_targeting` are prohibited in AU even when consented
- [x] DSAR — **honestly partial.** The map of who must act exists (nine domains, each with an owner role from `docs/17` §5); the per-domain handlers do not. That is what "stubbed" asked for, but it is not done
- **The trap it encodes:** "delete everything" is the wrong instruction and would break the platform. The ledger and audit log are append-only and hash-chained with a published Merkle root, so erasing one row destroys the proof that every _other_ user's balance is correct. Deletion is therefore typed per domain — `erase`, `anonymise` or `retain` — and any non-erasure must name its basis or the schema rejects it. `risk_signals` is `retain`, because erasing fraud signals on request would make deletion the last step of the attack
- [x] **AC3 closed. The design point is the refusal.** A domain with no handler makes the request **fail** — `complete: false`, naming every domain that owes a handler **and its owner** — rather than being silently skipped. The tempting implementation loops over the handlers it has, succeeds, and reports done: the subject is told they were erased, the regulator is told they were erased, and the data is still in two of nine places
- [x] `unhandled` and `failed` are distinct outcomes — a missing implementation and a broken one send different people looking. **One broken service does not stop the other eight**, or a single unreachable service leaves eight others holding data they were asked to erase
- [x] **A voucher is anonymised, not erased, because a merchant is owed settlement for a redemption that actually happened.** Deleting the row deletes evidence of a debt owed to someone who is not the subject. The test asserts face value, merchant and code are untouched — an anonymisation that quietly damaged the instrument would be **a deletion wearing a different name**. A membership row *is* erased: it records no obligation to a third party
- [x] Tombstone is the **shared nil UUID**. Not NULL, which reads as *"we never knew"* when the truth is *"we knew and were asked to forget"* — a distinction both a regulator and an engineer need. Not a fresh uuid per subject, because a unique tombstone still lets rows be correlated back into one person: **re-identification with extra steps**
- [ ] ⚠️ **Seven of nine domains still owe a handler — see YT-0528.** `unhandledDomains()` is a query, not a fixture, so the gap stays visible; the test asserts the *shape* (every gap names an owner) rather than a number, because a test people routinely edit stops being read

### YT-0037 · Jurisdiction policy service
`review` · P0 · platform · 3d · dep: YT-0030

- Verified 2026-09-19: 46 tests passing, largest file 136 lines, no barrels. `resolvePolicy` takes a raw string so an unknown code hits a **standalone restrictive literal** (cash-out off, draws off, age 21, residency required, KYC enhanced) rather than one derived from real data — genuinely fail-closed, not merely claimed
- ⚠️ `minimumAgeYears: 18` is a **placeholder with no legal citation**. See position ID-12 / AU-9 in `docs/24-legal-positions.md`
- [x] Single source of truth for cash-out on/off, draws on/off, min age, residency, KYC tier
- [ ] Every regulated feature reads its switch from here, never from config — **unticked deliberately: no regulated feature exists yet to read it.** Carried as a standing check at each phase gate rather than a one-time tick

### YT-0038 · Hash-chained audit log
`todo` · P0 · platform · 4d · dep: YT-0516

- Re-parented onto the local stack (YT-0516): this needed _a_ service, not a _managed_ one. The cloud task now covers deployment only.
- [ ] Append-only, per-record hash chain, verifiable offline
- [ ] Covers bulk issuance, ledger adjustment, campaign approval, refunds, role changes
- [ ] No service can delete or update a record

### YT-0039 · Idempotency middleware (TypeScript)
`review` · P0 · platform · 3d · dep: YT-0031

- [x] Shared table (`IDEMPOTENCY_TABLE_DDL` exported so every service creates the same one), key + fingerprint, replay returns the original response. Fingerprint is `sha256(METHOD 
 path 
 sha256(body))` — **deliberately the same canonical shape as the merchant HMAC request in `docs/14` §6**, with a test pinning the exact hex digest because that value is a **cross-language wire contract**
- [x] Mandatory on every value-moving endpoint — enforced **the strict way round**: a route scan fails the build for any mutating route carrying **neither** `@Idempotent` **nor** `@NotValueMoving("reason")`. Neither is the failure, so a new endpoint cannot exist without someone deciding which it is. Interceptor has its own tests proving replay, 409 and release actually happen
- [ ] ⚠️ **Only an in-memory store exists** (YT-0022 blocked on GCP) and it is **per-process**, so two instances behind a load balancer each keep their own map and a retry landing on the other executes twice. _An idempotency store that is not shared is not an idempotency store_ — written into the module rather than left to be discovered
- **Three design points worth keeping:** the record is written **before** the work as `in_progress`, so a retry arriving mid-flight gets 409 instead of a second execution — the naive write-on-completion leaves the timeout window open at exactly the moment clients retry. **5xx is stored and replayed** (a partial failure re-run becomes a double charge) while **4xx is released** (it never reached the value path, and the corrected body hashes differently anyway). **Keys are scoped to the verified principal, never global** — not only for tenant isolation but because an unscoped key is writable by anyone, so an attacker can pre-poison a guessed key and have the legitimate request replay their response
- **The store interface has no `get`, only `putIfAbsent`.** A get-then-put cannot be made safe — two concurrent retries both read absent, both write, both execute. An interface that cannot express the unsafe pattern is the fix

### YT-0514 · Idempotency: Go implementation
`todo` · P0 · platform · 2d · dep: YT-0039

- [ ] Split from YT-0039, whose title claimed Go and TypeScript. **No Go service exists yet**, so there was nothing to implement against
- [ ] Must match the two things already pinned: the shared `IDEMPOTENCY_TABLE_DDL` and the **exact fingerprint digest**. A Go instance computing it differently makes a retry look like a mismatch, and a correct client is told to fix a correct request

### YT-0515 · Durable shared idempotency store
`review` · P0 · platform · 1d · dep: YT-0039, YT-0022

- [x] Postgres-backed store using `INSERT … ON CONFLICT DO NOTHING RETURNING` — the only form that survives two concurrent retries
- [x] Replaces the in-memory store, which is per-process and therefore not an idempotency store at all
- [x] `PostgresIdempotencyStore`, 40 tests, including **exactly one of eight simultaneous claims winning** — which no single-threaded map could have demonstrated
- [x] `apps/api` selects the store from config and **refuses to boot in production without `DATABASE_URL`** rather than silently using the per-process map
- **Conditional `DO UPDATE`, not `DO NOTHING`:** an expired row must behave as _absent_, because a dead row reporting "in progress" wedges a legitimate retry until a human notices. `DO NOTHING` cannot express "unless expired, take it over" without becoming a read-modify-write race of its own

### YT-0040 · Job queue and worker skeleton
`todo` · P0 · platform · 3d · dep: YT-0516

- Re-parented onto the local stack (YT-0516): this needed _a_ service, not a _managed_ one. The cloud task now covers deployment only.
- [ ] pg-boss with retries, backoff, dead-letter and visibility in Grafana
- [ ] Every consumer is idempotent by construction

### YT-0547 · Test isolation: one database per package, not one lock per file
`todo` · P0 · platform · 2d · dep: YT-0516

- **Second instance 2026-09-20: `apps/api` now carries `fileParallelism: false` too**, for the same reason — every file writes to one shared database and the cleanup helper empties it, so a parallel worker has its rows deleted mid-test. Two packages now carry the same workaround, and **removing the flag from both is what proves the isolation**
- [ ] ⚠️ **Fold two setup rules into a shared convention rather than each suite’s memory.** Both recurred three times, in three packages, with the same person making the same omission twice:
  - **Cleanup runs at the START of a group, not only at the end.** A test that fails part-way leaves rows behind, and the next run collides on a primary key and fails for a reason unrelated to what it tests — **a real failure buried under a fake one**
  - **`hookTimeout` must be set, not `testTimeout`.** Vitest times hooks separately, and the expensive work — booting Nest, running a seed — is exactly what lives in a hook, so raising the test timeout protects every assertion and misses the only slow thing in the file
- **Why this exists.** `packages/db/vitest.config.ts` sets `fileParallelism: false` with the comment _"a parallel worker writing the same ledger rows would make failures unreproducible"_. That serialises files **within** the package and nothing else — `turbo run test` runs `@yourtal/db` and `@yourtal/api` concurrently against the **same Postgres**, so the tests were never alone with the database whatever the comment claimed. The stopgap is `--concurrency=1` in `pnpm verify`, which is correct and slow; slow gates stop being run
- [ ] Each package that touches Postgres gets its **own database**, created and dropped by its own setup
- [ ] `fileParallelism: false` is then removable — and removing it is the proof the isolation is real
- [ ] `pnpm verify` drops `--concurrency=1` and the whole gate parallelises again
- [ ] ⚠️ **The failure mode to design against is the diagnosis, not the flake.** This surfaced as `Hook timed out in 10000ms` in a `beforeAll`, which reads as a slow database rather than as two packages colliding. A test that fails for a reason its message does not name is one that gets rerun until it passes

### YT-0548 · Storage for campaign chapters and video source
`review` · P0 · media · 3d · dep: YT-0503

**Closed by YT-0101's migration `20260920000012_campaign_lifecycle.sql`, 2026-09-20.** `campaign.chapter` and `campaign.video_source` exist, the seed writes them, and `seed.test.ts` reassembles a campaign from Postgres and parses it through `campaignSchema` — which is the only assertion that distinguishes *the columns exist* from *the database can produce a valid campaign*. Adding the tables without writing them would have been the same bug with more scaffolding.

- **Found by the contracts↔migrations drift gate on its first run**, and confirmed against the live database: `campaign.campaigns` has 13 columns and **neither `chapters` nor `videoSource`**. Both are **required** in `campaignSchema`, so **every row in that table today is unparseable as a `Campaign`** — the database cannot produce a valid one. It is invisible only because Phase U reads mocks; it becomes a total outage of the watch flow the moment a real API serves a campaign
- [ ] `campaign.chapter` stores `(campaign_id, ordinal, title, start_seconds, reward_weight)` — **no `end_seconds` column.** A chapter's end is the next chapter's start, or the campaign's duration for the last; storing it is the derived-value bug, and the contract already refuses to carry it
- [ ] UNIQUE `(campaign_id, ordinal)`, and a constraint that `start_seconds` strictly ascends and the first is `0`. Out-of-order chapters are a reward-allocation bug, not a display bug
- [ ] `reward_weight` is stored; **per-chapter point values are never stored** — they derive from the campaign's `reward_points`, which stays the single total
- [ ] Video source stored as `kind` plus its fields with a CHECK, so the discriminated union stays additive — an `mp4` fallback later must not alter the `hls` shape already in use
- [ ] A campaign with zero chapters cannot exist in the database if the contract requires at least one. **If that turns out to be wrong for Quick campaigns, the contract is wrong and should say so** — do not relax the constraint to match an accident
- [ ] The `fieldsAwaitingStorage` entry for these two fields is **removed** in the same pass. The gate asserts its own gap set, so closing a gap without deleting its line fails — which is the point

### YT-0549 · Seeded user personas for journey and load testing
`todo` · P0 · data · 2d · dep: YT-0519

- **Founder asked for 25 seeded users (2026-09-20).** Worth building — for exercising the software. Deliberately **not** a substitute for YT-0451's reaction sessions, which measure whether real people will watch; see that ticket for why the two cannot be traded
- [ ] ~25 personas spanning the states the UI must survive: **zero points, mid-balance, expiring points, a spent-out wallet, a redeemed voucher, an abandoned campaign, a suspended account**
- [ ] Generated from the existing mock generators into the **real database**, so they are indistinguishable from production rows rather than a parallel fixture set
- [ ] Both regions represented, with AUD and IDR balances that are correct in their own currency — a persona with Rupiah amounts in an Australian wallet tests nothing except our patience
- [ ] ⚠️ **At least one persona exists to make a screen look bad**: the empty wallet, the merchant with one listing, the campaign nobody finished. Seeds that only contain healthy data hide exactly the states users complain about
- [ ] Idempotent per the seeding rule in `docs/13` — idempotent **for a fixed contract**, so a contract change means `pnpm dev:fresh`, not a re-seed

### YT-0550 · Player: `Home` does not return the playhead to zero
`review` · PU · web · 1d · dep: YT-0526

- **Handed back rather than tuned green.** 3 of 4 keyboard-seek cases pass against the MinIO origin; `Home` lands the media at **0.35 s** instead of within a frame of zero. In a standalone probe `Home` works and returns exactly 0, so the cause is the **controlled-input / time-remap interaction in the component**, not latency
- **2026-09-20: a component fix attempted, NOT verified against the real origin — do not mark done from this entry alone.** `toRealSeconds(0, …)` is exactly `0` for any duration, so the arithmetic was ruled out. The remaining candidate named in the previous note — rapid repeat `handleSeekTo` calls issuing overlapping seeks against the network origin before the prior one settles — now has a fix: `handleSeekTo` (`use-watch-session.ts`) coalesces a new target into a queued ref while `video.seeking` is true, instead of layering a second seek on top of an in-flight one; the queued target is applied once `seeked` reports the current one settled (`use-video-event-wiring.ts`). The coalescing mechanism itself is unit-tested and sabotage-confirmed (`use-watch-session.test.tsx`: reverting the coalescing branch makes that test fail, as expected)
- [ ] Fixed in the component, not by loosening the assertion. The backend session stopped at exactly this line and said so, which was right — relaxing a tolerance until it passes is how a real failure hides. **Not ticked**: this is the acceptance criterion itself, and it needs the real Playwright run below to confirm, not a unit test of the coalescing logic in isolation
- [ ] ⚠️ **Seeks against an origin land later than against a same-process static file.** That is now a permanent property, not a flaw, since the `public/` fixture is gone; a `settle()` helper exists and fixed two of three cases
- [ ] ⚠️ **The end-seek assertion has been rewritten and must not be reverted.** It previously asserted that seeking to the end completes the campaign — see decision **O-4** and risk 43. It now reads the media position directly, which is what YT-0412 actually asks for
- [ ] Context worth keeping: the fixture is `attention-30s` at 30 fps because the seek tests are calibrated to a ~50 ms keyboard step at a 20:1 remap ratio. A 15 fps fixture makes one step land inside the same frame and the bar never moves. **A directory named for the wrong duration is a lie that costs somebody an hour**
- ⚠️ **Not run in this pass**: `pnpm dev:up`/`pnpm media:publish` + the real Playwright suite. A live `next dev` was already running against this same `apps/web` checkout (docs/13c, "Two agents, one working tree" — a `next build` here would share `.next` with it), so `keyboard-seek.spec.ts`'s `Home` case stays `test.fixme`, now with a note on what to run and what to require (a few consecutive green repeats, not one) before flipping it

### YT-0551 · Gate the completion hand-off on coverage, not on the `ended` event
`review` · PU · web · 2d · dep: YT-0526

- **Implements decision O-4 in the player.** `use-watch-session.ts` sets `hasEnded` from the `ended` event alone, so **the only thing currently preventing scrub-to-complete is that Chrome declines to fire `ended` on a seek** — see risk 43. A fraud control resting on one browser's incidental behaviour is not a control
- **2026-09-20: done, verified at the unit/jsdom level; real-browser Playwright re-verification still recommended.** New pure module `watch-coverage-tracker.ts` tracks real-second watched ranges via a `seeking`-flagged tick (`applyCoverageTick`) and asks `hasFullRealCoverage` fresh on every `timeupdate`/`seeked`/`ended` — never trusting which event fired. `use-video-event-wiring.ts` (split out of `use-watch-session.ts` to hold the 300-line ceiling) wires this to the DOM
- [x] Completion requires **playback coverage of the whole timeline**, tracked as watched ranges, not a single terminal event — `watch-coverage-tracker.ts`, mirroring `packages/contracts/src/watch/watch-coverage.ts`'s "ask what's missing" model
- [x] Seeking to the end leaves the campaign incomplete and does **not** mount the hand-off — asserted directly in `use-watch-session.test.tsx` ("the attack: a single scrub to the end…"), **sabotage-confirmed**: reverting the fix in `use-video-event-wiring.ts` makes that test fail with the hand-off link found in the DOM
- [x] A synthetic `ended` event does not complete a campaign — asserted directly ("the attack: a synthetic `ended` event with zero real playback…"), same sabotage confirmation
- [x] ⚠️ **This is defence in depth and must not be described as the control.** Stated in `watch-coverage-tracker.ts`'s own header, citing the server's checkpoint-token/segment-log model, matching this ticket's wording
- ⚠️ **What's NOT covered**: the real Playwright `keyboard-seek.spec.ts`/`earn-journey.spec.ts` suites were not re-run against a real browser + the MinIO origin in this pass (shared-dev-server risk, see YT-0550's note) — the jsdom-level hook test dispatches real DOM events on a real rendered `<video>` element and is sabotage-confirmed, but it is not a substitute for the real-browser run those specs exist to provide

### YT-0552 · Wire `apps/api` repositories to Postgres
`review` · P0 · platform · 4d · dep: YT-0527, YT-0518

**Done. 96 `apps/api` tests now execute real SQL; `pnpm verify` 11/11, 1959 tests, lint 11/11.**

- [x] **Every in-memory repository deleted**, not kept behind a flag. `business.module.ts`'s `databaseUrl ? Drizzle : InMemory` branch is gone and `DATABASE_URL` is **required** by `env.schema.ts`, so a misconfigured deployment fails at boot instead of silently serving fakes — the same rule the driver seam applies to `live` without a credential
- [x] **The idempotency store had the same shape**, and worse. Its in-memory branch was already guarded against production, but `DATABASE_URL` becoming required made it unreachable code that still advertised an option — and while it existed, every test took it. An `INSERT ... ON CONFLICT DO NOTHING` exercised only as a `Map` proves nothing. Removed
- [x] **Proved the tests actually reach Postgres rather than trusting a green run.** Pointed `DATABASE_URL` at a dead host: **23 tests fail**. A suite that passes either way would have been the same green-but-empty shape one layer along
- [x] Suite runs in `integration.yml` against real Postgres with the existing no-SKIP assertion
- [x] **Role separation exercised, not assumed.** Tests connect as `yourtal_app`, so a missing grant fails here rather than in production
- [x] `fileParallelism: false` and `hookTimeout: 30_000` on the package: every file now writes to one shared database, and `testTimeout` does not cover hooks — the hook is where a Nest app boots. YT-0547 is the real fix, at which point removing the serial flag is the proof the isolation is genuine
- [x] **Repeatability wired before it bit.** Every converted suite clears the business tables in `beforeAll` — at the START, not only the end. Proved by three consecutive green runs
- [ ] ⚠️ **No constraint fired, and that is worth stating plainly rather than claiming a win.** The Drizzle schema already matched the migration column-for-column, so the conversion surfaced no mismatch. The value delivered is that the queries now execute at all — the next schema change is the one this would have caught, and previously would not have
- [ ] ⚠️ **Only the `business` module exists.** Campaign, watch and reward modules have no API surface yet, so "wire `apps/api` to Postgres" is complete for what exists rather than for the eventual backend

- **The API boots and routes respond — against in-memory repositories.** So seven controllers, every Drizzle line and every schema constraint are **typechecked but never executed**, and the tests exercise fakes. This is the same green-but-empty shape catalogued in `docs/13c`, sitting under the whole backend rather than under one gate
- [ ] Each in-memory repository is replaced by a Postgres-backed one; the in-memory versions are **deleted, not kept as a fallback** — a fallback is the thing tests quietly select
- [ ] The existing suite runs against real Postgres in `integration.yml`, with **no SKIP tolerated**, per the rule YT-0527 already enforces for Cerbos
- [ ] ⚠️ **Expect constraints to fire that unit tests never could.** Unique indexes, composite foreign keys, the ledger balance trigger and the append-only grants are all invisible to an in-memory map — finding them now is the point of the ticket, not a setback
- [ ] ⚠️ **Role separation is exercised, not assumed:** the app role has no DELETE on frozen tables, and a test that needs cleanup uses the owner connection rather than widening a grant for convenience
- [ ] This is what lets `apps/web` stop mocking, so it is the join between the two halves of the build rather than backend housekeeping

### YT-0553 · API surface for campaign and watch
`review` · P0 · platform · 4d · dep: YT-0552, YT-0101, YT-0120

**Done. `apps/api` 96 → 112 tests, all against real Postgres. `pnpm verify` 11/11, 1982 tests, lint 11/11.**

- [x] **Campaign reads serve the derived status only.** The repository returns `Campaign`, whose `status` has no value capable of expressing `draft`, `in_review` or `rejected` — the leak is **unrepresentable rather than filtered**, which is stronger than remembering to exclude them per route. A campaign with no public form is a 404, identical to one that does not exist, because distinguishing them confirms a draft with that id exists
- [x] Rows are **parsed** through `campaignSchema`, not cast. YT-0548 was a table whose every row failed that parse, unnoticed for weeks because nothing read a campaign back
- [x] **Completion is decided server-side by coverage.** There is no endpoint that accepts "I finished": `complete` re-reads recorded coverage and judges. A client that scrubs to the end and asks gets a refusal naming the unwatched seconds, and a test asserts the controller has no method that could take a completion claim
- [x] **The rate check uses the server's clocks, both of them.** `reportedAt` is recorded for audit and never used — a test passes a timestamp an hour in the future and the refusal is unchanged
- [x] Same `PrincipalService.resolve(request)` / `@Authorize` seam as every existing route, on `campaign_view` rather than `campaign`: a viewer asking to watch must not be answered by a policy written about authoring
- [x] Session ownership is checked in the controller, not the PDP — no role makes someone else's session yours, and a row-level fact does not belong in a policy file that cannot see rows. Someone else's session is a 404
- [x] ⚠️ **`complete` currently refuses every completion**, because the question bank does not exist (YT-0102/YT-0122) and O-1 requires both halves. Hard-coded `questionsAnswered: false` rather than a permissive placeholder: a stub that let completion through would be a reward path nobody decided to open
- [x] ⚠️ **The first dead-host proof was invalid and said so.** `vitest.config.ts` sets `env.DATABASE_URL`, which **overrides a command-line value** — so pointing `DATABASE_URL` at a dead host left the suite green and would have been reported as proof. The test now resolves `TEST_DATABASE_URL` first, which the config does not set, and the break is real: the suite fails to load and every test is skipped

- **The models exist and nothing can reach them.** YT-0101 built the campaign lifecycle and YT-0120 the watch session, both with real tables and real rules — but `apps/api/src/modules/` contains only `business`. **This is the join between the two halves of the build**: until these routes exist, `apps/web` keeps reading mocks and the backend keeps being proved only by its own tests
- [ ] Campaign read routes serve what the public pages and the Earn board actually need, derived status included — never the authoring state
- [ ] Watch session start / progress / completion, with completion decided **server-side by coverage** per O-4. The client reports; it does not conclude
- [ ] Authorization through the same `PrincipalService.resolve()` and `pdp.requireAction(...)` seam every existing route uses, so YT-0500 still changes only the body of `resolve()`
- [ ] ⚠️ **Prove the wiring by breaking it**, per YT-0552: point the database at a dead host and confirm these routes fail. A suite that passes either way is testing nothing, and that is the failure this project has found seven times
- [ ] ⚠️ **Until this lands, every `apps/web` screen is unverified against real data.** The UI is substantially built; it has just never met the backend

### YT-0554 · The API must not connect to Postgres as a superuser
`review` · P0 · platform · 2d · dep: YT-0552

- [x] ✅ **Done and verified independently 2026-09-20.** `DATABASE_URL` is now `yourtal_app`, `DATABASE_OWNER_URL` is the owner, and `has_table_privilege` reports **owner `t`, app `f`** on `ledger.entry`. That write would have succeeded from application code before this change
- [x] The boot check **queries `pg_roles` rather than parsing the username out of the URL** — a username is what someone typed, the catalogue is what the server will actually permit
- [x] It runs in `OnApplicationBootstrap`, **not a module factory**: `new Pool()` is lazy and does not connect, so a check written there would first fire on the first query — after the app is already serving and reporting healthy
- [x] Atlas reads `DATABASE_OWNER_URL` with **no fallback to `DATABASE_URL`**, because a fallback would silently re-create the bug this ticket exists to fix
- [x] **CI was running everything as the superuser too**, so the grants were decorative there as well. `integration.yml` now uses the app role, with the owner only for schema bootstrap
- [x] Proved by breaking it **twice**, confirming the break landed each time — including sabotaging the new test's own assertion and watching 2 of 3 fail. **A test for a control that cannot fail is worth nothing**
- **Verified 2026-09-20: `pg_roles` shows `yourtal` with `rolsuper = t` and `rolbypassrls = t`, and `.env` points `DATABASE_URL` at it.** Only `apps/api/vitest.config.ts` uses the least-privilege `yourtal_app`
- ⚠️ **So role separation is enforced in tests and bypassed by the running application.** Every grant boundary built so far is decorative at runtime: `REVOKE ALL ON SCHEMA ledger FROM yourtal_app`, `ledger.daily_proof` being INSERT/SELECT only so a day can be proved once, the append-only entry grants, the frozen `campaign.terms_version`. A superuser connection ignores all of it, and **`BYPASSRLS` means row-level security will not apply either, the moment RLS exists**
- This is the eighth instance of the `docs/13c` pattern and the most expensive shape of it: not a gate that fails to check, but **a control that was built, tested, and then not used**
- [ ] Two URLs: **Atlas keeps owner DDL rights for migrations; the application gets `yourtal_app` and nothing more**
- [ ] A boot-time assertion that the application's connection is **not** a superuser and does **not** hold `BYPASSRLS`, failing loudly — the same rule the driver seam applies to `live` without a credential
- [ ] ⚠️ **Prove it by breaking it**, and confirm the break lands: with the app role in place, a write to `ledger.entry` from the app must be refused. A green suite here proves nothing, because it is green today

### YT-0555 · The schema-drift gate does not cover the business module
`todo` · P0 · platform · 1d · dep: YT-0552

- **Verified: `MAPPINGS` in `schema-drift.test.ts` covers listing, voucher, campaign, campaignTerms, campaignRewardConfig, watchSession and merchantLocation — and none of `businessSchema`, `BusinessMember`, `BillingContact` or `KybDocument`.** The gate that exists to catch a contract landing ahead of its migration **silently does not run for the one module that has a live API surface**
- [ ] Business schemas added to `MAPPINGS`, with any genuine gaps recorded in `fieldsAwaitingStorage` rather than left implicit
- [ ] ⚠️ **The gate should fail when a mapped schema is missing**, not only when a mapped field is. A per-schema opt-in list silently excludes whatever nobody remembered to add, which is the same failure one level up — the coverage table needs asserting in both directions, exactly as YT-0536 does for the boundary faults

### YT-0556 · Health endpoint
`review` · P0 · platform · 1d · dep: YT-0552

- [x] `GET /api/health` at `apps/api/src/shared/health/` — a real `SELECT 1` against Postgres and a Cerbos `/_cerbos/health` fetch, **run in parallel**, returning 503 when either fails
- [x] ✅ **Marked `@PublicRoute` deliberately, and the reason is the good part: a Cerbos outage must not hide the endpoint that reports the Cerbos outage.** A health check behind the dependency it checks reports nothing at the only moment it matters
- [ ] Add to the deploy health-check path in YT-0532, which currently has nothing real to probe

### YT-0557 · Load the root `.env` properly
`review` · P0 · infra · 1h · dep: —

- [x] `pnpm dev` died instantly on a missing `DATABASE_URL` because **nothing loaded the root `.env`**, and `atlas.mjs` carried a hand-rolled parser working around it — a local fix for a global problem, which is the shape `docs/13c` warns about
- [x] Now Node's native `--env-file-if-exists` / `process.loadEnvFile`, with **real process environment taking precedence** over the file
- [x] ⚠️ **This is what makes YT-0554 urgent rather than theoretical.** The `.env` is now reliably loaded, so the superuser `DATABASE_URL` in it is now reliably used

### YT-0558 · Test configs hard-code `DATABASE_URL`, which defeats sabotage
`todo` · P0 · platform · 1h · dep: —

- **Two sessions independently hit this within hours.** `vitest.config.ts` sets `env.DATABASE_URL`, and that **overrides a value passed on the command line** — so pointing the database at a dead host to prove a suite really talks to it comes back **green**, and reads as proof of exactly the opposite
- That it happened twice makes it a property of this repo rather than a mistake either person made. The house rule is to prove a check by breaking what it catches; this configuration **silently disarms that rule** for every database-backed suite
- [ ] The value under test is resolved from the environment first, with the config supplying only a fallback
- [ ] A comment at each site naming why, since the next person will reach for the convenient form again
- [ ] ⚠️ **After fixing, re-run the sabotage that previously passed** and confirm it now fails — a fix to a verification mechanism has to be verified by the mechanism it repairs

### YT-0559 · Contract entries for the campaign, watch and health routes
`todo` · P0 · platform · 2d · dep: YT-0553, YT-0556

- **Seven live routes have no OpenAPI entry.** They are **not silently missing** — they sit in an explicit `KNOWN_OUT_OF_SCOPE` ledger in `route-drift.test.ts` which is **itself asserted**, so adding or removing one of those routes fails the suite until the ledger is updated. That is the right shape for a gap: visible, and it fails when it changes
- [ ] Campaign, watch and health routes documented; each removed from the ledger in the same change
- [ ] ⚠️ **The ledger must never become a parking spot.** It is the same distinction YT-0536 draws between a by-design exemption and a known gap — collapsing them is how the second quietly becomes the first

### YT-0560 · The route gate checks method and path, not shape
`todo` · P0 · platform · 2d · dep: YT-0559

- **A route entry is transcribed from its DTO and nothing checks it stayed true.** Method and path drift are guarded; **a renamed DTO field in `apps/api` goes unnoticed**, so the published contract can describe a body the server no longer accepts — and every generated Go client inherits it
- This is YT-0555 one level down: a gate covering the dimension that is easy to check rather than the one that carries the risk
- [ ] The entry's schema is derived from or compared against the DTO, with neither inheriting the other — a comparison where one side is generated from the other compares a value to itself, which is what `openapi:go:check` was doing
- [ ] The 400 validation response currently carries a description and **no schema**, because nobody verified `nestjs-zod`'s exception shape against the installed version. Domain 400s do carry the real `ErrorResponse`. Verify it, then state it — or leave it unstated rather than guessed
- [ ] ⚠️ **Prove it by breaking it, and confirm the break lands:** rename a DTO field and require that the failure **names that field**. A generic red proves the suite noticed something, not that the gate discriminates

### YT-0561 · The accuracy half of the reward has no server-side home
`todo` · P0 · value · 3d · dep: YT-0102, YT-0045

- **`docs/06` §4.2's 60/40 base-to-accuracy split lives as `BASE_REWARD_FRACTION = 0.6` in a client module**, multiplying `campaign.rewardPoints` in the browser. Its own comment says the real ratio belongs to the Reward Engine, which is exactly right and exactly not where it is
- Under O-1 the reward is granted only on full playback **and** answered questions, so **both halves of that arithmetic must be server-side** — the base half now has a home in the watch session, the accuracy half has none
- [ ] The split is a Reward Engine parameter, versioned with the action taxonomy, not a constant in any client
- [ ] The client may **display** an expected reward; it must never compute the granted one. After YT-0102 moves scoring server-side, `checkpoint-scoring.ts` becomes display-only and its arithmetic advisory — say so in the file, because a module that used to be authoritative and quietly became advisory is the sort of thing someone later trusts again
- [ ] ⚠️ **Two copies of one ratio is the derived-value bug with money attached.** Whatever the client shows must be derived from the server's value, not from a second constant that agrees with it today

### YT-0564 · The result screen says "Total received" for a number nobody has granted
`todo` · PU · web · 1d · dep: YT-0561

- **`checkpoint-result.tsx` renders `result.totalReceived` — "Total received" / "Total diterima" — beside `totalEarned(split)`, which is computed by the now-advisory client scoring module.** Under **O-5** that number is not authoritative, and under **O-1** nothing is granted until full playback *and* answered questions. Today the server’s `complete` refuses every completion, so the figure is **certainly** unreceived at the moment it is shown
- ⚠️ **This is risk 44 again in a different component.** That one was a live “Reward so far” tally implying accrual; this is a past-tense claim that money has arrived. **“Received” is a statement of fact about money**, and both the ACL and its Indonesian equivalent reach conduct that misleads about what a consumer will get
- [ ] Copy states what is true at the moment it renders — an **expectation**, not a receipt — in both locales, and the test asserting the old string is updated to assert the new meaning rather than deleted
- [ ] The figure is **derived from the server’s response** once YT-0561 lands, not from a client constant. Two numbers that agree today is the duplicate-source-of-truth bug with money attached
- [ ] ⚠️ **Sweep for the vocabulary, do not fix only this string.** Risk 44 was found by grepping `earned` / `so far` / `accrued`; add **`received` / `diterima` / `total`** to that sweep. A superseded model leaves its words behind in copy long after the logic moves

### YT-0565 · The ledger schema-drift regex fails open
`todo` · P0 · value · 2h · dep: —

- `services/ledger/internal/store/schema_test.go`'s `columnPattern` is `[a-z_]+`, so **it cannot match a column name containing a digit**. An unmatched column is **not compared** — the gate fails open rather than erroring, so coverage shrinks silently
- It works today only by luck: **no `ledger` column has a digit**, verified. The identical pattern in the voucher service silently dropped `manifest_sha256` and then reported a drift that did not exist — the same defect, loud in one place and invisible in the other
- [ ] Widen to `[a-z_0-9]+`, and **assert the match count equals the column count** so an unmatched column becomes a failure rather than an omission
- [ ] Add `backing_rate` to the table list — a table the loop does not name is one the guard cannot see drift in
- [ ] ⚠️ **This is the ninth gate that did not cover what its name implied**, and the first to do it through a regex. Any parser-based check needs the same question asked of it: what does it do with input it does not recognise?

### YT-0566 · The hold sweeper has no alarm and availability depends on it
`todo` · P1 · merchant · 2d · dep: YT-0151

- **Safety does not depend on the sweeper** — `ResolveAuthorization` filters on `expires_at`, so an expired hold cannot be captured. **Availability does**: the one-live-hold index is `WHERE state = 'held'`, and a partial index cannot reference `now()`, so a stale hold blocks a **new** authorize until the sweep clears it
- ⚠️ So `docs/09`'s promise that _"an abandoned cart cannot lock a voucher forever"_ bottoms out at the sweep interval, and **if the sweeper dies the voucher stays locked** — a silent failure whose symptom is a customer at a till being told their voucher is in use
- [ ] The sweeper reports liveness and **pages when it has not run**, not merely when it errors. A job that stops running produces no errors at all
- [ ] Alert on the **age of the oldest unswept hold**, which measures the promise directly rather than measuring the job
- [ ] Expose the count in the merchant portal, so a shop sees _why_ a voucher is unavailable rather than being told it is broken
