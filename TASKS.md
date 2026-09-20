# YourTal — Task Tracker

**This is the single source of truth for project status.**

The dashboard below is **generated** from `docs/tasks/*.md`. Do not edit it by hand — your edits will be overwritten, and CI will fail if the two disagree.

```bash
node scripts/tasks.mjs           # validate + regenerate the dashboard
node scripts/tasks.mjs --check   # validate + fail if stale   (CI gate)
```

To change status: edit the task in `docs/tasks/`, run the script, commit both files together.
Format and rules: [`docs/tasks/_schema.md`](docs/tasks/_schema.md).

|                                                                       |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Stage** | **Building on our own metal.** The deployment target is **Helios**, all third-party connections are **held**, and auth is ordinary email + password. See [`docs/tasks/phase-0-helios.md`](docs/tasks/phase-0-helios.md). |
| 📊 **Why `done` still reads 0 — and why that is now honest** | The board had **84 tasks in `review` and none in `done`**, and **43 of the 84 had unticked criteria** (five at 0 of n) under a column headed _"work complete"_. `review` had no validator rule, so it became where tasks went to stop being counted. The rule now exists (`_schema.md` § the status lifecycle): **`review` requires every criterion ticked, same bar as `done` minus the verifier.** The 43 moved to `doing`, which is what they were. The remaining **41 are genuinely finished work awaiting a second pair of eyes** — that sweep is the next job, and it is deliberately not a rubber stamp. |
| 🎯 **The clearest next move: 13 orphans that are nearly finished** | **50 of the 55 tasks at `doing` have no owner** — `yourtal-22`'s three agents hold five (YT-0150/0151/0152, the Go half of YT-0039, and work adjacent to YT-0517); sessions e3, 5a and af ended holding the rest. Unowned by epic: **web 17 · platform 14 · value 7 · seo 3**, then singles. **Thirteen of the orphans are ≥70% done**, most needing one or two criteria rather than new work: **YT-0036** consent 7/8 · **YT-0043** chart of accounts 6/7 · **YT-0513** currency-tagged Money 5/6 · **YT-0120** watch session 9/11 · **YT-0044** invariant checker 8/10 · **YT-0045** Reward Engine 8/10 · **YT-0405** region + locale 4/5 · **YT-0412** long-form player 4/5 · **YT-0101** campaign lifecycle 7/9 · **YT-0010** legal register 3/4 · **YT-0424** voucher detail 3/4 · **YT-0506** sen 13/18. **Finishing these is cheaper than starting anything**, and it is what turns `doing` into `review` into a real percentage. |
| 💰 **The gate did not cover the money** | `pnpm verify` ran **282 TypeScript test files and zero Go ones**. `services/*` was in the pnpm workspace but neither Go service had a `package.json`, so turbo never saw them — the ledger, the invariant checker, the daily Merkle proof and every voucher tamper and adversarial test sat outside it. **Now inside**, together with line endings, formatting, lint (which was red), the 384 Cerbos policy tests and the board staleness check. The first honest run found a live failure: **YT-0567**. |
| 🚦 **CI exists, and is green** | The repo had **no remote**, so six workflows had **never executed once**; each also watched `branches: [main]` while the branch was `master`, so they would have stayed silent anyway — and silence looks exactly like success. Remote added 2026-09-20 (`gaiadabali/yourtal`, private), branch renamed. **Every workflow failed on first execution, and not one failure was a CI quirk** — nine distinct defects, each true in the repo for as long as its file existed. **All green on `2d48866`**: Integration (Postgres + Cerbos + MinIO, `Found 16 executable policies`, `apps/api` 26 files against a live PDP, all 14 packages, zero skips), Quality, Format, Contracts, Authorization policies, and **Go modules — its first run in this repository's history**. Written up in [`docs/13d-lessons.md`](docs/13d-lessons.md). **Risk 37's mitigation was one of the unrun workflows**; it is qualified in the register rather than rewritten. |
| ⚖️ **Two CI decisions waiting on you** | **1. `perf-budget.yml` is `pull_request`-only.** Work goes straight to `main` without PRs, so the performance budget — **LCP ≤ 2.0s, initial JS ≤ 200KB, TBT ≤ 200ms** — **cannot run at all** as this project actually commits. Adding a `push` trigger means Lighthouse on every commit; the alternative is adopting PRs. It is dispatchable on demand meanwhile. **2. Every no-skip guard in `integration.yml` has only ever been seen passing** — five of them. Per the house rule a guard first seen green has not been shown to work, so one deliberate `it.skip` should be pushed to watch it go red. Both are recorded in **YT-0569**. |
| 🧪 **YT-0527 is why `done` needs a second pair of eyes** | It sat at `review` with **4/4 criteria ticked**, and its Cerbos integration had never once been capable of running. Every box was defensible from reading the workflow file and false in the runner — including one ticked on reasoning (`watchForChanges` covers the ordering) that was wrong because **the setting lived in the config file that failed to mount for the same reason**. Back to `doing`. This is the argument for not rubber-stamping the other 41. |
| 🌐 **Australia’s public surface returns 404** | Measured against the running dev server: `PUBLIC_LOCALES` is `["id", "au"]`, `GENERATED_PUBLIC_LOCALES` is `["id"]`, and every public route sets `dynamicParams = false`. So `/id` serves and **`/au` does not exist**. YT-0405 reads as done from inside the code because the type admits a locale the router refuses. **AU is the primary market**; this is the widest gap between plan and build. |
| 🗺️ **Coverage map — recorded, deliberately not started** | YT-0543..0546. Founder decision: it waits until the current plan is done and running. Three things captured now because they are cheap early and expensive late: **Australia Post licenses postcode data, the ABS does not**; **postcodes are delivery routes, not polygons** (SA2 is the right unit); and the **cohort floor must live in the aggregation, not the renderer** — a density map at low coverage re-identifies people. |
| 🔄 **Australia-primary — reported confirmed, roadmap not yet re-cut** | Relayed via another session: **Australia is the primary market, Indonesia the proving ground**, and the reward is _a reward, not a wage replacement_, at **less than AUD 5 per twenty minutes** depending on partner funding. Engineering consequences are already in flight (YT-0405 region support, region selection at registration) because they are right either way. **The roadmap, economics and legal sequencing have not been re-cut** — `docs/04` still has Indonesia as Phase 1 and Australia as Phase 3. That is ~2 days of work and I want it confirmed in this session first. See _What AU-primary would change_. |
| 👤 **YT-0050 is blocking real work now** | **Nobody owns the economy.** Two things wait on that person, not on engineering: **YT-0043's finance review cannot be ticked** (a ledger classification signed off by nobody is how a restatement starts), and **YT-0045's point values are placeholders** — the Reward Engine works, but nobody has said what an action is worth. Naming this person costs nothing and unblocks both. |
| ✅ **YT-0506 — decided: IDR is stored in sen** | **Founder decision 2026-09-20.** Sen is uncommon in daily use but **banking uses it** (`Rp 1.000,26`), which matches ISO 4217 and the original intent of `docs/12`/`docs/18`. **This settles the currency, not the processor** — what Xendit accepts is still unconfirmed, and that conversion belongs in the **PSP adapter**, exactly as YT-0537 already assumes. The migration is a **100× change to every stored and fixture IDR value** and runs as one unit of work behind the drift test. |
| 🌐 **All that is left of the cloud accounts is a domain** | **YT-0020** (GCP) and **YT-0025** (Cloudflare) are **deferred** — Helios replaces them and they now gate nothing. The one real remnant is **a domain and DNS**; a subdomain on a domain you already own carries us until then. |
| ✅ **Nothing is blocked on an account signup any more**               | The full stack runs locally: **Postgres · Cerbos · Valkey · Zitadel (real OIDC) · MinIO (S3)**. Eight tasks were re-parented off the cloud chain onto YT-0516 — they needed _a_ service, not a _managed_ one. Cloud tasks now cover **deployment only**. `pnpm dev:up`.                                                                                                                                                                                                                                                                                                                                                         |
| 🖥️ **Helios is connected, surveyed, and it is in Jakarta** | Reached **directly** 2026-09-20 from the office IP — ufw rule 5 allowlists `<office-ip>`, so no jump host was needed. `server-c`, Ubuntu 24.04.5, **8 cores / 31 GB (22 free) / 166 GB disk free**. **Residency evidence points to Jakarta, Indonesia**: `ipinfo` → Jakarta + AS47583, host `<helios-vps-hostname>`, **14.4 ms to Bandung, 169.7 ms to Sydney**. If confirmed, Indonesian data is onshore and **Australian data becomes an APP 8 cross-border disclosure — on the primary market's main path**. One Hostinger billing-page check closes **YT-0534**, the oldest blocker on this board. |
| ✅ **Working from home is solved — `ssh helios-w`** | **`<jump-host>` is decommissioned**, and it was the only non-Hostinger jump, so Helios, Delphi, `jump-e`, `jump-b` and `new-pantheon` are all AS47583 — a Hostinger-wide block removes the destination and every usual path at once. **But the fleet already ran a WireGuard mesh for Alloy whose hub is _not_ Hostinger**: `sumopod`, Tencent Cloud Singapore. Helios (`10.88.0.3`) and Delphi (`10.88.0.4`) **dial out** to it on a 25s keepalive, and outbound is never edge-filtered. **`helios-w` = `ProxyJump sumopod` → `10.88.0.3`: no Hostinger address is contacted, and it does not need your IP allowlisted, because the source Helios sees is the hub's `10.88.0.2`.** Tested end to end. Required adding one firewall rule on Helios for the mesh subnet — the "WireGuard address on the allowlist" the org notes had recommended for months and nobody had actually put in place. **Order from home: `helios` → `helios-jb` → `helios-w`.** Runbook: `gaiada-setups/access/helios-home-access.md`. |
| ⚠️ **One gap left, and it disables the diagnostic** | **Delphi has no mesh firewall rule**, so `delphi-w` times out. That matters more than "a second box is unreachable": Delphi is how you tell _not-allowlisted_ from _edge-blocked_, since both present as an identical silent timeout. Delphi answering while Helios does not means the allowlist; neither answering means the edge. **Without the rule, Delphi is reachable only over Hostinger — so the diagnostic fails in exactly the situation it exists for.** It is the same one-line rule Helios received. **I was blocked from applying it** by this session's permission classifier, which reads a firewall change as weakening; it needs your approval or a one-line run. |
| 🧰 **Helios is provisioned and the caps are proved** | Unprivileged `yourtal` user (nologin, `0750`, `secrets/` at `0700`) and a systemd slice capping **2 of 8 cores, 4 GB hard / 3 GB soft, no swap, IOWeight 50** — sized against measured headroom and leaving the majority to the 30 client sites. **CPU cap proved by running a real runaway**: 8 busy loops throttled to **2.02 cores**, host load 1.82, clients unaffected. **The memory cap is only partly proved** — the soft limit visibly throttled at a 3.1 G peak, but `MemoryMax` was never reached, so the hard kill is still unproven and is recorded as such. |
| 🔑 **Two Helios findings that change the plan** | **1. Infisical is already self-hosted and running** (`/opt/infisical-core` v0.43.121, active). **YT-0533 was written as "secrets without a KMS" and that premise is wrong** — the question shrinks to whether to adopt the one that is there, which is shared with the client sites and the NOW platform, so it carries risk 39's blast-radius argument applied to credentials. **2. The box is more crowded than recorded**: nginx serves **30 live client hostnames**, plus NOW's 6 containers, sGTM, MariaDB, a host Postgres and CloudPanel. **No `26xxx` port is in use**, so YourTal's port scheme transfers unchanged, and `PORT=3001` avoids the `node` already on 3000. |
| ⚠️ **What genuinely cannot be simulated** | **1. Where Helios physically sits** (YT-0534) — a fact about a rented box, and it decides whether real Australian or Indonesian personal data may ever land on it. **2. Legal** — PSE registration, notaris, entity formation. **3. Real people** — simulated users cannot tell you whether anyone will watch twenty minutes. Everything else now has a simulator, and **every simulator can be driven into failure** (YT-0536). |
| ⚠️ **The value chain is proven in tests, and is not yet wired into the running system** | Partner buys points → allocation + reserve + `point_purchase` → user completes a campaign → risk gate, velocity caps, drawdown, ledger post, grant log in one transaction → hard-stop at zero. **YT-0044** proves it every 15 minutes with a write-once daily Merkle root, all against real Postgres. **But this row used to read "the value chain and its proof both run", and that was true of the Go test suites rather than of the product.** Relayed by `yourtal-22` and verified here: `services/ledger/cmd/ledger/main.go` registers exactly **`/healthz` and a 404** — the reward engine, pricing engine, chart of accounts and transfer API have **no HTTP caller at all** — and `apps/api` mentions "ledger" and "voucher" only in comments and Postgres role names, with **no `LEDGER_BASE_URL`, no client and no config anywhere**. The same week's lesson, one level up: a claim can be true of the tests and false of the system. `yourtal-22`'s agents are closing it now. |
| 🔐 **A merchant could have captured another merchant's hold** | Found by `yourtal-22` exposing `/v1/vouchers/{authorize,capture,void,refund}`, **verified here against `main`**: the authorization query is `WHERE id = $1 AND state = 'held' AND expires_at > now()` — **no merchant predicate**. Correct for the invariant the domain tests assert, and false the moment the id is client-supplied over HTTP. Proved by disabling the new check: **a stranger's signed capture succeeded and returned a receipt.** Fixed at the HTTP boundary with the same refusal a missing id gets, so it cannot be used to enumerate. **The query is still unscoped** — safe because one caller checks, which is a convention rather than a constraint. **YT-0571**, risk 50. Two smaller siblings of the same shape: **YT-0572** (a refusal message that reveals which check failed) and **YT-0573** (nothing ever marks a voucher `expired`, so the portal and reconciliation read a stale `state`). |
| 🚨 **A two-person-approval control is switched off by saying nothing** | `policies/resource_policies/listing.yaml:41` allows `set_settlement_value` when `!has(R.attr.isMaterialSettlementDecrease)` — **an `EFFECT_ALLOW` whose guard is satisfied by the attribute being absent**, so every settlement cut passes as non-material however large. Worse: the attribute **cannot** be supplied the normal way, because `attrsFrom` is synchronous and request-only while materiality compares against the *stored* `S`. **The correct calling pattern is the one that disables the control.** Its policy tests pass because they supply the attribute by hand, and nothing had ever reached it over HTTP. Found by `yourtal-22`'s agent 3, verified here. **YT-0574** (deny on absence), **YT-0575** (`approve_settlement_decrease` is a rule with no endpoint), risk 51. ⚠️ `policies/` belonged to `yourtal-e3`, **which has ended — this is unowned**. |
| ⛔ **Nobody has defined what makes a settlement cut "material"** | `docs/17` line 84 requires two-person approval for _"changing a settlement value downward by more than a threshold"_ and **names no number**; the resource schema repeats the phrase; the policy consumes the boolean. **Three references, zero definitions.** An agent used **20% as a loudly-commented placeholder** so the check would not be a no-op — correct behaviour, and it leaves a number one agent invented standing in front of a two-person control. It is not an engineering default: a decrease in `S` is a **direct cut to what a user's points are worth**, since `points_price = (S / B) × demand_multiplier`. **YT-0576**, and it needs the same person as **YT-0050**. |
| 🛑 **Do not run `pnpm dev:reset` or `docker compose down -v`** | `yourtal-22` is running three agents in git worktrees, each against **its own database in the shared cluster** — `yourtal_wt_voucher`, `yourtal_wt_ledger`, `yourtal_wt_store` — because `apps/api` suites clear tables in `beforeAll` and `fileParallelism` is off, so three concurrent agents against `yourtal` would have produced failures that looked like product bugs. **`down -v` destroys all three mid-run.** They are disposable once those agents finish and `yourtal-22` will say when. |
| **Next unblocked engineering** | **YT-0513** (currency-tagged Money) — the structural answer to YT-0506, making the unit a question the compiler asks rather than one a person remembers. Then **YT-0535/0536** (the simulator seam) and **YT-0540/0541** (auth, schema now decided). Phase U continues against mocks. |
| **Legal**                                                             | Proceeding **without advisory counsel** by founder decision. Positions recorded, sourced and risk-rated in [`docs/24-legal-positions.md`](docs/24-legal-positions.md). A **notaris and a local corporate services provider remain mandatory**.                                                                                                                                                                                                                                                                                                                                                                                  |
| **Read before committing spend**                                      | [`docs/23-critique.md`](docs/23-critique.md) and [`docs/21-failed-analogues.md`](docs/21-failed-analogues.md).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### What AU-primary would change

Recorded so the decision is made with the consequences visible. **Needs founder confirmation before anything moves.**

| Area                | If Indonesia-first (current plan)                                                                          | If Australia-primary                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The core risk**   | Reward-for-attention is attractive: a IDR 50,000 voucher for 20 min is **above** Indonesian minimum wage   | **AUD 5 for 20 minutes is far below Australian minimum wage and may read as insulting.** [`23`](docs/23-critique.md) §2.6 flagged this; it moves from a footnote to **the central thesis risk** |
| **Regulatory load** | Light first: PSE registration, skill-only games. AU deferred                                               | **Front-loaded and harder**: AFSL/gift-facility relief, Privacy Act reform mid-passage, state-by-state trade promotions, ACL consumer guarantees — all move from Phase 3 into Phase 0–1         |
| **Economics**       | [`01`](docs/01-strategy-and-economics.md) §2.5's CAC model is built on IDR and Indonesian merchant margins | **The whole model needs rebuilding** on AU merchant margins, AU CAC and AU wages. Prodege's ~$2.50/member/year — a US figure — becomes the directly relevant benchmark                          |
| **Cost and time**   | Cheaper market to iterate in                                                                               | AU compliance earlier means **more cost sooner**, and the AU entity becomes a Phase 0 dependency                                                                                                |
| **Phase U**         | Already Indonesia-only: Jakarta districts, IDR, `id-ID` formatting                                         | Region support now (**YT-0405**) is right either way — a prototype denominated in Rupiah tests the wrong market if AU is the target                                                             |

### Who is doing what

| Session        | Owns                                                                                    | Task files it may edit                    |
| -------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- |
| **yourtal-22** | **All three branches landed** (`ab7ea79` voucher redemption API · `c1dc5ce` ledger routes + both Go services in compose + `/readyz` · `8216ec7` store module + `14bd5a8`). **Now holds `policies/`** — YT-0574 and YT-0575, taken up after e3's ending left them unowned. Will hand it back or re-declare it unowned when that lands |                                           |
| **yourtal-14** | Planning, `docs/`, this tracker, `scripts/`, `.githooks/`, `.github/workflows/`           | everything under `docs/tasks/`            |
| _yourtal-e3_   | _Ended._ Left behind: campaign, watch, `apps/api` core, contracts codegen               | —                                         |
| _yourtal-5a_   | _Ended._ Left behind: `services/voucher`, pricing, `apps/api/modules/{store,merchant}`   | —                                         |
| _yourtal-af_   | _Ended._ Left behind: config, persistence, infrastructure                               | —                                         |

**TASKS.md is regenerated by yourtal-14 only.** Other sessions run `node scripts/tasks.mjs --check`, never the writing form.

**Ownership is stale the moment a session ends, and it ended three times today without the table noticing.** Checked 2026-09-20 against the live session list: **e3, 5a and af are gone**, and `yourtal-22` is running and was not in the table at all. Their unfinished work is now unowned — it is in the task graph, not in anyone's hands. `yourtal-14` owns `docs/`, `scripts/`, `.githooks/`, `.github/workflows/` and this tracker. **`apps/web`, `packages/contracts` and `packages/db` are shared surfaces: announce the paths, not just the ticket.** Naming tickets instead of paths caused three mid-write races in one day.

**`packages/contracts` is shared, not disjoint.** It was `yourtal-e3`'s for API shapes; **that session has ended, so it is currently unowned** while remaining the one surface where concurrent sessions actually collide. **Rule: anyone adding to it announces what they add rather than assuming.** The registry completeness gate has caught every addition so far, which is why the overlap has been safe rather than lucky.

**Announced 2026-09-20 by `yourtal-22` (agent 3, store module).** In its `src/listing/**` allowlist: **`listing.ts`** gains `perUserLimit`, optional with no default so every existing fixture still parses, and **`listing.test.ts`** covers its round-trip and rejection. **Outside that allowlist, flagged by the agent itself rather than slipped through**: `db-drift/schema-drift.test.ts` adds `lifecycle_state` to `store.listings`' `columnsWithNoField` exemption — the same public/internal split `campaignSchema.status` already makes; `openapi/route-drift.test.ts` adds 11 routes to `KNOWN_OUT_OF_SCOPE`, the convention campaign and watch already use; and `openapi/yourtal.openapi.json` plus `openapi/go/model_listing.go` are **mechanically regenerated** — both gates were red until it ran them. `yourtal-22` reviewed these as additive exemptions and generated output with no schema decisions. **Recorded because the boundary moved**: a module cannot keep the drift gates honest for its own tables without touching the files those gates live in, which is worth knowing before the next allowlist is drawn.

**Open, small, and nobody's yet:** there is **no `listing_view` Cerbos kind**, so public store browse uses `@PublicRoute` rather than the `campaign` / `campaign_view` split. If browse should ever require even a bare signed-in check, that is a `policies/` decision — and `policies/` is unowned.

<!-- AUTO:DASHBOARD -->

_Generated by `scripts/tasks.mjs` — do not edit by hand._

**0 / 273 tasks done (0%)** · 41 in review · 57 in progress · 6 blocked

### By phase

| Phase | Done | Review | Doing | Settled |
|---|---|---|---|---|
| Phase U · UI first  ◀ NEXT | 0/34 | 21 | 10 | `▓▓▓▓▓▓░░░░` 62% |
| Phase −1 · Pilot | 0/13 | 0 | 0 | `░░░░░░░░░░` 0% |
| Phase 0 · Foundations | 0/107 | 19 | 31 | `▓▓░░░░░░░░` 18% |
| Phase 1 · Indonesia MVP | 0/91 | 1 | 16 | `░░░░░░░░░░` 1% |
| Phase 2 · Depth | 0/22 | 0 | 0 | `░░░░░░░░░░` 0% |
| Phase 3 · Marketplace & AU | 0/6 | 0 | 0 | `░░░░░░░░░░` 0% |

### By epic

| Epic | Done | Review | Doing | Ready | Left | Settled |
|---|---|---|---|---|---|---|
| `adplatform` | 0/17 | 0 | 2 | **4** | 98d | `░░░░░░░░░░` 0% |
| `commerce` | 0/1 | 0 | 0 | — | 20d | `░░░░░░░░░░` 0% |
| `data` | 0/9 | 1 | 0 | **3** | 45d | `▓░░░░░░░░░` 11% |
| `economy` | 0/8 | 0 | 1 | **3** | 31d | `░░░░░░░░░░` 0% |
| `infra` | 0/27 | 5 | 3 | **10** | 82d | `▓▓░░░░░░░░` 19% |
| `legal` | 0/9 | 0 | 1 | **4** | 36d | `░░░░░░░░░░` 0% |
| `media` | 0/13 | 1 | 1 | **1** | 67d | `▓░░░░░░░░░` 8% |
| `merchant` | 0/16 | 2 | 5 | **6** | 64d | `▓░░░░░░░░░` 13% |
| `pilot` | 0/11 | 0 | 0 | **1** | 29d | `░░░░░░░░░░` 0% |
| `platform` | 0/46 | 8 | 15 | **15** | 116d | `▓▓░░░░░░░░` 17% |
| `risk` | 0/14 | 0 | 0 | **4** | 67d | `░░░░░░░░░░` 0% |
| `seo` | 0/5 | 0 | 3 | **1** | 17d | `░░░░░░░░░░` 0% |
| `store` | 0/10 | 0 | 1 | **4** | 92d | `░░░░░░░░░░` 0% |
| `value` | 0/24 | 5 | 7 | **6** | 92d | `▓▓░░░░░░░░` 21% |
| `watch` | 0/7 | 0 | 1 | **1** | 32d | `░░░░░░░░░░` 0% |
| `web` | 0/56 | 19 | 17 | **3** | 139d | `▓▓▓░░░░░░░` 34% |

### In review (work complete, gate not yet passed)

- **YT-0527** `infra` Cerbos in the integration workflow — 7/7 AC ticked
- **YT-0516** `infra` Local development stack — **no cloud account needed** — 6/6 AC ticked
- **YT-0517** `infra` Declare `services/*` and scaffold the Go module — 4/4 AC ticked
- **YT-0518** `value` First migration, executed — 5/5 AC ticked
- **YT-0519** `data` Seed the real database from the mock generators — 7/7 AC ticked
- **YT-0520** `platform` Local identity provider — 4/4 AC ticked
- **YT-0521** `media` Local object storage and media origin — 8/8 AC ticked
- **YT-0535** `platform` One driver interface per external boundary — 6/6 AC ticked
- **YT-0536** `platform` Simulators that can fail — 7/7 AC ticked
- **YT-0537** `platform` Payment and disbursement simulator — 10/10 AC ticked
- **YT-0031** `platform` Contracts package and codegen — 4/4 AC ticked
- **YT-0035** `platform` Cerbos policies and decision point — 3/3 AC ticked
- **YT-0500** `platform` PDP enforcement across API routes — 8/8 AC ticked
- **YT-0515** `platform` Durable shared idempotency store — 4/4 AC ticked
- **YT-0551** `web` Gate the completion hand-off on coverage, not on the `ended` event — 4/4 AC ticked
- **YT-0557** `infra` Load the root `.env` properly — 3/3 AC ticked
- **YT-0568** `infra` Line endings were never renormalised after `.gitattributes` landed — 4/4 AC ticked
- **YT-0041** `value` Ledger schema and constraints — 5/5 AC ticked
- **YT-0042** `value` Ledger transfer API — 6/6 AC ticked
- **YT-0046** `value` Partner funding: point pre-purchase and drawdown — 9/9 AC ticked
- **YT-0140** `value` Voucher issuance and code custody — 4/4 AC ticked
- **YT-0441** `web` Campaign builder — 3/3 AC ticked
- **YT-0442** `web` Question bank authoring — 3/3 AC ticked
- **YT-0444** `web` Team management — 2/2 AC ticked
- **YT-0445** `merchant` Merchant redemption portal — 4/4 AC ticked
- **YT-0446** `merchant` Store device provisioning and PIN unlock — 3/3 AC ticked
- **YT-0400** `web` Design tokens and theme — 4/4 AC ticked
- **YT-0401** `web` UI primitives — 4/4 AC ticked
- **YT-0402** `web` App shell and responsive navigation — 4/4 AC ticked
- **YT-0403** `web` Typed mock data layer — 4/4 AC ticked
- **YT-0404** `web` Performance budget harness — 3/3 AC ticked
- **YT-0410** `web` Earn board — 3/3 AC ticked
- **YT-0411** `web` Campaign entry card — the contract screen — 3/3 AC ticked
- **YT-0413** `web` Checkpoint question UI — 4/4 AC ticked
- **YT-0414** `web` Quick feed — 3/3 AC ticked
- **YT-0420** `web` Store browse — 3/3 AC ticked
- **YT-0422** `web` Burn flow with price lock — 4/4 AC ticked
- **YT-0423** `web` Wallet — 3/3 AC ticked
- **YT-0431** `web` Logged-out public pages — 3/3 AC ticked
- **YT-0432** `web` Open Viewing playback and conversion — 4/4 AC ticked
- **YT-0433** `web` Me, settings and consent controls — 3/3 AC ticked

### In progress

- **YT-0010** Legal positions register — 3/4 AC
- **YT-0529** Helios: environment layout and what shares the box — 2/6 AC
- **YT-0530** Helios: isolation and resource caps — 1/6 AC
- **YT-0030** Monorepo skeleton — 1/2 AC
- **YT-0507** `business` and `kyb_document` resource kinds — 0/3 AC
- **YT-0508** Promote business shapes into contracts — 0/3 AC
- **YT-0512** `apps/web` imports an undeclared package — 1/5 AC
- **YT-0509** Invert the contracts → authz dependency — 2/7 AC
- **YT-0510** Delete duplicate business shapes from `apps/api` — 2/4 AC
- **YT-0511** Repo-wide formatting gate — 1/2 AC
- **YT-0525** Migrate hand-built forms to React Hook Form — 1/6 AC
- **YT-0526** Testable HLS fixture for the player — 1/6 AC
- **YT-0502** Listing contract: multiple merchant locations — 2/3 AC
- **YT-0503** Campaign contract: chapters and video source — 2/3 AC
- **YT-0504** Wallet contract: points history and ledger projection — 2/3 AC
- **YT-0501** Field RUM for real INP — 2/6 AC
- **YT-0036** Consent service v1 — 7/8 AC
- **YT-0037** Jurisdiction policy service — 1/5 AC
- **YT-0039** Idempotency middleware (TypeScript) — 2/3 AC
- **YT-0548** Storage for campaign chapters and video source — 0/6 AC
- **YT-0550** Player: `Home` does not return the playhead to zero — 0/4 AC
- **YT-0552** Wire `apps/api` repositories to Postgres — 7/14 AC
- **YT-0553** API surface for campaign and watch — 8/13 AC
- **YT-0554** The API must not connect to Postgres as a superuser — 6/9 AC
- **YT-0556** Health endpoint — 2/3 AC
- **YT-0565** The ledger schema-drift regex fails open — 5/8 AC
- **YT-0513** Currency-tagged Money type — 5/6 AC
- **YT-0506** CONFIRM: does Xendit take IDR in rupiah or sen? — 13/18 AC
- **YT-0043** Chart of accounts — 6/7 AC
- **YT-0044** Invariant checker and daily proof — 8/10 AC
- **YT-0045** Reward Engine skeleton — 8/10 AC
- **YT-0055** Next.js app shell and design tokens — 2/4 AC
- **YT-0056** UI primitives package — 1/4 AC
- **YT-0058** Internationalisation scaffolding — 2/6 AC
- **YT-0100** Advertiser accounts and business onboarding — 1/3 AC
- **YT-0101** Campaign model and lifecycle — 7/9 AC
- **YT-0120** Watch session service — 9/11 AC
- **YT-0177** Streaks and daily check-in — 0/4 AC
- **YT-0180** Public catalogue and merchant pages — 5/7 AC
- **YT-0181** Internationalised routing and hreflang — 3/5 AC
- **YT-0203** User information architecture: five surfaces — 1/4 AC
- **YT-0212** Open Graph and share cards on public pages — 2/5 AC
- **YT-0130** Unified catalogue — 4/6 AC
- **YT-0141** Bulk issuance with two-person approval — 1/3 AC
- **YT-0142** Voucher lifecycle state machine — 3/5 AC
- **YT-0150** Redemption API: authorize — 2/3 AC
- **YT-0151** Redemption API: capture, void, refund — 3/4 AC
- **YT-0152** Merchant credentials and request signing — 2/5 AC
- **YT-0153** Enumeration defence and anomaly detection — 3/5 AC
- **YT-0155** Partial redemption policy — 2/4 AC
- **YT-0440** Business console shell — 1/2 AC
- **YT-0443** Business reports — 1/3 AC
- **YT-0405** Region and locale foundation (AU + ID) — 4/5 AC
- **YT-0412** Long-form player UI — 4/5 AC
- **YT-0421** Offer detail — 2/3 AC
- **YT-0424** Voucher detail and offline QR — 3/4 AC
- **YT-0430** Onboarding and phone OTP — 3/5 AC

### Blocked

- **YT-0534** Data residency: what Helios is allowed to hold
- **YT-0576** Nobody has defined what makes a settlement decrease "material"
- **YT-0124** Chapter-level reward accrual
- **YT-0562** DECIDE: what is a resale bid denominated in?
- **YT-0450** Clickable prototype walkthrough
- **YT-0451** Merchant and user reaction sessions

### Ready to start (no open dependencies)

- **YT-0001** `pilot` Pilot: recruit a launch merchant · 3d
- **YT-0220** `media` Spike: self-hosted HLS on R2 · 5d
- **YT-0221** `risk` Spike: does phone verification earn its friction? · 3d
- **YT-0222** `economy` Spike: bounded-loss economic model · 3d
- **YT-0020** `infra` GCP organisation, projects, billing, IAM baseline · 3d
- **YT-0025** `infra` Cloudflare: domains, CDN, R2, Stream, Turnstile · 3d
- **YT-0050** `economy` Name the economy owner · 2d
- **YT-0505** `infra` Reconcile pnpm-lock.yaml across sessions · 1h
- **YT-0558** `platform` Test configs hard-code `DATABASE_URL`, which defeats sabotage · 1h
- **YT-0569** `infra` No CI has ever run, and the workflows watch a branch that does not exist · 2d
- **YT-0543** `data` Geography taxonomy and boundary data · 5d

### Waiting on dependencies

- **YT-0011** Red-line register and enforcement → waiting on YT-0010
- **YT-0012** Counsel-substitution risk acceptance → waiting on YT-0010
- **YT-0013** Entity formation via notaris and corporate services → waiting on YT-0012
- **YT-0014** PSE registration (Indonesia) → waiting on YT-0013
- **YT-0015** Consumer-facing legal copy → waiting on YT-0010
- **YT-0016** Tax position on marketplace withholding → waiting on YT-0010
- **YT-0522** Split cloud tasks into local and deployed → waiting on YT-0520, YT-0521
- **YT-0021** Terraform skeleton and two data planes → waiting on YT-0020
- **YT-0022** PostgreSQL provisioned per region → waiting on YT-0021
- **YT-0023** Redis provisioned per region → waiting on YT-0516
- **YT-0024** Cloud Run, Artifact Registry, deploy pipeline → waiting on YT-0021
- **YT-0026** Secret Manager and KMS keyrings → waiting on YT-0020
- **YT-0027** Observability: OpenTelemetry, Grafana Cloud, Sentry → waiting on YT-0516
- **YT-0028** CI pipeline with all gates → waiting on YT-0030
- **YT-0531** Helios: Postgres with a restore that has actually been run → waiting on YT-0530
- **YT-0532** Helios: deploy pipeline with rollback → waiting on YT-0530, YT-0028
- **YT-0533** Secrets and keys without a KMS → waiting on YT-0530
- **YT-0538** Bot-check, OTP and messaging simulators → waiting on YT-0535
- **YT-0539** Boundary parity suite → waiting on YT-0537
- **YT-0540** Email and password authentication → waiting on YT-0516

<!-- /AUTO:DASHBOARD -->

---

## Status vocabulary

| Status    | Means                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `todo`    | Not started. Acceptance criteria written.                                                                                                  |
| `doing`   | Actively being worked. One or two per person, no more.                                                                                     |
| `review`  | Code complete, awaiting review or QA.                                                                                                      |
| `blocked` | Blocked by something **outside** the task graph — a decision, a vendor, a licence. Waiting on another task is not blocked; that is `dep:`. |
| `done`    | Every acceptance criterion ticked. Enforced by the validator.                                                                              |
| `cut`     | Decided against. Stays in the file so the history reads honestly.                                                                          |

## Phase gates

| Gate       | Must be true before the next phase starts                                                                                                                                                                                                                                                                                                          |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **−1 → 0** | ≥40% completion on a 15-min video; one merchant paid and wants to repeat.                                                                                                                                                                                                                                                                          |
| **0 → 1**  | A sister app logs a user in via YourtalID, calls the Reward Engine, and points appear as balanced ledger entries surviving a replay and a reconciliation run. Counsel has signed off the currency model in writing.                                                                                                                                |
| **1 → 2**  | 10+ paying merchants **who renewed**; **≥X% of voucher redeemers returned at full price within 90 days** (replaces redemption rate — see [`23`](docs/23-critique.md) §1.4); long-form completion above target; fraud loss within budget; CWV budgets met in the field; ledger, clearing and merchant reconciliation clean for 60 consecutive days. |
| **2 → 3**  | Revenue per active user hits the model; self-serve advertisers onboard and spend unaided; fraud loss below 2% of reward value issued.                                                                                                                                                                                                              |
| **3 → 4**  | Zero double-spend and zero duplicate-capture over a full quarter; AU cohort economics beat the model; legal sign-off that the marketplace remains closed-loop.                                                                                                                                                                                     |

## Working agreements

1. **No task starts without acceptance criteria.** If you cannot write them, the task is not understood yet.
2. **No task larger than 5 days.** Bigger tasks hide risk — split them.
3. **Anything touching the value path** (ledger, pricing, voucher, redemption, clearing) **needs a second reviewer.**
4. **A task is done when the boxes are ticked**, not when the code is merged.
5. **Regenerate the dashboard in the same commit** as any task change.
