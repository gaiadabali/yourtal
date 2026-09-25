# Audit: infra-process (CI, gates, deploy, old board, process cost)

Audited 2026-09-25 against working tree `tasks-audit-2026-09-21` @ `b225116` (5 commits ahead of `origin/main` @ `bd05da7`, unpushed). Read-only. Evidence is from commands run today, not from the board.

## 0. Headline

- **The project is 4 days old and 247 commits deep** (first commit 2026-09-19 12:04, last 2026-09-22 14:11; 6/105/91/45 commits per day). No commits for 3 days.
- **56% of all commits (139/247) touch no code path at all** (`apps|services|packages|policies|infra`). In the last 120 commits: 63 are pure meta. They added **665 KB of docs/board prose against 670 KB of product source**, and 40% of those product-source bytes are comments.
- **Production is a static-ish mock.** `https://yourtal.gaiada.com/` serves `<html lang="id-ID">` with Indonesian fixture campaigns. `/api/health` → 404, `/en` → 404. `/business`, `/merchant`, `/wallet` → 200 with no login. Only `apps/web` is deployed. No API, ledger, voucher or Cerbos runs on Helios.
- **Every web data seam is mock-only**: 14 modules call `resolveDataSource`, and all 13 `live` implementations `Promise.reject("... not implemented yet (Phase U is mock-only)")`, e.g. `apps/web/features/campaign/campaign-data.ts:53-62`. The web app contains no `fetch(` to the API and reads no API env var.
- **CI on main is red**: Integration failed at `d806bd3` (last run), Format failed at `bd05da7` (last run), and perf-budget has never run. Local `pnpm verify` fails at step 1 (`check:eol`, 4 CRLF files).
- **The repo is PUBLIC** (`gh repo view` → `gaiadabali/yourtal`, `isPrivate:false`). It went public in `9f18816` to get Actions minutes. The memory note calling it a "private repo" is out of date.

## A. Infra and quality

### A1. CI workflows (`.github/workflows/`), 279 runs since 2026-09-20

| Workflow               | Trigger                            | Record (all runs)              | Latest             | Verdict                                                                                                                                                            |
| ---------------------- | ---------------------------------- | ------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `quality.yml`          | PR + push main                     | 40 ok / 24 fail / 21 cancelled | ok @ bd05da7       | Partial. Runs lint + typecheck + board. **No tests, by design** (`quality.yml:64-78`)                                                                              |
| `integration.yml`      | path-filtered, `paths-ignore` docs | 17 ok / 34 fail / 17 cancelled | **fail @ d806bd3** | Broken. `packages/db/src/seed.test.ts:55,121,419` fail in the full turbo sweep (`integration.yml:332-335`). The seed is not idempotent after other suites have run |
| `format.yml`           | PR + push main                     | 49 ok / 33 fail / 3 cancelled  | **fail @ bd05da7** | Broken. `packages/db/src/question-leak-sweep.test.ts` and `question-response-constraints.test.ts` are unformatted                                                  |
| `go.yml`               | services/**                        | 8/8 ok                         | ok 09-22           | Works                                                                                                                                                              |
| `contracts.yml`        | packages/contracts/**              | 11 ok / 4 fail                 | ok 09-22           | Works                                                                                                                                                              |
| `authz.yml`            | policies/**                        | 6 ok / 1 fail                  | ok 09-22           | Works                                                                                                                                                              |
| `perf-budget.yml`      | **pull_request only** (`:16-28`)   | **0 runs ever**                | —                  | Stub. `gh pr list --state all` returns nothing: every commit was pushed straight to main                                                                           |
| `release.yml`          | push `production`                  | 4/4 ok                         | ok 09-21           | Partial. Ships a web-only tarball. Its gate (`:62-68`) runs **no tests**                                                                                           |
| CodeQL (default setup) | dynamic                            | 5/5 ok                         | ok                 | Works (29–45 min per run)                                                                                                                                          |

Cross-cutting CI problems:

- `cancel-in-progress: true` on main in `quality.yml:19`, `format.yml:34` and `integration.yml:57` cancels runs when pushes land close together. That produced 41 cancelled Quality and Integration runs, and several commits have no CI result at all (YT-0611).
- Actions are pinned to Node-20 majors (`actions/checkout@v4.2.2`, `setup-node@v4.1.0`, `pnpm/action-setup@v4.0.0`, `setup-go@v5.2.0`). Every run logs a deprecation warning.
- Main has no branch protection (`gh api .../branches/main/protection` → 404). The `gh` CLI account has READ access only.

### A2. `pnpm verify` (`package.json:14`)

`check:eol && format:check && turbo typecheck && turbo lint && turbo test && policy:test && tasks:check`.

- Local run today: `check:eol` **exits 1**. `use-watch-session.ts`, `packages/db/src/database-urls.ts`, `docs/tasks/phase-0-web.md` and `docs/tasks/phase-1-campaign.md` have CRLF endings in the working tree (Windows drift, YT-0590). `prettier --check .` flags 12 files: 6 are `.claude/agents/kfc/*` edits someone left uncommitted, the rest are source files.
- `turbo test` needs Postgres, Cerbos, Valkey and MinIO up (several suites refuse to skip), so verify cannot run on a bare machine. `packages/db/scripts/with-test-db.mjs` gives db, api and idempotency their own databases (YT-0547). The Go services still share the real `yourtal` DB and need `-p 1` (`services/ledger/package.json`).
- `tasks:check` is the last clause.

### A3. Test inventory (tracked files; cases counted by `it(`/`test(`/`func Test`)

| Package                                      | src files            | test files | cases                                                                        |
| -------------------------------------------- | -------------------- | ---------- | ---------------------------------------------------------------------------- |
| apps/web                                     | 412                  | 201        | ~968                                                                         |
| apps/api                                     | 160                  | 42         | ~218                                                                         |
| packages/contracts                           | 149                  | 35         | ~358                                                                         |
| packages/db                                  | 5                    | 10         | ~99                                                                          |
| packages/drivers                             | 19                   | 9          | ~81                                                                          |
| packages/consent                             | 9                    | 5          | ~51                                                                          |
| packages/jurisdiction                        | 8                    | 5          | ~38                                                                          |
| packages/ui                                  | 13                   | 9          | ~36                                                                          |
| packages/idempotency / media / authz / queue | 9/28/6/8             | 3/4/2/3    | 31/31/20/11                                                                  |
| services/ledger (Go)                         | 19                   | 12         | 77 funcs, **110 PASS / 0 SKIP** today, run against the local Docker Postgres |
| services/voucher (Go)                        | 28                   | 17         | 86 funcs (not run)                                                           |
| policies (Cerbos)                            | 17 resource policies | tests/     | 71 `expected:` blocks                                                        |

About 2.4 MB of hand-written source, not counting fixtures or generated code. Tests exist in quantity. The weakness is integration: the tested libraries have no callers (B3).

### A4. docker-compose.yml (local stack)

Nine entries, all bound to `127.0.0.1`: postgres:17 (26432), cerbos 0.55 (26592), valkey 8 (26379), **zitadel v2.66 (26080, line 90)**, minio (26900/1), ledger (26910, built locally), voucher-keygen (one-shot, writes a key to a named volume), voucher (26911). All of them are running on the dev box right now (`docker ps`). Zitadel and `OIDC_ISSUER_URL` (`.env.example:68-69`) are left over from before the switch to email + password auth.

### A5. Deployment to Helios

- `.gaiadeploy.yml`: a production target only, `server: helios`, `type: node`, `port: 26300`, `pm2_name: yourtal-web`. Deploys are pull-based: `release.yml` publishes a `deploy/production-*` GitHub release and `gaiada-poll` on the box installs it (decision S-1).
- **Only `apps/web` is packaged** (`release.yml:70-88`, Next standalone). `apps/api` has no build step: `start` runs TypeScript through `@swc-node/register` (`apps/api/package.json:8`). Only ledger and voucher have Dockerfiles, and nothing deploys them.
- Live: Next behind nginx, plus a Postgres container on 26432 that nothing uses (`infra/PORTS.md:60-63`).
- `origin/production` @ `7f53741` (2026-09-21) is **85 commits behind main**. Latest release: `deploy/production-20260921-141343-7f53741`.
- **Rollback is broken in the shared `gaiada-deploy`.** On rollback it loses `PM2_NAME`, swaps the symlink, and then cannot restart the process (`docs/tasks/phase-0-helios.md:104,115-118`). Founder decision S-4 makes this a **blocker on the next deploy**.
- The next release would also fail its own gate: `release.yml:65` runs `format:check`, which is red on main.
- Production headers include `X-Frame-Options`, `nosniff` and `Referrer-Policy`, but **no HSTS and no CSP**.

### A6. Secrets, backups

- `.env` is gitignored (`.gitignore:8`, `git check-ignore` confirms). `.env.example` holds only local placeholder values. CI uses inline dummy credentials (`integration.yml:88-102`). The voucher key is generated into a Docker volume (`docker-compose.yml:205-219`).
- **Nothing scans for secrets or infrastructure identifiers**, and the repo is public (`9f18816` says so itself). My scan of IPv4 literals on `origin/production` and `main` found no public addresses. The cross-session register's A4 claim that production still carries identifiers is therefore unconfirmed for IPs; I did not check hostnames.
- YT-0533 (secrets without a KMS) is `todo`, 0/4. The register notes that Infisical is already running on the box.
- **Backups: none.** YT-0531 is `todo`, 0/3. That is harmless today because the Helios database holds nothing. It becomes P0 the day the API goes live.

### A7. Fragile or blocking, ranked

1. Integration red on main (seed idempotency).
2. Format red on main, which also blocks Release.
3. Local verify red at `check:eol` on Windows. CRLF drift keeps coming back.
4. perf-budget cannot run under direct-to-main commits.
5. The rollback defect blocks any deploy.
6. `cancel-in-progress` on main hides results.
7. The pre-commit hook (`.githooks/pre-commit:37-52`) **refuses any commit touching `docs/tasks/`** while an untracked file sits there. `docs/tasks/_cross-session-register.md` is untracked right now.
8. Five or more sessions share one working tree and one git index. That is the root cause of most entries in `docs/13d` §13, §21a, §25, §26a and §28 (seven "rungs" of index-repair failures).

## B. Process and the old board

### B1. Where `tasks:check` runs. All of these must be removed to retire the generated `TASKS.md`

- `.github/workflows/quality.yml:48-49`: step "Task dashboard is current", `run: node scripts/tasks.mjs --check`
- `.github/workflows/release.yml:68`: `node scripts/tasks.mjs --check` inside the release gate
- `package.json:14`: `... && pnpm tasks:check` at the end of `verify`; also `package.json:18-19` (`tasks`, `tasks:check`)
- `.githooks/pre-commit` (the whole file; `core.hooksPath` is set to `.githooks`): regenerates and `git add`s TASKS.md (`:54-55`)
- Supporting files: `scripts/tasks.mjs` (507 lines; `:88` skips `_`-prefixed files; `:478-500` marker check), `.prettierignore:14-18`, `.gitattributes:62` (`linguist-generated`), `README.md:46` (also claims "208 tasks" and "under 300 lines, enforced in CI", both false)
- `integration.yml:52` and `release.yml:28` list `TASKS.md` under `paths-ignore`. That can stay.

### B2. Board size and state (parsed today)

- 306 blocks, 305 not cut (`node scripts/tasks.mjs --check` → "306 tasks valid, dashboard current"). Not the 208 the README says.
- Status counts: 83 done · 2 review · 55 doing · 157 todo · 6 blocked · 1 cut. About **1,083 ideal engineer-days** of estimates remain.
- Board text is 840 KB (`docs/tasks/*.md` + TASKS.md). `phase-0-platform.md` alone is 236 KB. Lessons (13c + 13d) are another 118 KB. `_schema.md` is 232 lines, defines 9 emoji bullet forms, a recorder role, and rules numbered past 11.
- Much of the process is about the process: of roughly 110 tickets numbered YT-0500 and up, about 26 concern gates, tests, line endings, the lockfile or the board itself (e.g. 0505, 0511, 0547, 0555, 0558, 0565, 0567, 0568, 0569, 0577, 0579, 0587, 0590, 0592, 0604–0607, 0611).
- Many tickets can never reach `review` because notes are written as criteria (`- [ ] ⚠️ ...`). Examples: YT-0044 (both of its "open" items are warnings about YT-0567), YT-0552 and YT-0532. Their AC ratios read low for that reason.

### B3. Spot-check of 14 `done` tickets against code

| Ticket                                       | Claim                              | Evidence                                                                                                                              | Reality                                                                                                                                                     |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YT-0042 ledger transfer                      | balanced, idempotent, serialisable | Go tests pass (110/0 skip). `services/ledger/internal/api/routes.go:62-63`: "every route below is a 501 ... None of the four is live" | Library works, **no HTTP** (YT-0593)                                                                                                                        |
| YT-0046 partner pre-purchase                 | drawdown                           | `internal/reward/purchase.go` + test                                                                                                  | Library only, unreachable                                                                                                                                   |
| YT-0140 voucher issuance                     | code custody                       | `services/voucher/cmd/voucher/main.go:89` builds `minter`, which is only logged (`:143`)                                              | **Unrouted** (YT-0594)                                                                                                                                      |
| YT-0120/0121 watch session, tokens           | API                                | `apps/api/src/modules/watch/watch.controller.ts:68,103,125,171`; `checkpoint.controller.ts:57`                                        | Routes exist                                                                                                                                                |
| YT-0122 checkpoint delivery + answer capture | done                               | `watch.controller.ts:180-186` hard-codes `questionsAnswered: false` "the question bank is not built"; no question/answer route exists | **Earn loop cannot complete**                                                                                                                               |
| YT-0540 email+password auth                  | done                               | `auth.controller.ts:52` has register/login/reset/verify                                                                               | API only. **No login or register page** in `apps/web/app`; onboarding is a phone-OTP UI (`features/onboarding/code-entry-step.tsx`) saving to local storage |
| YT-0036 consent service                      | done                               | `packages/consent` has 51 cases; `apps/api` has **0 references**                                                                      | Library only                                                                                                                                                |
| YT-0040 job queue                            | done                               | `@yourtal/queue`: **0 consumers** in the workspace                                                                                    | Library only                                                                                                                                                |
| YT-0535/0536/0537 drivers + simulators       | done                               | `@yourtal/drivers`: **0 consumers**                                                                                                   | Library only                                                                                                                                                |
| YT-0405 region + locale                      | done                               | `apps/web/features/region/get-region.ts:11` `DEFAULT_REGION = "ID"`; production root is `lang="id-ID"`                                | Foundation real, **default wrong**                                                                                                                          |
| YT-0410/0420/0423 earn board, store, wallet  | done                               | `campaign-data.ts:53-62`, `store-data.ts`, `wallet-data.ts` `live` → reject                                                           | Fixture-only                                                                                                                                                |
| YT-0556 health endpoint                      | done                               | `apps/api/src/shared/health/health.controller.ts`                                                                                     | Exists, not deployed (prod 404)                                                                                                                             |
| YT-0180/0181 public pages, hreflang          | done/review                        | prod `/id` 200 `id-ID`, `/au` 200 `en-AU`                                                                                             | Works, on mock data                                                                                                                                         |
| YT-0511 format gate                          | done                               | `format.yml` exists                                                                                                                   | Gate exists and is **red on main**                                                                                                                          |
| YT-0404 perf harness                         | done                               | `perf-budget.yml`                                                                                                                     | **Never executed**                                                                                                                                          |

Pattern: "done" means a library passed its own tests. Almost nothing is wired end to end. The board knows this in fragments: YT-0600 "Nothing wires apps/web to apps/api", YT-0593, YT-0594, YT-0610 "Reward Engine grants a global constant", and YT-0519's criterion flagged "FALSE, was ticked".

### B4. Per old phase/epic: what is genuinely done

- **web / Phase U** (`phase-u-ui.md` 19/21 done, `phase-u-ui-business.md` 6/10): 31 `page.tsx` screens covering consumer, business console, merchant and public pages. **All fixture-backed.** The founder calls the look "AI slop", so the visual layer is a redo. Worth keeping: the `resolveDataSource` seam (`packages/contracts/src/mock-source.ts`), `formatMoney(amountMinor, currency)`, the region config, the player's coverage gating (YT-0551), the HLS fixture (YT-0526) and the contract mock fixtures.
- **platform** (27/64): real and gated. Zod contracts with OpenAPI and Go codegen (`contracts.yml` green). Cerbos policies with a TS/YAML drift test. An idempotency interceptor that the API actually uses (`apps/api/src/shared/idempotency/`). The API has business, team, KYB, billing, store-listing, campaign-read, watch and auth modules, a health route, and runs on a non-superuser role (YT-0554). Queue, drivers and consent are real but have no callers.
- **value / economy** (7/29 + 2/8): the Go ledger is genuinely strong: transfer, chart of accounts, pricing, solvency, reward, Merkle proof and the invariant checker, 110 subtests green. It has zero HTTP surface. The reward is a global constant, not the partner's (YT-0610). Money has no currency tag (YT-0513 part 1 is committed locally, unpushed). Monetary policy numbers are deliberately blank, pending an economy owner (YT-0050).
- **watch / adplatform** (4/8, 1/17): session, progress coverage and checkpoint tokens work over HTTP. Completion always refuses. There is no route to deliver questions or submit answers, and no campaign-creation API (YT-0100 is 1/3).
- **store / merchant** (0/10, 2/17): voucher redemption authorize/capture/void/refund is routed behind merchant request signing plus idempotency (`services/voucher/cmd/voucher/main.go:114-117`), and is close to finished (YT-0150 2/3, YT-0151 3/4). Issuance is unrouted. The store-listings API exists in `apps/api`. The unified catalogue is 4/6.
- **infra / helios** (6/33): the local stack is done. The Helios web deploy works forward. Rollback, backups and secrets are not done. The GCP/Terraform/Cloud Run tickets YT-0020..0028 (all `todo`) are made obsolete by the Helios decision.
- **seo** (3/5): the public `/id` and `/au` surfaces serve with the correct `lang` attribute and hreflang, on mock data.
- **legal** (3/10): position registers and a risk acceptance exist as documents. Entity, PSE and tax work is not started.
- **pilot, risk, data, media, commerce, Phase 2–3**: effectively zero. 0 done across 67 tickets.

### B5. In-flight tickets worth carrying into the new plan

Carry: **YT-0513** Money with a currency tag (part 1 local; blocks AUD). **YT-0610 + YT-0045** partner-set reward. **YT-0600/YT-0552** wire web to API and API to Postgres. **YT-0593** ledger routes. **YT-0594** voucher issuance route. **YT-0150/0151** redemption API (one criterion each left). **YT-0130** catalogue. **YT-0519** seed the real DB. **YT-0603** remove the `id-ID` default. **YT-0532** rollback fix, **YT-0531** backups, **YT-0533** secrets. **YT-0547/YT-0567** test isolation; there is uncommitted YT-0547 work in `apps/api/.../business-db.test-helper.ts` belonging to another session.
Drop or supersede: YT-0525 (React Hook Form migration; the redesign replaces it), YT-0501 RUM, YT-0212 OG cards, YT-0506 (superseded by T-1 and YT-0608, whole Rupiah), YT-0430 phone OTP (contradicts email + password), YT-0020..0028 GCP, YT-0578 (history rewrite already done), YT-0450/0451 (pilot sessions, after the redesign).

### B6. Process rules: what slowed things down, and what to keep

What slowed things down:

- Five or more concurrent sessions in **one working tree and one index**. `docs/13d` §13, §21a, §25, §26a and §28 exist because of it, as do commits like `6c903b9` ("Restore YT-0122's question-response work, which my last commit deleted").
- The **generated TASKS.md with a recorder role and a `--check` gate**. It made every status change a commit that had to be sequenced across sessions.
- The **`review` → `done` independent-verifier rule**. It spawned eight "verification batch" commits (`c16cece`, `6497afa`, `f5ffbc4`, `1e537fc`, `b2e97ec`, `b3c50a2`, and others) that verified libraries nobody calls.
- **Essay-length tickets, commit messages and code comments** (40% of added source bytes), plus a lessons doc for every incident.
- The **9-form emoji bullet taxonomy** and note-as-criterion bullets.

Keep, cheaply:

1. One `pnpm verify`, slimmed to eol, format, typecheck, lint and unit tests, with DB suites in CI.
2. The **no-SKIP guard** in Integration (`integration.yml:268-274, 289-296, 342-348`).
3. Go `-count=1 -p 1` for DB suites.
4. **Commit by explicit path in one step.** Better still, **one git worktree per session**, which removes the shared index entirely.
5. Loopback-only ports and the one-file port registry (`infra/PORTS.md`).
6. Pull-based deploy from checksummed releases.
7. "Break it to prove it", but only for money invariants.
8. The 300-line rule, **currently unenforced**: `eslint.config.mjs` has no `max-lines`, there is no golangci config, and 18 files are over 300 (e.g. `packages/contracts/src/openapi/route-registry.ts` at 956, `packages/db/src/seed.ts` at 572). Either enforce it (warn 300 / error 400, excluding tests and generated code) or drop the claim.

The Kingdom-of-Indonesia model the founder cites is `../kingdom-of-indonesia/docs/PLAN.md` (229 lines, 10 phases, each a paragraph plus a **"Done when:"** line) and `docs/PARALLEL-TRACKS.md` (a file-ownership table per track, and the rule "stage and commit in one uninterrupted step, with explicit paths"). It has no checkboxes; the founder now wants checkbox tasks and subtasks as well.
