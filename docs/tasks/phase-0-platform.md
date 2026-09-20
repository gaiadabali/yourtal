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
`doing` · P0 · platform · 2d · dep: YT-0035, YT-0100

- Verified: policies 375 assertions (up from 322), authz 36, api 97. **`GET /business` widened from owner+admin to all six roles — confirmed correct**, and `docs/17` §2.1 now has explicit Profile and KYB columns so it is no longer an inference. KYB stays owner+admin: director identity and tax registration are sensitive. `ops` has `approve`/`reject` on `kyb_document` but **no route calls them** — the review queue is unbuilt
- [ ] `policies/` has **no `business` resource kind** — only `team` (roster) and `billing` (spend), so "edit a business's own profile" has no policy to ask
- [ ] KYB submit/list currently borrow **`team:view`** as a proxy. It is a tested action rather than an invented one, but not a designed fit — and `team:view` is owner/admin-only, so marketer, finance and analyst cannot see the business profile or KYB, which is likely narrower than intended
- [ ] Add both kinds with actions designed against `docs/17` §2.1, and repoint `apps/api`
- The agent correctly declined to invent an action rather than guess at the policy model

### YT-0508 · Promote business shapes into contracts
`doing` · P0 · platform · 2d · dep: YT-0031, YT-0100

- Verified: contracts 215 tests, OpenAPI and Go regenerated, Go builds and vets clean
- [ ] `@yourtal/contracts/business` has no shape for **members, billing contact or KYB documents**; all three were modelled locally inside `apps/api`
- [ ] Promote them, mirroring `apps/api/src/modules/business/domain/*.ts`, which were designed against `docs/17` directly
- [ ] Required before the advertiser console (YT-0440+) can share the types

### YT-0512 · `apps/web` imports an undeclared package
`doing` · P0 · web · 1h · dep: YT-0509

- [x] Already fixed on disk; the tracker was stale. `apps/web` imports `BusinessTeamRole` from `@yourtal/contracts/business/team-role`, and the file this ticket blamed for a syntax error **does not exist**
- [ ] Six files under `apps/web/features/console/` import `@yourtal/authz`, which **`apps/web/package.json` has never declared** — absent from every commit, and `.npmrc` hoists only eslint and prettier, so the specifier was never resolvable
- [ ] **Not caused by YT-0509.** The files are untracked, so they never passed through CI; authz was never an `apps/web` dependency at any commit
- [ ] **Fix: import `BusinessTeamRole` from `@yourtal/contracts/business/team-role`**, which `apps/web` already depends on — exactly what YT-0509 made possible. Adding an `authz` dependency to a web app would be the worse fix
- [ ] Separately, `features/onboarding/onboarding-region-derived.ts` currently has syntax errors (unterminated template literal) — in-flight, not related

### YT-0509 · Invert the contracts → authz dependency
`doing` · P0 · platform · 1d · dep: YT-0508

- [x] Done as specified: `businessTeamRoleSchema` moved to contracts, authz imports it and **keeps its drift test against `principal.json`** — 36/36, so the Cerbos guarantee survived the move. `contracts` deps are now `{zod}` only. Verified acyclic
- [x] Renamed to **`businessTeamRole`** because `contracts/business.ts` already exported `businessRoleSchema` meaning advertiser/supplier/redeemer. Two concepts competing for one name is how a member record ends up with "supplier" as a job title; a test asserts the option sets never overlap
- [ ] **Drop the back-compat alias.** `@yourtal/authz/roles` re-exports under the old names so three packages did not need renaming mid-flight. Correct call then; remove once `apps/web` and `apps/api` migrate, or the alias becomes permanent
- [ ] **Architect call: invert it.** Move the six-role enum **into `packages/contracts`**; `packages/authz` imports it and **keeps its drift test against `policies/_schemas/principal.json`**
- [ ] Roles appear in API payloads (a business member carries one), so the role _vocabulary_ is a contract concern. Cerbos policy is an _implementation_ of authorization over that vocabulary
- [ ] The objection — "moving it couples contracts to the Cerbos policy repo" — only holds if the **drift test moves too. It does not.** Contracts owns the vocabulary and never learns about Cerbos; authz owns enforcement and proves its policy matches. The coupling stays in the package already coupled
- [ ] Verify no cycle and no bundle regression after the move
- Raised by the implementer, who correctly declined to refactor the spine on their own reading

### YT-0510 · Delete duplicate business shapes from `apps/api`
`doing` · P0 · platform · 1h · dep: YT-0508

- [x] `apps/api/src/modules/business/domain/` deleted, 25 import sites repointed. Code lines diffed pair-by-pair first: billing-contact and kyb-document identical, business-member differed only in import path. api 97→72 tests is those 25 moving to contracts (229→258), not lost coverage
- [x] A newer doc comment on the `apps/api` copy — that `ops` has `approve`/`reject` reserved with a policy-level DENY but no route calls them — was **merged forward before deleting.** That detail would otherwise have been silently lost, which is the usual way a delete-the-duplicate task loses information
- [ ] `apps/api` holds local copies of business-member, billing-contact and kyb-document, now superseded by contracts
- [ ] Delete and re-point; two definitions of a shared shape is how they drift apart

### YT-0511 · Repo-wide formatting gate
`doing` · P0 · infra · 1h · dep: —

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
`doing` · PU · web · 2d · dep: —
- [ ] `docs/15` locked RHF + Zod resolver, but neither was ever installed — **now installed (2026-09-19)**
- [x] Migrated the three genuine multi-field forms; Server Components and single-field forms left alone, matching this ticket’s own carve-outs
- [ ] ⚠️ **`/onboarding/[region]/consent` measured 181.1 KB gz — over the 180 KB justify line**, for React Hook Form on a three-checkbox form. Under the 200 KB hard gate, so not a failure, but it is exactly the trade `docs/13b` §8 says must be stated rather than absorbed: is RHF worth a few KB on a form this small, or should that one stay hand-built?
- [ ] ⚠️ **`phone-verification-flow.tsx` is 301 lines — one over the ceiling**, pre-existing and untouched by this work. Needs `PhoneEntryStep` / `CodeEntryStep` extracted
- [ ] The campaign builder hand-built its forms against an uninstalled lock. Migrate them
- [ ] Hand-rolled validation, error and dirty-state handling across a multi-step builder is exactly where form bugs live

### YT-0526 · Testable HLS fixture for the player
`doing` · PU · web · 1d · dep: YT-0521
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
`doing` · P0 · platform · 2d · dep: YT-0031

- [x] `listingSchema` carries a **`locations` array** (min 1), not a single `district: string` — `packages/contracts/src/listing/merchant-location.ts`
- [x] Each location has an id, name, address and district, so a voucher can name **which branch honours it** — `voucherSchema.location` (denormalised, same reasoning as `merchantName`: must stay honourable offline)
- [ ] Surfaced in the offer page, the voucher detail and the merchant redemption portal — **not done here.** That is `apps/web` (out of this seat's editable scope) and the BFF endpoint (separate ticket); this ticket lands the contract those surfaces need
- Found by Phase U (YT-0421). This is a **product gap, not a UI gap**: a multi-branch merchant can currently show only one outlet, and which branch honours a voucher is load-bearing for redemption and for disputes
- **Breaking change to `apps/web`**, flagged per CLAUDE.md: 9 files read `.district` directly (`store-facets.ts`, `store-listing-card.tsx`, `store-offer-card.tsx`, `public-merchant.ts`, `public-merchant-content.tsx`, `public-offer-content.tsx`, `console-header.tsx`, `opengraph-image.tsx`, `public-merchant.test.ts`) and will fail to compile against the new shape until the UI stream updates them to read `locations[]`. Everything inside `packages/contracts` (mocks, region fixtures, tests) is already updated and green
- Verified 2026-09-19: `pnpm --filter @yourtal/contracts test` — 299/299 passing; typecheck and lint clean; OpenAPI document regenerated and Go models regenerated (`MerchantLocation` added)

### YT-0503 · Campaign contract: chapters and video source
`doing` · P0 · platform · 2d · dep: YT-0031

- [x] Chapter markers (start, title, reward weight) on the campaign contract — `packages/contracts/src/campaign/campaign-chapter.ts`. No stored `endSeconds` or absolute per-chapter reward: both are derived (`chapterEndSeconds`, `chapterRewardPoints`) from the campaign's own `durationSeconds`/`rewardPoints`, per docs/13's "never store a value you can derive" — `rewardWeight` is what apps/web's local fake calls a weight already, this makes it the contract's own field instead of a client-side back-loading table
- [x] A video-source field the player can resolve without guessing — `campaignVideoSourceSchema` (`{kind: "hls", manifestUrl}`), additive shape for a later `mp4`/renditions variant
- [ ] Replaces the local fakes Phase U left commented in the player — **the contract is in place; deleting `apps/web/features/player/chapter.ts`, `derive-chapters.ts` and `video-source.ts` in favour of it is `apps/web` work**, out of this seat's editable scope. `chapterRewardPoints` reproduces `derive-chapters.ts`'s `distributeBackLoaded` exactly (same docs/06 §3 worked example, `[1,1,1,2,5]` → `[200,200,200,400,1000]` on 2,000 points) so the swap should be a straight replacement
- New cross-field rules on `campaignSchema` (6 total now, up from 2): long_form requires ≥1 chapter and quick requires none; first chapter starts at 0; chapter starts strictly increasing; every chapter starts before `durationSeconds`
- **Breaking change to `apps/web`**: `campaignSchema.parse({...})` literal calls in `burn-data.ts`, `burn-test-fixtures.ts`, `video-player.test.tsx`, `reports-metrics.test.ts`, `reports-fixtures.ts`, `reports-campaign-overview-table.test.tsx` will fail validation without `chapters`/`videoSource`. `mockCampaigns`/`generateCampaign` consumers are unaffected
- Verified 2026-09-19: same full-suite run as YT-0502, same result

### YT-0504 · Wallet contract: points history and ledger projection
`doing` · P0 · platform · 3d · dep: YT-0031, YT-0041

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
`doing` · P0 · web · 3d · dep: YT-0404

- [x] Budget rating uses `docs/08` §3.1’s own numbers rather than Lighthouse’s looser CWV defaults, and device class is labelled a **heuristic** because Safari and Firefox expose neither `hardwareConcurrency` nor `deviceMemory`
- [ ] ⚠️ **There is nowhere to send the samples.** No event-ingestion contract exists (YT-0059 is still `todo`), so the sink logs in development and is a **silent no-op in production rather than faking delivery**. Every sample already carries the segmentation a p75-and-alert pipeline needs; only the transport is missing, and only `rum-sink.ts` changes when YT-0059 lands
- [x] **A self-inflicted regression caught and fixed in the same pass:** mounting the reporter in the shared shell pulled `web-vitals` into every `(app)` route and pushed `/business/campaigns` to 200.9 KB, over the hard gate. Now dynamically loaded — telemetry not needed before interactivity has no business in that budget
- [ ] INP is a **field** metric and Lighthouse cannot measure it; TBT ≤ 200 ms is the lab proxy and must be labelled as a proxy wherever it appears
- [ ] Real-user monitoring reports p75 INP, LCP and CLS segmented by country, connection and device class
- [ ] Alert when p75 on mid-tier Android breaches the budget in the field, not only in CI

### YT-0036 · Consent service v1
`doing` · P0 · platform · 5d · dep: YT-0030

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
`doing` · P0 · platform · 3d · dep: YT-0030

- Verified 2026-09-19: 46 tests passing, largest file 136 lines, no barrels. `resolvePolicy` takes a raw string so an unknown code hits a **standalone restrictive literal** (cash-out off, draws off, age 21, residency required, KYC enhanced) rather than one derived from real data — genuinely fail-closed, not merely claimed
- ⚠️ `minimumAgeYears: 18` is a **placeholder with no legal citation**. See position ID-12 / AU-9 in `docs/24-legal-positions.md`
- [x] Single source of truth for cash-out on/off, draws on/off, min age, residency, KYC tier
- [ ] Every regulated feature reads its switch from here, never from config — **unticked deliberately: no regulated feature exists yet to read it.** Carried as a standing check at each phase gate rather than a one-time tick
- ⚠️ **YT-0534's answer lands here, not on infrastructure — raised by `yourtal-22` 2026-09-20 and it is right.** Helios is in **Jakarta**, so Australian personal data on it is an **APP 8 cross-border disclosure**, where the entity stays accountable for what the overseas recipient does. That is a **live question on the primary market**, not a deferred one
- ⚠️ **And this service has no switch for it.** The single source of truth covers cash-out, draws, minimum age, residency and KYC tier — **residency of the _user_, not residency of their _data_.** A jurisdiction policy service that cannot answer _"may this person's data be stored where we are about to store it"_ leaves the one question the deployment actually raises to be answered by whoever is writing the repository that day
- [ ] A **data-residency switch per jurisdiction**: where this jurisdiction's personal data may be held, and on what basis if it leaves. Fail-closed like the rest — an unknown jurisdiction refuses storage rather than permitting it
- [ ] The switch is **read by something**, not merely declared. Per the criterion above, that is a standing phase-gate check rather than a one-time tick
- [ ] Interacts with **YT-0036 (consent)**: APP 8 has consent-based routes, so what a user was told about where their data goes has to be captured at the point they agree, not reconstructed later

### YT-0038 · Hash-chained audit log
`todo` · P0 · platform · 4d · dep: YT-0516

- Re-parented onto the local stack (YT-0516): this needed _a_ service, not a _managed_ one. The cloud task now covers deployment only.
- [ ] Append-only, per-record hash chain, verifiable offline
- [ ] Covers bulk issuance, ledger adjustment, campaign approval, refunds, role changes
- [ ] No service can delete or update a record

### YT-0039 · Idempotency middleware (TypeScript)
`doing` · P0 · platform · 3d · dep: YT-0031

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
`doing` · P0 · media · 3d · dep: YT-0503

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
`doing` · PU · web · 1d · dep: YT-0526

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
`doing` · P0 · platform · 4d · dep: YT-0527, YT-0518

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
`doing` · P0 · platform · 4d · dep: YT-0552, YT-0101, YT-0120

**Done. `apps/api` 96 → 112 tests, all against real Postgres. `pnpm verify` 11/11, 1982 tests, lint 11/11.**

- [x] **Campaign reads serve the derived status only.** The repository returns `Campaign`, whose `status` has no value capable of expressing `draft`, `in_review` or `rejected` — the leak is **unrepresentable rather than filtered**, which is stronger than remembering to exclude them per route. A campaign with no public form is a 404, identical to one that does not exist, because distinguishing them confirms a draft with that id exists
- [x] Rows are **parsed** through `campaignSchema`, not cast. YT-0548 was a table whose every row failed that parse, unnoticed for weeks because nothing read a campaign back
- [x] **Completion is decided server-side by coverage.** There is no endpoint that accepts "I finished": `complete` re-reads recorded coverage and judges. A client that scrubs to the end and asks gets a refusal naming the unwatched seconds, and a test asserts the controller has no method that could take a completion claim
- [x] **The rate check uses the server's clocks, both of them.** `reportedAt` is recorded for audit and never used — a test passes a timestamp an hour in the future and the refusal is unchanged
- [x] Same `PrincipalService.resolve(request)` / `@Authorize` seam as every existing route, on `campaign_view` rather than `campaign`: a viewer asking to watch must not be answered by a policy written about authoring
- [x] Session ownership is checked in the controller, not the PDP — no role makes someone else's session yours, and a row-level fact does not belong in a policy file that cannot see rows. Someone else's session is a 404
- [x] ⚠️ **`complete` currently refuses every completion**, because the question bank does not exist (YT-0102/YT-0122) and O-1 requires both halves. Hard-coded `questionsAnswered: false` rather than a permissive placeholder: a stub that let completion through would be a reward path nobody decided to open
- [x] ⚠️ **The first dead-host proof was invalid and said so.** `vitest.config.ts` sets `env.DATABASE_URL`, which **overrides a command-line value** — so pointing `DATABASE_URL` at a dead host left the suite green and would have been reported as proof. The test now resolves `TEST_DATABASE_URL` first, which the config does not set, and the break is real: the suite fails to load and every test is skipped

- **The models now have an API.** YT-0101 built the campaign lifecycle and YT-0120 the watch session; `apps/api/src/modules/` has since grown `campaign` and `watch` alongside `business` and `store`. The original note here read "contains only `business`", which stopped being true when this ticket's own work landed — **verified 2026-09-20 by `yourtal-24`**, who found it still being quoted as the reason this ticket was urgent
- [x] Campaign read routes serve what the public pages and the Earn board actually need, derived status included — never the authoring state. **`campaign.controller.test.ts` added 2026-09-20 by `yourtal-24`; 9 tests, and the routes now have coverage at all.** Two things it pins that nothing did before: the `limit` clamp, which the code itself calls an unauthenticated denial-of-service guard, and the deliberate 404 for a campaign that **exists but is not public** — the existing repository tests only ever passed a random uuid, which proves the missing case and says nothing about the non-disclosure one
- **Correction to this ticket's own audit note.** `yourtal-24` first recorded "campaign read routes have NO TESTS AT ALL". That was too strong and is withdrawn: `watch.controller.test.ts` already covered the *repository* — visible states, assembly, a missing id. What had no test was the **controller**, which nothing anywhere constructed, and therefore the two behaviours it adds on top of the repository. The directory being empty of `.test.ts` was read as the module being untested; the coverage was real and living in another module's file
- ⚠️ **Proving those tests by breaking them found something worth keeping.** The clamp sabotage landed first try. The draft sabotage took three: adding `draft` to `VISIBLE_STATES` alone left the suite green, and making `publicStatusOf` return `active` for a draft alone left it green too. **A non-public campaign is hidden by two independent controls and either one alone suffices** — the SQL filter means the mapping never sees a draft, and the mapping returning `undefined` means the row is dropped even if the SQL passes it. They mask each other, so no single-point sabotage can move the tests; breaking both at once turns exactly the three draft tests red. Good design, but it means **a future change removing one belt leaves this suite green while halving the protection**, and that trap is now written at the top of the test file
- [x] Watch session start / progress / completion, with completion decided **server-side by coverage** per O-4. The client reports; it does not conclude — `watch.controller.ts` exposes `@Post()` start, `@Get(":sessionId")` resume, `@Post(":sessionId/progress")` and `@Post(":sessionId/complete")`, the last taking **no body**, so there is no channel by which a client could assert completion. Verified 14/14 with the suite run alone
- [x] Authorization through the same `PrincipalService.resolve()` and `pdp.requireAction(...)` seam every existing route uses, so YT-0500 still changes only the body of `resolve()` — both controllers carry `@Authorize`, and `pdp.guard.ts` is the single caller of `principals.resolve(request)` for them. Structural, and true by inspection of the one seam
- [ ] ⚠️ **Prove the wiring by breaking it**, per YT-0552: point the database at a dead host and confirm these routes fail. A suite that passes either way is testing nothing, and that is the failure this project has found seven times. **Still genuinely open, and must stay open: `apps/api/vitest.config.ts` still hard-codes `env.DATABASE_URL`**, which overrides a command-line value — so this sabotage comes back green today for exactly the reason YT-0558 documents. Re-run it the moment YT-0558 lands
- ⚠️ **Until the campaign routes are tested, the `apps/web` screens they feed are verified only as far as the watch half.** The UI is substantially built; half of it has now met the backend
- ⚠️ **WITHDRAWN by its author, and the withdrawal is the useful part.** I recorded `yourtal-24`'s finding as "the campaign read routes have NO tests at all". Too strong, and they said so before anyone found it: `watch.controller.test.ts` already covered the repository — it was the **controller** that nothing constructed. **They read an empty directory as an untested module**, which is the same error class as my scrub reading `git log` for `git log origin/main`: a listing that answers a narrower question than the one being asked. The real gap was one layer, not two, and it is now closed by `campaign.controller.test.ts` (9 tests)
- ⚠️ **This is why the box was not ticked, and the reasoning generalises.** Read as prose the criterion looks satisfied: the routes exist, they carry `@Authorize({kind:"campaign_view", action:"watch_open"})`, and they return `Campaign`, a type that genuinely cannot express an authoring state. **Every word is true by inspection and asserted by nobody.** Given that this project's recurring failure is a control built, tested, then not used, **a route proved only by reading it is one step weaker again**
- ⚠️ The ticket header still reads _"Done. `apps/api` 96 → 112 tests"_, which is true and, for the campaign half, beside the point. **A true headline can hide an untested half**

### YT-0554 · The API must not connect to Postgres as a superuser
`review` · P0 · platform · 2d · dep: YT-0552

- [x] ✅ **Done and verified independently 2026-09-20.** `DATABASE_URL` is now `yourtal_app`, `DATABASE_OWNER_URL` is the owner, and `has_table_privilege` reports **owner `t`, app `f`** on `ledger.entry`. That write would have succeeded from application code before this change
- [x] The boot check **queries `pg_roles` rather than parsing the username out of the URL** — a username is what someone typed, the catalogue is what the server will actually permit
- [x] It runs in `OnApplicationBootstrap`, **not a module factory**: `new Pool()` is lazy and does not connect, so a check written there would first fire on the first query — after the app is already serving and reporting healthy
- [x] Atlas reads `DATABASE_OWNER_URL` with **no fallback to `DATABASE_URL`**, because a fallback would silently re-create the bug this ticket exists to fix
- [x] **CI was running everything as the superuser too**, so the grants were decorative there as well. `integration.yml` now uses the app role, with the owner only for schema bootstrap
- [x] Proved by breaking it **twice**, confirming the break landed each time — including sabotaging the new test's own assertion and watching 2 of 3 fail. **A test for a control that cannot fail is worth nothing**
- [x] Two URLs: **Atlas keeps owner DDL rights for migrations; the application gets `yourtal_app` and nothing more** — `packages/db/scripts/atlas.mjs` reads `DATABASE_OWNER_URL` and refuses to run without it; `packages/db/src/database-urls.ts` holds the per-role split
- [x] A boot-time assertion that the application's connection is **not** a superuser and does **not** hold `BYPASSRLS`, failing loudly — the same rule the driver seam applies to `live` without a credential. `apps/api/src/shared/persistence/assert-unprivileged-role.ts`, called from `persistence.module.ts` in `OnApplicationBootstrap`
- [x] ⚠️ **Prove it by breaking it**, and confirm the break lands: with the app role in place, a write to `ledger.entry` from the app must be refused. `packages/db/src/ledger-constraints.test.ts` asserts the app role is refused on `ledger.entry`; `assert-unprivileged-role.test.ts` asserts the owner URL is rejected by the boot check, so the assertion cannot pass vacuously

**Verification, 2026-09-20 (`yourtal-24`, independent of the session that did the work).** Both suites run in isolation: `assert-unprivileged-role.test.ts` 3/3, `ledger-constraints.test.ts` 10/10. Taken further than the suites, straight to the catalogue — `pg_roles` now reports `yourtal_app` as `rolsuper = f, rolbypassrls = f`, and `has_table_privilege('yourtal_app','ledger.entry','INSERT')` is **false** while the owner's is **true**. The control is live in the running application, not only in the tests.

**The finding that opened this ticket, and why the bullets below are past tense.** Before the fix, `pg_roles` showed `yourtal` with `rolsuper = t` and `rolbypassrls = t`, and `.env` pointed `DATABASE_URL` at it. Only `apps/api/vitest.config.ts` used the least-privilege `yourtal_app`.

- **So role separation was enforced in tests and bypassed by the running application.** Every grant boundary built to that point was decorative at runtime: `REVOKE ALL ON SCHEMA ledger FROM yourtal_app`, `ledger.daily_proof` being INSERT/SELECT only so a day can be proved once, the append-only entry grants, the frozen `campaign.terms_version`. A superuser connection ignored all of it, and **`BYPASSRLS` meant row-level security would not have applied either, the moment RLS existed.** **Closed 2026-09-20 — this is no longer true of the running app**
- This was the eighth instance of the `docs/13c` pattern and the most expensive shape of it: not a gate that fails to check, but **a control that was built, tested, and then not used**
- ⚠️ **The ticket itself then reproduced the pattern one level up.** The work landed, but the three acceptance boxes were left unticked as duplicates of the six above them, and the finding bullets were left in the present tense. So the board showed **6/9 `doing`** on a closed risk-45 item, and the entry read as a live superuser vulnerability for a day. **An inaccurate ticket is inaccurate in both directions** — this project has been watching for the optimistic tick, and was bitten by the pessimistic one

### YT-0555 · The schema-drift gate does not cover the business module
`todo` · P0 · platform · 1d · dep: YT-0552

- **Verified: `MAPPINGS` in `schema-drift.test.ts` covers listing, voucher, campaign, campaignTerms, campaignRewardConfig, watchSession and merchantLocation — and none of `businessSchema`, `BusinessMember`, `BillingContact` or `KybDocument`.** The gate that exists to catch a contract landing ahead of its migration **silently does not run for the one module that has a live API surface**
- [ ] Business schemas added to `MAPPINGS`, with any genuine gaps recorded in `fieldsAwaitingStorage` rather than left implicit
- [ ] ⚠️ **The gate should fail when a mapped schema is missing**, not only when a mapped field is. A per-schema opt-in list silently excludes whatever nobody remembered to add, which is the same failure one level up — the coverage table needs asserting in both directions, exactly as YT-0536 does for the boundary faults

### YT-0556 · Health endpoint
`doing` · P0 · platform · 1d · dep: YT-0552

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
- ⚠️ **Third instance, 2026-09-20, and it reached `main` — `yourtal-22`, fixed in `353b267`.** The store module's test helper hard-coded **`yourtal_wt_store`**, a *private worktree database* created for one agent on one laptop, as the fallback behind `TEST_DATABASE_URL`. It passed the local gate **twice**, for the only reason that matters: **on that machine the database existed.** The test was verifying the laptop
- ⚠️ This is worse than the first two, which were a config override. Here a **machine-specific name was committed into a shared repository** and would have failed for everyone else while reading as a normal green locally. **The ticket sat in `ready to start` the entire time** — a known defect with a written fix, arriving again in a new form before anyone picked it up. Cheap tickets left unstarted are not cheap
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
`doing` · P0 · value · 2h · dep: —

**Done. 100 Go tests, 0 skips; `pnpm verify` 11/11.**

- [x] **The fix is not a better pattern.** Widening `[a-z_]+` to `[a-z0-9_]+` would have fixed today's instance and left the shape intact. Every line inside a `CREATE TABLE` block is now classified — column, table-level clause, comment, or **error**. The guard fails on input it does not understand rather than covering less of it
- [x] An empty column list is now a failure too. A renamed table previously yielded no expectation, and an empty expectation compares nothing and passes
- [x] `backing_rate` is in the table list (landed by `yourtal-5a`); a table the loop does not name is one the guard cannot see drift in
- [x] **Six parser unit tests that need no database.** The DB-backed guard skips without Postgres, so the parser — which is where the defect was — had no coverage in `go test ./...` at all. These run everywhere the module builds
- [x] **Proved by breaking it.** Planted `sha256_digest` in `db/schema.sql` with no matching column in the database: the guard now reports the drift. Under the old pattern that column was unmatched and therefore never compared, so the test would have passed
- The general form, now in `docs/13c`: **every parser-based check needs one question asked of it — what does it do with input it does not recognise?** If the answer is "skips it", its coverage is whatever the pattern happens to match, which is not a set anyone has reviewed

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

### YT-0568 · Line endings were never renormalised after `.gitattributes` landed
`review` · P0 · infra · 1d · dep: —

- `.gitattributes` declares `* text=auto eol=lf` and marks `*.sh`, `*.mjs`, `*.sql`, `Dockerfile*`, `*.yml` and `.githooks/*` as LF-required — because this repo is authored on Windows and deployed to Linux, and `bad interpreter: /usr/bin/env sh^M` is a **recorded failure in this organisation's fleet notes**, not a hypothesis
- ⚠️ **The file was added but the working tree was never renormalised**, so the declaration and the bytes on disk disagree. A `git add --renormalize` was started and abandoned mid-session because it collided with a file another session was regenerating
- ⚠️ **It is already costing time**: an exact-match edit to `packages/db/src/voucher-constraints.test.ts` failed today because the file is CRLF on disk while every tool reports it as LF-declared. That is a silent class of edit failure across the repo
- [x] ⚠️ **`git add --renormalize .` was the wrong instruction and staged ZERO files.** Git compares content *after* normalisation, so the index was already LF and it saw nothing to do — while **27 files sat on disk with CRLF** and `git status` stayed clean throughout. The actual fix is to delete the affected files and `git checkout -- .`, so git rewrites them per the attribute. Done, with `core.autocrlf` set to `false` locally so the setting stops fighting `.gitattributes`
- [x] `.githooks/pre-commit` confirmed **LF on disk**; it is the only tracked shell script
- [x] No `.ps1`/`.bat`/`.cmd` is tracked, so there was nothing to flip — checked rather than assumed, because flipping them is the way this fix breaks things
- [x] `scripts/check-line-endings.mjs`, wired into `pnpm verify`. It asks **git** for each path's attribute (`check-attr --stdin`) rather than keeping a second hard-coded list that could drift from `.gitattributes`. **Sabotage-proved**: the hook rewritten as CRLF, guard named it and the exact count (`19 CRLF line ending(s)`) and exited 1; restored, green across 1285 files

### YT-0569 · No CI has ever run, and the workflows watch a branch that does not exist
`todo` · P0 · infra · 2d · dep: —

- **The repository has no git remote.** All six workflows — `integration.yml`, `go.yml`, `quality.yml`, `contracts.yml`, `authz.yml`, `format.yml` — have **never executed once**. Every guarantee expressed as CI is currently a statement of intent
- ⚠️ **Risk 37's mitigation is one of them.** _"Fixed by `integration.yml` with real service containers and a build failure on any SKIP"_ describes a workflow that has never run. The Postgres-backed guarantees it was written to protect are still unprotected
- ⚠️ **Every workflow triggers on `branches: [main]`; this repo's branch is `master`.** So they would not fire on push even the moment a remote is added — the failure would be silence, which looks exactly like success
- ⚠️ `go.yml` and the others also filter on `paths:`. A change in `packages/db/migrations` that breaks `services/ledger`'s schema expectations matches no Go path and would not trigger the Go gate. **Path filters make a cheap gate; they also make a gate that a cross-cutting change walks straight past**
- [x] **Done 2026-09-20.** Remote is `github.com/gaiadabali/yourtal` (private, org-owned), provided by the founder; branch renamed `master` → `main`. Auth is **HTTPS via the `gh` CLI**, not SSH — no key in `~/.ssh` is registered with GitHub, and `ssh-key-hansel` is the *fleet* key for Helios. Do not set `credential.helper` locally; an empty local value overrides gh's global helper
- [x] **No deliberate break was needed — every workflow failed on its own first execution**, six ways, none of them a CI quirk. Each was then fixed and watched go green. That is the same evidence a manufactured break would have given, and it cost nothing to obtain. Green on `2d48866`: Integration, Quality, Format, Contracts, Authorization policies, and **Go modules, which ran for the first time in this repository's history**
- [ ] `integration.yml` stands up Postgres, Cerbos and MinIO and the whole chain runs — **proven** (`Found 16 executable policies`, `packages/db` 7 files, idempotency 3, `apps/api` 26 against a live PDP, `@yourtal/media` 3, all 14 packages in scope, zero skips). **What is NOT yet proven is the SKIP guard itself**: every no-skip step has only ever been seen passing. Sabotage it — add an `it.skip`, confirm the build goes red, remove it. Per `docs/13c`, a guard first seen green has not been shown to work, and this workflow now has five of them
- [x] `integration.yml` carries `-count=1 -p 1` on all four Go invocations, and its `Assert nothing skipped` steps passed for both ledger and voucher. `go.yml` carries `-count=1` and deliberately **not** `-p 1` — it has no Postgres, so the YT-0567 race cannot occur there
- [ ] Decide whether path filters stay. If they do, cross-cutting paths (`packages/db/migrations/**`, `packages/contracts/**`) trigger the Go gate too
- [ ] ⚠️ **`perf-budget.yml` triggers on `pull_request` only — it has no `push` trigger at all.** Work goes straight to `main` without PRs, so the performance budget gate (LCP ≤ 2.0s, initial JS ≤ 200KB, TBT ≤ 200ms) **cannot run under the way this project actually commits**. Either it gains a `push` trigger or the project starts using PRs; leaving both as they are means the budget is enforced by nobody
- [ ] ⚠️ **`go.yml` had still not run** as of five pushes after the remote was added, because its `paths:` filter matched none of them. A gate that waits for a matching path can sit unexecuted indefinitely while reading as configured — this is the path-filter concern above, observed rather than predicted

### YT-0570 · Bring the Go services into `integration.yml` once they are in compose
`todo` · P0 · infra · 1d · dep: YT-0569

- `yourtal-22`'s agent 2 is adding `ledger` and `voucher` to `docker-compose.yml` with Dockerfiles, and giving the ledger real HTTP routes over its existing `internal/` libraries. CI has to follow. **Recorded now because the constraints are cheap to capture while fresh and expensive to rediscover**
- ⚠️ **The voucher service cannot be a `services:` entry, for two independent reasons.** It refuses to boot without a keyring — deliberately, there is no keyless mode — and `internal/keyring` refuses a master key that lives inside a git working tree, also deliberately. So CI needs a **generated key directory outside the checkout, mounted in**, which a `services:` block cannot express (no `command`, and the key does not exist yet when services start)
- ⚠️ So it needs the post-checkout `docker run` pattern **plus a step in front of it** that generates the key. Cerbos and MinIO already use that pattern for their own, different reasons — see [`docs/13d`](../13d-lessons.md) §3 and §8, and note that §8 exists because the two reasons were wrongly assumed to be the same one
- [ ] Container names are **`yourtal-ledger` and `yourtal-voucher`**, matching `docker-compose.yml`. Not tidiness: `packages/media/src/delivery-log.test.ts:40` hardcodes `yourtal-minio` and shells out to `docker logs`, and naming a CI container differently already cost one red build
- [ ] Key generation happens **outside `$GITHUB_WORKSPACE`**, and the keyring's refusal-inside-a-working-tree check is confirmed still firing — a guard that CI works around is a guard that has been disabled
- [ ] Any new Go test needing Postgres is **reachable from `integration.yml`**. `go.yml` has no database by design, so such a test skips there silently and is caught nowhere. Confirm reachability by running it, not by asserting it
- [ ] Health is not readiness, per YT-0527: assert the services answer a real route, not merely that the container is up

### YT-0574 · A two-person-approval control that a missing attribute switches off
`todo` · P0 · platform · 2d · dep: YT-0035

- **Found by `yourtal-22`'s agent 3, verified here against `main`.** `policies/resource_policies/listing.yaml:41` guards `set_settlement_value`:
  `expr: "!has(R.attr.isMaterialSettlementDecrease) || !R.attr.isMaterialSettlementDecrease"`
- ⚠️ **It is an `EFFECT_ALLOW` rule whose guard is satisfied by absence.** A missing attribute makes `!has(...)` true, the allow fires, and **every settlement-value cut passes as non-material however large it is**. Worth stating precisely because the fix follows from it: this is not a deny that fails to fire, it is an **allow that accepts silence as evidence**
- ⚠️ **And the attribute cannot be supplied by the normal mechanism.** `@Authorize`'s `attrsFrom` is `(request: FastifyRequest) => Readonly<Record<string, unknown>>` — **synchronous, request-only, no database read** — while materiality is a comparison against the *currently stored* `S`. So a controller using the declarative decorator alone, which is the correct and universal pattern everywhere else, sends no attribute. **The correct usage disables the control**
- ⚠️ **Two independent places agree that absence is fine**, which is why nothing objects: the policy expression above, and `policies/_schemas/resource/listing.json`, where `required` is `["businessId"]` only. The schema permits the omission and the rule rewards it
- ⚠️ **`TwoPersonApprovalSuite` passes 28 of 28 against a control that is switched off.** Reported by `yourtal-22` from the merge, and it is a sharper example than the expression itself: the fixtures supply `isMaterialSettlementDecrease` directly, so **the absence case — the only case a real controller produces — is never exercised**. The test suite for the control and the control's real-world failure mode **do not intersect at all**. Nothing had ever reached this policy over HTTP, because there was no store module. **Merged, tested, and unreachable; the first correct caller would have silently disabled it**
- [ ] The expression requires **positive evidence**: `has(R.attr.isMaterialSettlementDecrease) && !R.attr.isMaterialSettlementDecrease`, so a missing attribute **denies**
- [ ] `isMaterialSettlementDecrease` becomes **`required`** in the resource schema, so the omission is refused before the expression is even reached
- [ ] Sabotage-prove both: call `set_settlement_value` with the attribute **absent** and confirm a deny. A policy test that only ever supplies the attribute cannot see this class at all
- [ ] Audit every other `has(...)` in `policies/` for the same shape — **a guard whose condition is satisfied by absence is a guard that anyone can turn off by saying nothing**
- [ ] ⚠️ `policies/` was **`yourtal-e3`'s and that session has ended**, so this is unowned. It needs an owner before it needs a fix
- ⚠️ **CORRECTION 2026-09-20 (`yourtal-22`, merged `074dc20`): the absence-case test does not test the CEL expression — it tests the schema.** Isolated three ways: OLD expression + NEW schema → **390 OK, passes**; OLD expression + OLD schema → **3 FAILED**; NEW expression + NEW schema → 390 OK
- ⚠️ So **the `required` schema change is the fix, and the stronger one because it fails earlier** — once the attribute is required, a resource lacking it is denied at validation before CEL is evaluated. **For every schema-valid input the two expressions are behaviourally identical.** The CEL change is defence-in-depth that **no test can pin**: revert it tomorrow and all 390 still pass
- ⚠️ Both are kept — the expression is correct on its own merits and schema enforcement is not guaranteed on every path — but this ticket must record **one verified control and one unverified by construction**, not two verified ones. Otherwise the next reader takes 34 green tests as covering both
- ⚠️ **Twice in one day this suite measured something adjacent to what it named**: at 08:00 it passed 28/28 against a fully broken control because fixtures supplied the attribute; by 09:00 it passed 34/34 against a half-fixed one because the schema masks the other half. General form for `docs/13d`: **when two fixes land in one commit and one masks the other, the tests verify the pair rather than the parts**, and the weaker one silently stops being covered
- ⛔ **SECOND CORRECTION: the `required` schema change was REVERTED — it guarded one action by breaking every other one.** Cerbos validates the resource schema **before** evaluating policy, and `required` applies to the **resource kind**, not to an action. So `approve_settlement_decrease` — which has no business carrying a materiality flag — was refused before any rule ran. It turned Integration red on three consecutive commits with a 403 `not permitted to approve_settlement_decrease`
- [x] **The CEL fix is sufficient alone**, which inverts the first correction: attribute optional, fresh sidecar, absence-case tests still DENY all three principals, policy suite 390/390, `apps/api` 33 files / 164 tests green. The expression is the control after all
- ⚠️ **A long-running Cerbos container is not equivalent to a fresh one.** It passed locally because the sidecar was serving schemas **cached from before the change**; CI starts Cerbos clean. `docker restart yourtal-cerbos` is part of verifying a policy change, not an afterthought — and this is a new member of the same family as a cached `turbo` task and a cached `go test`
- ⚠️ **The policy suite could not have caught it.** `policy-test.mjs` runs its own ephemeral Cerbos over the fixtures, and every fixture for the *other* actions predates the attribute — so none exercised an approve against the tightened schema. **The suite tested the rule that changed, not the resource kind it changed on**
- ⚠️ **The general form, and the fifth of this family in one day: a control added to a SHARED definition is not scoped to the case that motivated it.** The schema is shared by every action on the kind; the motivation was one action. It cost a single commit only because the agent's report proved each fix closes the hole independently, which made the schema change removable rather than a redesign

### YT-0575 · `approve_settlement_decrease` is a rule with no way to invoke it
`todo` · P1 · platform · 3d · dep: YT-0574

- The policy routes a material decrease to `approve_settlement_decrease`, and `packages/authz/src/resources.ts:64` registers the action. **Verified: there is no endpoint, no controller and no workflow anywhere** — it is the only reference outside the policy
- So even once YT-0574 makes the deny fire, the thing it redirects to **does not exist**: a material decrease would be refused with nowhere to go. A correct control that strands the user is still a broken feature
- The schema already anticipates the shape — `requestedBy` and `approvalState` (`none` / `pending` / `approved`) are declared, and a separate rule enforces `requestedBy != approver`. **The design is written; only the endpoints are missing**
- [ ] Propose and approve endpoints, with `approvalState` transitions persisted rather than inferred
- [ ] The approver **cannot be the requester** — proved by trying it, not by reading the policy that says so
- [ ] A pending proposal is visible to whoever must approve it; a control nobody is told about is a control nobody operates

### YT-0576 · Nobody has defined what makes a settlement decrease "material"
`blocked` · P1 · economy · 1d · dep: —

- ⛔ **Decision needed from the founder or whoever owns the economy (YT-0050).** `docs/17` line 84 requires two-person approval for _"changing a settlement value downward by more than a threshold"_ and **names no number**. `policies/_schemas/resource/listing.json` repeats _"more than the threshold"_. The policy expression consumes the boolean. **Three references, zero definitions**
- ⚠️ `yourtal-22`'s agent used **20% as a loudly-commented placeholder** so the check would not be a no-op. That is correct engineering behaviour and it leaves **a number one agent invented sitting in front of a two-person-approval control**
- The threshold decides how often a merchant needs a second person to cut `S`. Too low and it is friction on ordinary repricing; too high and the control never engages. It also interacts with the pricing engine: `points_price = (S / B) × demand_multiplier`, so a decrease in `S` is a **direct cut to what a user's points are worth in that store**
- [ ] A number, or a rule that yields one (percentage, absolute floor, or both — a 5% cut on a large `S` may matter more than 30% on a small one)
- [ ] Whether it is measured per change or cumulatively over a window. **A threshold per change is trivially evaded by making several small ones**
- [ ] Where it lives so it is not re-invented: a named constant the policy, the API and the docs all read

### YT-0579 · `turbo run test` strips the env var every isolation escape hatch depends on
`todo` · P0 · infra · 1d · dep: —

- **Raised by `yourtal-22`, sharpened by `yourtal-24`, 2026-09-20.** Under Turborepo's strict env mode, `turbo run test` strips **`TEST_DATABASE_URL`** and **`DATABASE_OWNER_URL`**. `TEST_DATABASE_URL` is the escape hatch every newer test helper relies on — it exists *specifically because* `apps/api/vitest.config.ts` sets `env.DATABASE_URL` and thereby overrides a command-line value (YT-0558)
- ⛔ **This is bigger than YT-0558 and is why it is its own ticket.** That one is a file's problem; this is **the gate's**. Under `pnpm verify` — the only gate we have while GitHub is frozen — **no suite can be pointed at an isolated database, and the dead-host sabotage convention is unavailable precisely where it is enforced.** `yourtal-24` put it best: **the escape hatch does not survive the only path that matters**
- Found the hard way: a policy agent could not run a literal `pnpm verify` from its branch at all, and ran every clause individually with the documented `--env-mode=loose` per invocation rather than edit `turbo.json`, which was outside its allowlist
- ⚠️ **Same family, also open:** `packages/db/src/database-urls.ts` hard-codes `APP_URL` to the shared `yourtal` database with **no override at all** — only `OWNER_URL` honours an env var — so `packages/db`'s own suite cannot be pointed at an isolated database either
- [ ] `turbo.json` passes `TEST_DATABASE_URL` and `DATABASE_OWNER_URL` through, or the gate documents `--env-mode=loose` as the supported invocation. **One or the other, not both**
- [ ] `APP_URL` honours an override like `OWNER_URL` does
- [ ] ⚠️ **Prove it the way the flaw was found**: point a suite at a dead host through `pnpm verify` itself and confirm it FAILS. A sabotage that only works outside the gate is not a sabotage of the gate
- [ ] ⏭️ `apps/api/vitest.config.ts`'s override is YT-0558 and stays there — YT-0553's sabotage criterion correctly cites it rather than claiming it
