# Phase 0 · Legal, infrastructure, platform

Nothing user-visible ships except a login. **Gate:** a sister app can log a user in via YourtalID, call the Reward Engine, and have points appear as balanced ledger entries that survive a replay and a reconciliation run — with legal sign-off on the currency model in writing.

---

> Legal and infrastructure. Platform tasks are in [`phase-0-platform.md`](phase-0-platform.md).

## Legal

### YT-0010 · Legal positions register
`doing` · P0 · legal · 4d · dep: —

- **Audited 2026-09-19: three of four criteria already met, still recorded as not started — while blocking four tasks.** `docs/24-legal-positions.md` exists with 19 positions
- [x] Every legal position the product relies on stated explicitly in `docs/24-legal-positions.md`
- [x] Each position traced to a primary or official source, with a confidence rating
- [x] Residual risk named per position; unsourced positions marked as guesses — ID-12 and AU-9 (minimum age) are carried openly as uncited
- [ ] ⚠️ **Re-verification dates are missing** — the one criterion unmet, and the one that matters most over time. A legal register with no expiry quietly becomes a record of what was true once. Both regimes are mid-reform: Australia's Privacy Act is in passage, and Indonesia's GR 33/2026 sanctions bite 16 Jan 2027

### YT-0011 · Red-line register and enforcement
`todo` · P0 · legal · 2d · dep: YT-0010

- [ ] The ten absolute prohibitions published where product and sales will actually read them
- [ ] Each red line mapped to the feature flag or code path that enforces it
- [ ] Jurisdiction policy service defaults set so a red line cannot be crossed by configuration alone
- [ ] Sales training covers the breakage-claim prohibition specifically (Scoopon precedent)

### YT-0012 · Counsel-substitution risk acceptance
`todo` · P0 · legal · 1d · dep: YT-0010

- [ ] Founder signs off, in writing, on proceeding without advisory counsel
- [ ] The concentration of exposure in ID-1/ID-2 (points as e-money) explicitly acknowledged
- [ ] Triggers that force engaging counsel regardless of budget agreed and recorded
- [ ] Budget line reserved for one narrow opinion on the e-money question in Indonesia

### YT-0013 · Entity formation via notaris and corporate services
`todo` · P0 · legal · 10d · dep: YT-0012

- [ ] **Notaris engaged** — PT/PT PMA formation is a notarial act and has no research substitute
- [ ] Local corporate services provider engaged for OSS, NIB and domicile
- [ ] PT PMA (Indonesia) and Pty Ltd (Australia) structure confirmed, with the ≥15% local ownership path
- [ ] Formation instructed

### YT-0014 · PSE registration (Indonesia)
`todo` · P0 · legal · 5d · dep: YT-0013

- [ ] Registered with Komdigi via OSS as a private-scope ESO
- [ ] Registration number recorded and displayed as required

### YT-0015 · Consumer-facing legal copy
`todo` · P0 · legal · 8d · dep: YT-0010

- [ ] T&Cs, privacy policy and points terms drafted per jurisdiction, in Bahasa and English
- [ ] Drafted against the positions register and published regulator guidance, not from a generic template
- [ ] Consent text versioned and wired to the consent service schema
- [ ] Points expiry, transfer and forfeiture rules stated plainly, in language a user actually understands

### YT-0016 · Tax position on marketplace withholding
`todo` · P0 · legal · 3d · dep: YT-0010

- [ ] Indonesian marketplace withholding obligations on seller income confirmed with a tax consultant
- [ ] This is the one position the register rates Low confidence and it is financial, not theoretical
- [ ] Settled before the first merchandise order, not after

## Infrastructure

### YT-0527 · Cerbos in the integration workflow
`review` · P0 · infra · 1d · dep: YT-0516
- [x] `integration.yml` now stands up Cerbos alongside Postgres, so the `apps/api` boot check and PDP-backed route tests run in CI, not just against a mocked `fetch`
- [x] The 403-before-any-rule regression (YT-0500, `policies/_schemas/resource/business.json`'s comment on `businessId`) is exactly the class this catches — sabotage-tested: re-required `businessId` on the schema, `app.boot.test.ts`'s create case failed with `expected 403 not to be 403`, reverted, green again
- [x] Added Cerbos as a second service container, mounting `policies/` and `infra/cerbos/config.yaml` exactly as `docker-compose.yml` does; noted the GH Actions container-start-before-checkout ordering and why `watchForChanges` still covers it
- [x] Same no-skip posture as the Postgres suites: a dedicated `Assert apps/api reported nothing skipped` step, mirroring the Go ledger's SKIP guard
- Also added `apps/api/src/app.boot.test.ts` (boots the real `AppModule`, calls it over real HTTP against a live Cerbos — no `fetchImpl` override anywhere in it) and fixed a live drift: `env.schema.ts`'s `PDP_BASE_URL` default was `:3592` (Cerbos's own default) while `docker-compose.yml` and `.env.example` both map it to `:26592` — a bare `pnpm dev`/`pnpm test` with no `.env` was pointing at a port nothing binds locally, and on this machine `:3592` happens to have an unrelated project's Cerbos listening, which would have been a silent cross-project policy mix-up. Fixed and pinned with a drift test, `env.schema.test.ts`, per docs/13's "guard the copy" rule
- Verified 2026-09-19 against the real local stack (`pnpm dev:up`, Cerbos on 26592): `pnpm --filter @yourtal/api test` — 23 files, 96 tests, all green; typecheck and lint clean
- Trigger paths widened to `apps/api/**`, `packages/authz/**`, `policies/**`, `infra/cerbos/**` — previously the workflow would not even run on changes to any of these


### YT-0516 · Local development stack — **no cloud account needed**
`review` · P0 · infra · 1d · dep: —

- [x] `docker-compose.yml` running **Postgres 17**, a **Cerbos 0.55.0** sidecar and **Valkey 8**, all loopback-bound on ports 26432 / 26592 / 26379 — chosen to miss the four other Postgres instances already on this machine. All three healthy
- [x] `.env.example` covering every variable `apps/api` reads, plus `pnpm dev:up` / `dev:down` / `dev:reset` / `dev:logs` / `dev:psql`
- [x] `apps/api` **boots** against it — handed to the Phase 0 owner to verify
- [x] Cerbos serves **real decisions**, not `cerbos compile` assertions. Verified with a live check; **schema enforcement is `reject`**, and the smoke request was correctly refused for a missing `jurisdiction` / `businessRoles` / `isSuspended` principal attribute
- [x] Six domain schemas and **separate `yourtal_ledger` / `yourtal_app` roles** created at init, with the app role revoked from the ledger schema — so a cross-module read fails as a permission error locally, per `docs/13`
- Runtime config lives in `infra/cerbos/config.yaml`, deliberately **not** in `policies/`, so the policy repo stays exactly what CI compiles
- ⚠️ **This should have existed from day one and its absence is a planning error of mine.** YT-0022 provisions _managed_ Postgres in GCP for _deployed_ environments; nothing about local development needs a cloud account. Treating them as the same dependency is why the idempotency store is in-memory and per-process, why every Drizzle line is typechecked but never executed, why there are zero migrations, and why `main.ts` has never started
- [x] **`apps/api` booted for the first time**, all nine routes mapped. Two real blockers: Node's type stripping cannot resolve this repo's extensionless imports, and esbuild cannot emit the decorator metadata NestJS DI needs — `@swc-node/register` does both. Live smoke through **real Cerbos and real Postgres**: anonymous → 401, create → 201, same key + same body → 201 with the identical id, same key + different body → 409, and the database confirms exactly one business row and one owner membership

### YT-0517 · Declare `services/*` and scaffold the Go module
`review` · P0 · infra · 1d · dep: YT-0516

- [x] `services/*` now declared in `pnpm-workspace.yaml`
- [x] Scaffold `services/` as one Go module per `docs/13a`, with `go build` and `go vet` in CI
- [x] **Zero Go service code exists today.** The only Go is generated types under `packages/contracts/openapi/go/`, and those are **untracked** — `git ls-files` returns nothing, so CI regenerates them and no reviewer ever sees them in a diff
- [x] `services/ledger` on Go 1.26 + chi. Builds and vets clean, runs, `/healthz` 200, unknown paths return the `docs/13` §5 envelope. **Verified independently: `go build ./...` exit 0**
- **Its own Go module, not one at the repo root** — a shared module lets the voucher service import the ledger's internals by accident; per-module means `internal/` means what it says. Cost is a CI matrix row per service, which is friction in the right direction
- **Deliberately contains no double-entry logic.** Those invariants exist and are enforced in Postgres (YT-0518). Writing a Go implementation of them before YT-0506 settles the money unit would be writing code against a number whose meaning is still open

### YT-0518 · First migration, executed
`review` · P0 · value · 2d · dep: YT-0516, YT-0043

- [x] **There are zero `.sql` files in the repository.** Atlas is the chosen migration tool (`docs/15`) and has never been run
- [x] Generate and apply the first migration against local Postgres, including `IDEMPOTENCY_TABLE_DDL`
- [x] Prove the ledger constraints from YT-0041 actually reject an unbalanced transfer **in the database**, not only in a unit test
- [x] `packages/db` with Atlas, **three migrations applied** against live Postgres: `platform.idempotency`, ledger, business. Atlas **pinned by digest, not tag** — `:latest` is a moving canary, and a migration tool that differs between a developer and CI is a bad surprise in the one process that edits production schemas
- [x] **Ledger rejects an unbalanced transfer in Postgres — independently verified.** A single-entry transfer fails at COMMIT: `ledger: transfer spot-t1 has 1 entries; double-entry needs at least 2`, from `ledger.assert_transfer_balanced()` with no service in the path. Also proved: zero-amount rejected, duplicate idempotency key rejected, `yourtal_ledger` denied UPDATE/DELETE, `yourtal_app` denied the ledger schema entirely
- **A DEFERRED constraint trigger, not a CHECK, and the reasoning is worth keeping:** a CHECK sees one row, and _"these rows sum to zero"_ is a statement about a set. It also cannot fire per-statement, because a transfer is legitimately built from several INSERTs. **Deferring to COMMIT is what makes the invariant absolute rather than "absolute except while we are mid-write"**
- Money columns are `bigint` minor units plus explicit currency. **This does not settle YT-0506** — that question is which integer a given amount _is_, and bigint is right under either answer
- **Defect found by YT-0043 and fixed:** `UNIQUE (owner_type, owner_id, currency)` encoded *one account per owner per currency* — right for a user, wrong for the platform, which needs issued, redeemed, breakage and marketing accounts at once. **A chart of accounts IS several accounts for one owner in one currency, so the constraint forbade the thing it existed to support.** Now a partial unique index over `user`, `merchant`, `charity` only, with both halves tested so the correction does not over-correct

### YT-0519 · Seed the real database from the mock generators
`review` · P0 · data · 2d · dep: YT-0518

- [x] `pnpm db:seed` loads the **existing deterministic generators** in `packages/contracts/*.mock.ts` into local Postgres — same data, real tables
- [x] Phase U surfaces read it through `apps/api`, not from in-process fixtures
- [x] Seed is idempotent and re-runnable; `pnpm dev:reset` rebuilds it
- [x] Includes the awkward fixtures YT-0403 already defines: long merchant names, zero balance, expired voucher, sold-out listing
- **This is what turns "it works against mocks" into "it works against the stack."** Fixtures cannot surface contract drift, N+1 queries, serialisation bugs, missing indexes or the seam failures this repo has already hit twice. The data stays synthetic; the path becomes real
- [x] Migration 4 first — `campaign`, `store` and `voucher` schemas existed with **zero tables**, so there was nothing to seed into. Tables shaped exactly as `packages/contracts` defines them, so a column disagreeing with a Zod field is now a bug in one of the two
- [x] **Verified independently:** 24 campaigns, 30 listings, 60 vouchers; re-run writes 0; **zero vouchers disagree with their listing**; and `listings_settlement_within_face` rejects a settlement above face value at the database
- [x] `pnpm dev:fresh` — reset, migrate, seed. One command from nothing to a working stack
- **The lost `.refine()` rules are now in Postgres**, closing the loop from `docs/13`: quick campaigns ≤ 60s, accuracy bonus requires questions, stock within total, sold_out has no stock, minimum_spend iff threshold, and **settlement within face value** — an economic invariant, not a formatting rule. Settlement above face means the platform pays out more than the voucher was ever worth, silently, on every redemption

### YT-0520 · Local identity provider
`review` · P0 · platform · 1d · dep: YT-0516

- [x] Zitadel in `docker-compose`, so OIDC is a real provider issuing real tokens locally
- [x] Replaces the `x-yt-user-id` header seam, which already has a production boot-guard and should not outlive it
- [x] YT-0032 then covers **deployment and realm configuration only**
- [x] **Zitadel v2.66 live at `http://localhost:26080`**, backed by its own database in the same Postgres. OIDC discovery serving; bootstrap login `dev@yourtal.local` / `DevPassword1!`
- Note for implementers: Zitadel's `ExternalDomain` is `localhost`, so requests must use `http://localhost:26080` — `http://127.0.0.1:26080` returns _Instance not found_, which looks like a broken container and is not one

### YT-0521 · Local object storage and media origin
`review` · P0 · media · 2d · dep: YT-0516, YT-0220

- [x] MinIO in `docker-compose` — S3-compatible, so the R2 adapter is exercised rather than stubbed
- [x] Local HLS origin serving real segments, so the player, prefetch and per-segment logging are testable end to end
- [x] **Per-segment delivery logs are the control Cloudflare Stream could not give us** (`docs/22`), so this is the first place attention verification can actually be proved
- [x] **MinIO live at `http://127.0.0.1:26900`** (console 26901), S3-compatible, so the R2 adapter is exercised rather than stubbed
- [ ] Local HLS origin serving real segments — still to build, and it is the first place per-segment delivery logging can actually be proved (`docs/22`)
- ⚠️ Image is `quay.io/minio/minio:latest`; Docker Hub's `minio/minio` is no longer public. **Pin by digest**, per the Atlas lesson in YT-0518

### YT-0522 · Split cloud tasks into local and deployed
`todo` · P0 · infra · 1h · dep: YT-0520, YT-0521

- [ ] YT-0020/0021/0022/0024/0025/0026 are re-scoped to **deployment only** in their titles and bodies
- [ ] Every downstream task now depends on a **local** capability that exists today
- [ ] A task blocked on a cloud account must say so explicitly, so the distinction never silently returns

### YT-0020 · GCP organisation, projects, billing, IAM baseline
`todo` · P0 · infra · 3d · dep: —

- **Deferred 2026-09-19 — Helios is the deployment target (YT-0529).** Kept because a two-region managed deployment is still the right production answer; it is no longer on the critical path and gates nothing.
- [ ] Separate projects per environment and per region; least-privilege IAM; no owner-role humans
- [ ] Budget alerts configured

### YT-0021 · Terraform skeleton and two data planes
`todo` · P0 · infra · 5d · dep: YT-0020

- **Deferred behind YT-0529.** The two-data-plane shape is the *policy* (`docs/02` country isolation) expressed as Terraform. Helios satisfies neither region; see YT-0534 for what that forbids us from storing there.
- [ ] One module instantiated twice: `asia-southeast2` (Jakarta) and `australia-southeast1` (Sydney)
- [ ] No resource can be created outside a region module
- [ ] `terraform plan` clean in CI

### YT-0022 · PostgreSQL provisioned per region
`todo` · P0 · infra · 3d · dep: YT-0021

- **Deferred behind YT-0531**, which provides Postgres on Helios with an actually-executed restore. Managed HA and PITR return with production.
- [ ] HA managed instance per region, PITR enabled, restore tested once
- [ ] Separate database roles per domain schema; ledger role isolated

### YT-0023 · Redis provisioned per region
`todo` · P0 · infra · 1d · dep: YT-0516

- Re-parented onto the local stack (YT-0516): this needed _a_ service, not a _managed_ one. The cloud task now covers deployment only.
- [ ] Managed instance per region, TLS, auth enabled

### YT-0024 · Cloud Run, Artifact Registry, deploy pipeline
`todo` · P0 · infra · 4d · dep: YT-0021

- **Superseded for now by YT-0532** (artifact build + verify + health-check + rollback on Helios). The acceptance criteria below are unchanged in substance — only the runtime differs.
- [ ] Container build + deploy from CI to staging on merge, prod on tag
- [ ] Rollback is one command and is tested

### YT-0025 · Cloudflare: domains, CDN, R2, Stream, Turnstile
`todo` · P0 · infra · 3d · dep: —

- **Deferred.** Turnstile is simulated by YT-0538, object storage is MinIO locally, and video was already re-parented onto self-hosted HLS (YT-0220). What genuinely remains is **a domain and DNS**, which is now the only piece of this task on anyone’s path.
- [ ] Domains and DNS under Cloudflare; WAF baseline on
- [ ] R2 buckets per region-role; Stream account with signed uploads
- [ ] Turnstile site keys issued per environment

### YT-0026 · Secret Manager and KMS keyrings
`todo` · P0 · infra · 2d · dep: YT-0020

- **Deferred behind YT-0533**, which keeps the *key separation* — voucher codes, PII, signing — while custody moves to the host. The separation is the part that must not be lost; the KMS is an implementation of it.
- [ ] Keyring per region; separate keys for voucher codes, PII, signing
- [ ] No secret in any env file in the repo; secret scanning in CI

### YT-0027 · Observability: OpenTelemetry, Grafana Cloud, Sentry
`todo` · P0 · infra · 4d · dep: YT-0516

- Re-parented onto the local stack (YT-0516): this needed _a_ service, not a _managed_ one. The cloud task now covers deployment only.
- [ ] Traces, metrics and logs from the first service, tagged by region
- [ ] Four golden signals dashboard; on-call alert routes defined

### YT-0028 · CI pipeline with all gates
`todo` · P0 · infra · 4d · dep: YT-0030

- [ ] Gates: lint, types, unit, integration, file-length, bundle size, Lighthouse CWV, migration safety, secret scan, SBOM
- [ ] `node scripts/tasks.mjs --check` runs and fails on a stale dashboard
