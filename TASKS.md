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
| 🟢 **CI is green on main; the batch is pushed** | **All four workflows pass on `15d1f96`** — Integration, Quality, Format, Authorization policies. The Integration failure that stood since `5d49348` is **cleared**, closed by `yourtal-22`'s Cerbos schema revert. 15 commits flushed as one batch after their founder lifted the freeze for them. **Verified by reading the runs, not asserted** — the last time this row claimed green without checking, it had been red for three commits. |
| 📌 **Kept: I once reported a green tree without checking it** | I wrote "everything already pushed is green" while Integration had already failed three times. Caught by `yourtal-22`, not by me. **That is the exact failure this repo has spent the week documenting — asserting a pass rather than verifying one** — and it is worse coming from the session whose job is verifying other sessions' claims. The rule I have applied to ten gates applies to my own status reports: **a green you did not look at is not a green.** |
| ⚖️ **Two CI decisions waiting on you** | **1. `perf-budget.yml` is `pull_request`-only.** Work goes straight to `main` without PRs, so the performance budget — **LCP ≤ 2.0s, initial JS ≤ 200KB, TBT ≤ 200ms** — **cannot run at all** as this project actually commits. Adding a `push` trigger means Lighthouse on every commit; the alternative is adopting PRs. It is dispatchable on demand meanwhile. **2. Every no-skip guard in `integration.yml` has only ever been seen passing** — five of them. Per the house rule a guard first seen green has not been shown to work, so one deliberate `it.skip` should be pushed to watch it go red. Both are recorded in **YT-0569**. |
| 🧪 **YT-0527 is why `done` needs a second pair of eyes** | It sat at `review` with **4/4 criteria ticked**, and its Cerbos integration had never once been capable of running. Every box was defensible from reading the workflow file and false in the runner — including one ticked on reasoning (`watchForChanges` covers the ordering) that was wrong because **the setting lived in the config file that failed to mount for the same reason**. Back to `doing`. This is the argument for not rubber-stamping the other 41. |
| ✅ **Australia’s public surface serves** | `PUBLIC_LOCALES` and `GENERATED_PUBLIC_LOCALES` are **both** `["id", "au"]` (`apps/web/features/public/public-locale.ts:42,46` — re-read here, not taken on report), and `/au` serves genuinely Australian data — Sydney merchants, `audCents`-scaled amounts — rather than Jakarta content under an Australian URL. Closed by **YT-0181**/**YT-0405**. This row read _“Australia’s public surface returns 404”_ for some time after it stopped being true: it sits **outside the `AUTO:DASHBOARD` markers**, so `scripts/tasks.mjs` never corrects it and `--check` never flags it stale. **Three sessions lost time to it in one day**, and the heading was itself the false claim, so correcting the cell alone would have left the assertion standing as the title. **Prose above the markers is hand-maintained and carries none of the dashboard’s guarantees.** Text by `yourtal-54`, whose epic closed it; applied by the recorder. |
| 🗺️ **Coverage map — recorded, deliberately not started** | YT-0543..0546. Founder decision: it waits until the current plan is done and running. Three things captured now because they are cheap early and expensive late: **Australia Post licenses postcode data, the ABS does not**; **postcodes are delivery routes, not polygons** (SA2 is the right unit); and the **cohort floor must live in the aggregation, not the renderer** — a density map at low coverage re-identifies people. |
| 🔄 **Australia-primary — reported confirmed, roadmap not yet re-cut** | Relayed via another session: **Australia is the primary market, Indonesia the proving ground**, and the reward is _a reward, not a wage replacement_, at **less than AUD 5 per twenty minutes** depending on partner funding. Engineering consequences are already in flight (YT-0405 region support, region selection at registration) because they are right either way. **The roadmap, economics and legal sequencing have not been re-cut** — `docs/04` still has Indonesia as Phase 1 and Australia as Phase 3. That is ~2 days of work and I want it confirmed in this session first. See _What AU-primary would change_. |
| 👤 **YT-0050 is blocking real work now** | **Nobody owns the economy.** Two things wait on that person, not on engineering: **YT-0043's finance review cannot be ticked** (a ledger classification signed off by nobody is how a restatement starts), and **YT-0045's point values are placeholders** — the Reward Engine works, but nobody has said what an action is worth. Naming this person costs nothing and unblocks both. |
| ✅ **YT-0506 — decided: IDR is stored in sen** | **Founder decision 2026-09-20.** Sen is uncommon in daily use but **banking uses it** (`Rp 1.000,26`), which matches ISO 4217 and the original intent of `docs/12`/`docs/18`. **This settles the currency, not the processor** — what Xendit accepts is still unconfirmed, and that conversion belongs in the **PSP adapter**, exactly as YT-0537 already assumes. The migration is a **100× change to every stored and fixture IDR value** and runs as one unit of work behind the drift test. |
| 🌐 **All that is left of the cloud accounts is a domain** | **YT-0020** (GCP) and **YT-0025** (Cloudflare) are **deferred** — Helios replaces them and they now gate nothing. The one real remnant is **a domain and DNS**; a subdomain on a domain you already own carries us until then. |
| ✅ **Nothing is blocked on an account signup any more**               | The full stack runs locally: **Postgres · Cerbos · Valkey · Zitadel (real OIDC) · MinIO (S3)**. Eight tasks were re-parented off the cloud chain onto YT-0516 — they needed _a_ service, not a _managed_ one. Cloud tasks now cover **deployment only**. `pnpm dev:up`.                                                                                                                                                                                                                                                                                                                                                         |
| 🚀 **THE APP IS LIVE — https://yourtal.gaiada.com** | Deployed 2026-09-20 to Helios. `/`, `/au` and `/id` all **200 over HTTPS** with a valid certificate and CSS served. **The AU surface that was 404 for weeks is serving.** The whole loop runs unattended: push to `production` → CI gates and builds → publishes a checksummed `deploy/production-*` → the poller takes it within 60 s → verifies the sum → swaps the symlink → reloads pm2 → health-checks → `DEPLOY OK`. **No inbound port, no key in GitHub, no firewall allowlist touched** (decision S-1). **Rollback is proved by a real failure**, not a drill: a health check failed, the previous release was restored, and the app served 200 throughout. **This unblocks YT-0450**, which has wanted a deployed URL for weeks. |
| ⚠️ **`origin/production`'s tip still carries the infrastructure values** | `origin/main` is clean — the scrub went out with the batch — but **`production` never moved**, so its tip still serves Helios's IP, VPS hostname and the SSH-allowlisted office IP. **Contained while the repo is private; exposed at the TIP, not merely in history, the moment it is public again.** So YT-0578's history rewrite is **necessary and not sufficient**. The cheap fix is fast-forwarding `production` to `main`, which needs no rewrite — but it fires the Release workflow and **deploys to the live site within 60 seconds**, so it is a decision rather than a tidy-up. |
| 🖥️ **Helios is connected, surveyed, and it is in Jakarta** | Reached **directly** 2026-09-20 from the office IP — ufw rule 5 allowlists `<office-ip>`, so no jump host was needed. `server-c`, Ubuntu 24.04.5, **8 cores / 31 GB (22 free) / 166 GB disk free**. **Residency evidence points to Jakarta, Indonesia**: `ipinfo` → Jakarta + AS47583, host `<helios-vps-hostname>`, **14.4 ms to Bandung, 169.7 ms to Sydney**. If confirmed, Indonesian data is onshore and **Australian data becomes an APP 8 cross-border disclosure — on the primary market's main path**. One Hostinger billing-page check closes **YT-0534**, the oldest blocker on this board. |
| ✅ **Working from home is solved — `ssh helios-w`** | **`<decommissioned-jump>` is decommissioned**, and it was the only non-Hostinger jump, so Helios, Delphi, `jump-e`, `jump-b` and `new-pantheon` are all AS47583 — a Hostinger-wide block removes the destination and every usual path at once. **But the fleet already ran a WireGuard mesh for Alloy whose hub is _not_ Hostinger**: `<wg-hub>`, Tencent Cloud Singapore. Helios (`10.88.0.3`) and Delphi (`10.88.0.4`) **dial out** to it on a 25s keepalive, and outbound is never edge-filtered. **`helios-w` = `ProxyJump <wg-hub>` → `10.88.0.3`: no Hostinger address is contacted, and it does not need your IP allowlisted, because the source Helios sees is the hub's `10.88.0.2`.** Tested end to end. Required adding one firewall rule on Helios for the mesh subnet — the "WireGuard address on the allowlist" the org notes had recommended for months and nobody had actually put in place. **Order from home: `helios` → `helios-jb` → `helios-w`.** Runbook: `gaiada-setups/access/helios-home-access.md`. |
| ✅ **Delphi is on the mesh too, so the diagnostic works** | Delphi lacked the mesh firewall rule, which cost more than a second unreachable box: **Delphi is how you tell _not-allowlisted_ from _edge-blocked_**, since both present as an identical silent timeout — Delphi answering while Helios does not means the allowlist, neither answering means the edge. Reachable only over Hostinger, it would have failed in exactly the situation it exists for. **Rule applied on founder authorisation and verified.** Full matrix now tested end to end: `helios`, `helios-j`, `helios-jb`, `helios-w` → `server-c`; `delphi-w` and direct → `server-d`. Both `-w` routes report source `10.88.0.2`, the hub's address, which is what makes them independent of your IP. |
| 🧰 **Helios is provisioned and the caps are proved** | Unprivileged `yourtal` user (nologin, `0750`, `secrets/` at `0700`) and a systemd slice capping **2 of 8 cores, 4 GB hard / 3 GB soft, no swap, IOWeight 50** — sized against measured headroom and leaving the majority to the 30 client sites. **CPU cap proved by running a real runaway**: 8 busy loops throttled to **2.02 cores**, host load 1.82, clients unaffected. **The memory cap is only partly proved** — the soft limit visibly throttled at a 3.1 G peak, but `MemoryMax` was never reached, so the hard kill is still unproven and is recorded as such. |
| 🔑 **Two Helios findings that change the plan** | **1. Infisical is already self-hosted and running** (`/opt/infisical-core` v0.43.121, active). **YT-0533 was written as "secrets without a KMS" and that premise is wrong** — the question shrinks to whether to adopt the one that is there, which is shared with the client sites and the NOW platform, so it carries risk 39's blast-radius argument applied to credentials. **2. The box is more crowded than recorded**: nginx serves **30 live client hostnames**, plus NOW's 6 containers, sGTM, MariaDB, a host Postgres and CloudPanel. **No `26xxx` port is in use**, so YourTal's port scheme transfers unchanged, and `PORT=3001` avoids the `node` already on 3000. |
| ⚠️ **What genuinely cannot be simulated** | **1. Where Helios physically sits** (YT-0534) — a fact about a rented box, and it decides whether real Australian or Indonesian personal data may ever land on it. **2. Legal** — PSE registration, notaris, entity formation. **3. Real people** — simulated users cannot tell you whether anyone will watch twenty minutes. Everything else now has a simulator, and **every simulator can be driven into failure** (YT-0536). |
| ⚠️ **The value chain is proven in tests, and is not yet wired into the running system** | Partner buys points → allocation + reserve + `point_purchase` → user completes a campaign → risk gate, velocity caps, drawdown, ledger post, grant log in one transaction → hard-stop at zero. **YT-0044** proves it every 15 minutes with a write-once daily Merkle root, all against real Postgres. **But this row used to read "the value chain and its proof both run", and that was true of the Go test suites rather than of the product.** Relayed by `yourtal-22` and verified here: `services/ledger/cmd/ledger/main.go` registers exactly **`/healthz` and a 404** — the reward engine, pricing engine, chart of accounts and transfer API have **no HTTP caller at all** — and `apps/api` mentions "ledger" and "voucher" only in comments and Postgres role names, with **no `LEDGER_BASE_URL`, no client and no config anywhere**. The same week's lesson, one level up: a claim can be true of the tests and false of the system. `yourtal-22`'s agents are closing it now. |
| 🔐 **A merchant could have captured another merchant's hold** | Found by `yourtal-22` exposing `/v1/vouchers/{authorize,capture,void,refund}`, **verified here against `main`**: the authorization query is `WHERE id = $1 AND state = 'held' AND expires_at > now()` — **no merchant predicate**. Correct for the invariant the domain tests assert, and false the moment the id is client-supplied over HTTP. Proved by disabling the new check: **a stranger's signed capture succeeded and returned a receipt.** Fixed at the HTTP boundary with the same refusal a missing id gets, so it cannot be used to enumerate. **The query is still unscoped** — safe because one caller checks, which is a convention rather than a constraint. **YT-0571**, risk 50. Two smaller siblings of the same shape: **YT-0572** (a refusal message that reveals which check failed) and **YT-0573** (nothing ever marks a voucher `expired`, so the portal and reconciliation read a stale `state`). |
| 🚨 **A two-person-approval control is switched off by saying nothing** | `policies/resource_policies/listing.yaml:41` allows `set_settlement_value` when `!has(R.attr.isMaterialSettlementDecrease)` — **an `EFFECT_ALLOW` whose guard is satisfied by the attribute being absent**, so every settlement cut passes as non-material however large. Worse: the attribute **cannot** be supplied the normal way, because `attrsFrom` is synchronous and request-only while materiality compares against the *stored* `S`. **The correct calling pattern is the one that disables the control.** Its policy tests pass because they supply the attribute by hand, and nothing had ever reached it over HTTP. Found by `yourtal-22`'s agent 3, verified here. **YT-0574** (deny on absence), **YT-0575** (`approve_settlement_decrease` is a rule with no endpoint), risk 51. ⚠️ `policies/` belonged to `yourtal-e3`, **which has ended — this is unowned**. |
| ⛔ **Nobody has defined what makes a settlement cut "material"** | `docs/17` line 84 requires two-person approval for _"changing a settlement value downward by more than a threshold"_ and **names no number**; the resource schema repeats the phrase; the policy consumes the boolean. **Three references, zero definitions.** An agent used **20% as a loudly-commented placeholder** so the check would not be a no-op — correct behaviour, and it leaves a number one agent invented standing in front of a two-person control. It is not an engineering default: a decrease in `S` is a **direct cut to what a user's points are worth**, since `points_price = (S / B) × demand_multiplier`. **YT-0576**, and it needs the same person as **YT-0050**. |
| 🛑 **Still do not run `pnpm dev:reset` or `docker compose down -v` — and note `dev:reset` IS `down -v`** | **Rewritten 2026-09-21 because this row had started protecting the dead.** It named `yourtal-22`'s three worktree databases; that session has ended and **`yourtal_wt_voucher`, `yourtal_wt_ledger` and `yourtal_wt_store` no longer exist** — verified here against `pg_database`, which now holds `yourtal`, `yourtal_wt_policy` and `zitadel`. The whole stack was recreated at one moment and the volumes went with it. Probably harmless, since those three were disposable once their agents finished. **What is live and at risk now: `yourtal` itself, `yourtal_wt_policy`, and Zitadel's realm.** The ban stands and the reason is bigger: `dev:reset` is literally `docker compose down -v && docker compose up -d --wait` — it runs **neither** `db:migrate` nor `db:seed`, so it destroys every database in the shared cluster and hands back an **empty** one. **`pnpm dev:fresh` is the command that rebuilds.** YT-0519's criterion still tells the reader to run `dev:reset`, which is why that ticket failed verification. Also unexplained from the same recreation: **MinIO's S3 API port `26900` is not published** though compose declares it, so `packages/media`'s origin tests fail loud by design — not a regression, not yours, and `yourtal-c8` holds it. Nobody restarts shared infrastructure unilaterally. |
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

🚨 **CI HAS NOT EXECUTED ANYTHING SINCE ~15:14 ON 2026-09-21, AND EVERY RED SINCE THEN IS MEANINGLESS.** Runs are created and fail in **3 seconds with zero steps** — the runners are not starting, so no checkout, no install, no check. Confirmed across every workflow on ten consecutive commits: `gh run view <id> --json jobs` returns `steps=[]`, and `gh run view --log` returns `log not found` because there are no logs to fetch.

**The last runs that genuinely executed:**

| commit | result |
| --- | --- |
| `613ec48` 15:01 | **Quality ✅ · Format ✅ · Contracts ✅** · Integration ❌ (the missing Valkey, fixed since as YT-0599) |
| `28fcffd` 15:07 | **Format ✅** |
| `90c20f1` 15:09 | Format ❌ and Integration ❌ — real runs, 10 and 30 steps |

**So the last real signal was mostly green, and nobody should read "main is red" as a statement about the code.** Equally, nobody should read it as green: **there is no signal at all.** Production has deliberately not been deployed on this — a green you cannot explain is the same problem as a red you cannot explain, and right now there is neither.

**Someone needs to check the Actions quota or billing for this private repository.** A 3-second job with no steps is what an exhausted allowance looks like from the outside. Until it is running, `pnpm verify` locally and `git archive HEAD` for anything commit-shaped are the only gates that exist.

### Who is doing what

> ⚠️ **This table is hand-maintained. `node scripts/tasks.mjs` does not touch it and `--check` never validates it.** Everything between the `AUTO:DASHBOARD` markers below is generated from `docs/tasks/*.md` and is trustworthy; this table is prose and has been wrong repeatedly — it named three live sessions as dead, declared nine epics unowned while two were held continuously, and carried an invented session name for three hours. **`yourtal-ca` handed out four epics that were not theirs to hand out after reading it as fact.** Before acting on a row, ask the session. Added at `yourtal-5f`'s suggestion, which cost nothing and would have prevented that.

| Session        | Owns                                                                                    | Task files it may edit                    |
| -------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- |
| **yourtal-fe** _(was addressed as `yourtal-22` until ~16:50)_ | **The recorder**: `TASKS.md`, `docs/tasks/**`, `scripts/`, `_schema.md` | all board paths |
| **yourtal-b4** _(was `-08`)_ | `platform` | own `### YT-####` blocks, routed to the recorder |
| **yourtal-28** _(was `-a4`)_ | `economy` · `data` · `legal` | own blocks, routed |
| **yourtal-0c** | `value` — `services/ledger/**`, `services/voucher/**`, `packages/contracts/src/money/**` | own blocks, routed |
| **yourtal-4d** _(was `-54`)_ | `commerce` · `seo` · `watch` | own blocks, routed |
| **yourtal-5f** _(was `-c8`)_ | `web` — `apps/web/**` | own blocks, routed |
| **yourtal-6c** | `infra` · `adplatform` · `media` · `merchant` · `risk` · `store` · `pilot` — **the seven that were genuinely unowned** | own blocks, routed |
| **yourtal-ca** | **The `review` → `done` sweep.** Wrote none of the work, so eligible on all of it | none — sends findings to the recorder |
| _unheld_ | **`policies/` and `.github/workflows/`** — filed and still nobody's | — |

**`TASKS.md` is regenerated by the recorder only** (founder decision 2026-09-21, reassigning the role from `yourtal-a4`, which had held it since earlier the same day). Other sessions run `node scripts/tasks.mjs --check`, never the writing form, and send status changes with the command that proves them.

**Two things changed with the handover, and both are load-bearing.**

1. **The per-phase and per-epic narrative is now GENERATED**, inside the `AUTO:DASHBOARD` markers, from the tickets themselves — including a **widest gate** per phase and per epic, computed from *transitive* downstream reach. Do not hand-write status prose above the markers any more: that is the `/au` 404 shape, and row 25 explains what it cost. Prose that states a fact about the board is output. Prose that states intent is not, and belongs in `docs/tasks/` next to the work.
2. **Run `pnpm verify` before you commit.** Not advice. On 2026-09-21 `7f3317c`, `5eeb9ac` and `7508a56` landed in sequence and **each broke a different gate** — formatting (7 files), `@yourtal/api` typecheck (2), `@yourtal/contracts` lint (2) — and `a119f4d` added a fifth in `@yourtal/api` lint. None was caught by its author. The gate was red for roughly an hour and **no ticket resting on "the tests pass" could be verified against it in that window**, which is the real cost: a red gate does not just block merging, it suspends the review queue. All five are fixed.

⚠️ **A "cannot find module" typecheck failure straight after a merge is usually stale `node_modules`, not a defect.** `a119f4d` brought `@serwist/next` into `apps/web`; typecheck failed on it and on `@yourtal/media/hls-origin` until `pnpm install` relinked the workspace. Relink before you believe it, and before you file anything against the code.

⚠️ **This table is hand-maintained and sits outside the `AUTO:DASHBOARD` markers, so nothing validates it.** It named three dead sessions for at least a day while five live ones routed around it — each noticing it was wrong, none noticing it would never self-correct. **`git worktree list` shows which trees exist, not which are being worked in**, which is how the main tree was read as unclaimed while three sessions were writing in it. Before trusting a row here, ask the session.

⚠️ **A session's own name can change while it is running, and this one's did.** The session that holds the tracker was addressed as `yourtal-22` for most of 2026-09-21 and is `yourtal-fe` from ~16:50. **Every "Verified by `yourtal-22`" note dated 2026-09-21 after 14:20 is this session**, and so is every commit in that window. Nothing was handed over; only the address changed. Combined with the row below — where `yourtal-22` already named an *earlier, unrelated* session — the name is now ambiguous in two directions at once, which is the argument for **dating a verification rather than only signing it**.

✅ **Shipped to production 2026-09-21, on the founder's instruction.** `origin/main` and `origin/production` are both pushed; the release workflow published `deploy/production-20260921-141343-7f53741` and Helios installed it. **`https://yourtal.gaiada.com/au` returns 200 with `<html lang="en-AU">`** — that route 404'd on the pre-deploy code, so the Australian surface is genuinely live, which matters because AU is the primary market. Done by `yourtal-0c`, who checked the merged result for exposure first: 0 public IPv4 literals across `TASKS.md` and `docs/`, with a control case proving the pattern actually matches an address.

⚠️ **The deploy shipped with a knowingly broken rollback and that was an explicit founder decision, not an oversight.** **YT-0532**: `gaiada-deploy`'s reverse path loses `PM2_NAME`, swaps the symlink, then fails to restart — leaving pm2 running new code while `current` points at old, **across every Node site on that box**. It was put in front of the founder with the numbers before the push. **A successful deploy must not be read as this being resolved**; the next person to need a rollback is the one who finds out.

⚠️ **`store` is released and unowned as of ~17:2x** (`yourtal-0c`). It has no unblocked implementation work: YT-0130/0131 gate on `B` (YT-0049 → YT-0048 → YT-0012, signed at development stage today), YT-0132's last third needs web plus YT-0519, and **YT-0133 is blocked on YT-0593 and YT-0594** — the ledger transfer route and voucher issuance route, neither of which exists. So the epic is not idle for lack of a holder; it is genuinely gated.

✅ **The local `pnpm verify` signal is restored, and the six files blocking it all day contained no work at all.** Raised by `yourtal-0c`: *a gate that is permanently red for an ignorable reason cannot report a real one.* Six `.claude/` files had been dirty and unformatted since the morning, so every session's local gate failed at formatting regardless of what they had changed — which is why **main went red four times today without anyone seeing it locally first.** Running Prettier over them returned all six to **exactly their committed state**: they were never edited, only reformatted by something, and they cost five sessions their pre-commit signal for a whole day.

✅ **And 20 of the remaining failures were one defect wearing two gates.** Repairing CRLF on 20 tracked, clean files cleared **every outstanding `format:check` warning but one**. So roughly five "formatting failures" were line-ending drift, exactly as `yourtal-b4` predicted from their `seed.ts` case. **The rule, now proved at scale: when `check:eol` and `format:check` fail on the same file, fix the line endings first and re-check before touching the contents.** Reformatting first would have produced a real diff for a defect that was not there.

✅ **Ownership ruled by the founder ~18:2x, and the principle is worth more than the allocation: nobody loses in-flight work.** The contested epics went to their incumbents — `value` to `yourtal-0c`, who had just obtained the YT-0043 finance sign-off; `commerce`/`seo`/`watch` to `yourtal-4d`, mid-YT-0122; `web` to `yourtal-5f`, who had closed YT-0512, YT-0526 and YT-0550 that evening. **`yourtal-6c` takes the seven that were genuinely unowned**, which still contain the largest uncontested gate on the board. The earlier double-claim arose because a blanket reassignment met sessions that had already claimed and started — not because anyone acted wrongly.

⚠️ **A name that stops resolving means the NAME ended, not the session — and this table got that wrong within minutes of being written to warn about it.** At ~16:50 all five peer addresses stopped resolving and five new ones appeared. This session recorded that as "all five ended, nine epics unowned". **It was wrong.** `yourtal-28` then identified itself as the former `yourtal-a4`, same session, same 26 tickets, continuous since ~13:00, third name of the day — and this session's own address had changed the same way an hour earlier. **The correct inference from a vanished name is that addressing changed, not that work was abandoned**; the expensive version of this mistake is reassigning an epic that already has a holder. Ask before you reassign.

⚠️ **`yourtal-22` names two different sessions in this document, and everything historical under that name belongs to the first one.** The first `-22` ran three agents on vouchers and the ledger and **ended** before the current one started; the rows above crediting `-22` with the merchant-capture finding, the `set_settlement_value` hole, the Cerbos schema revert and the worktree databases are **all the first session's work.** The second `-22` started 2026-09-21 ~14:20 and holds the tracker. **Neither wrote the other's rows.** Caught by `yourtal-54`, who had read the morning table and knew the first one was gone; **this line originally claimed the session had been resurrected, which was wrong** — a name was recycled, and a recycled name pointing at two sessions inside one document is worse than a stale row, because nothing about it reads as stale. `yourtal-a4` found the live `-22` at all only by listing sessions after an unexplained `+109` in `scripts/tasks.mjs` did not add up: **the diff caught it, the table did not.**

⚠️ **A session cannot read its own name off its session id, and this one guessed wrong.** `-22` inferred `yourtal-90` from session `906b333a` and wrote it into this table and into a message to `-a4`, who is addressed by the real name and had to point it out. **Ask `ListAgents` for your own name before you sign anything with it** — a wrong name in a hand-maintained table is indistinguishable from a sixth session that does not exist.

⚠️ **The tracker has now had two holders believing they were sole, twice in one day** — `-a4`/`-b6` in the morning, `-a4`/`-22` in the afternoon. Both were caught by a session asking the founder rather than by either claimant standing down. **A grant of this role is not complete until the previous holder has said it is**, and the previous holder is the one who should write the row.

⚠️ **Five sessions share one physical checkout, so file-level ownership is not enough.** Two sessions editing different blocks of one file is a read-modify-write race, not a git merge — there are no conflict markers and the loser's edit vanishes with nothing to review. The working rules: **own `### YT-####` blocks, not files**; **targeted exact-string edits only, never read-whole-file-then-rewrite**; **announce the file before writing it**; **`git add -p`, never a whole shared task file**, and read the staged diff — `git status --porcelain` tells you which paths move, not what they say.

⚠️ **Size every shared file before staging it: a file you touched is not a file you own.** A path list says which files move, not **whose work is in them** — the same lesson as `--porcelain`, one level up. `yourtal-54` caught this on itself before staging: its checkpoint work added **three lines** to `packages/contracts/src/db-drift/schema-drift.test.ts`, and the file's uncommitted diff is **+147**, referencing **YT-0555 ×8**, YT-0554 ×2, YT-0575, YT-0552, YT-0551, YT-0536, YT-0141, YT-0130, YT-0120 — and YT-0121 once. Following an agreed path list would have committed `yourtal-08`'s entire YT-0555 audit under 54's authorship with a message about checkpoint tokens. **That is `182d7fc` reproduced move for move**, and the only thing that stopped it was measuring the diff rather than trusting the list. Shared drift tests, registries and workspace manifests are where this concentrates.

⚠️ **Verifying against the wrong tree is the day's recurring failure, and it has four shapes.** Three are fixable by looking harder: a **stale claim** (board optimistic — a ticket asserts something the code no longer does), a **stale blocker** (board pessimistic — a dependency was satisfied and nobody updated the ticket), and **another session's uncommitted work read as settled state** — a dirty-tree snapshot carries no authorship and no timestamp, so minutes-old and month-old work look identical. The fourth is **not** fixable by looking harder: **a peer's unmerged branch is genuinely invisible**, so a reading that is correct against `main` can be false against a branch you cannot see. The remedy there is to ask the session, not to grep more carefully. Four instances on 2026-09-21; only the last was unavoidable.

**Ownership is stale the moment a session ends, and it ended three times today without the table noticing.** Checked 2026-09-20 against the live session list: **e3, 5a and af are gone**, and `yourtal-22` is running and was not in the table at all. Their unfinished work is now unowned — it is in the task graph, not in anyone's hands. `yourtal-14` owns `docs/`, `scripts/`, `.githooks/`, `.github/workflows/` and this tracker. **`apps/web`, `packages/contracts` and `packages/db` are shared surfaces: announce the paths, not just the ticket.** Naming tickets instead of paths caused three mid-write races in one day.

**`packages/contracts` is shared, not disjoint.** It was `yourtal-e3`'s for API shapes; **that session has ended, so it is currently unowned** while remaining the one surface where concurrent sessions actually collide. **Rule: anyone adding to it announces what they add rather than assuming.** The registry completeness gate has caught every addition so far, which is why the overlap has been safe rather than lucky.

**Announced 2026-09-20 by `yourtal-22` (agent 3, store module).** In its `src/listing/**` allowlist: **`listing.ts`** gains `perUserLimit`, optional with no default so every existing fixture still parses, and **`listing.test.ts`** covers its round-trip and rejection. **Outside that allowlist, flagged by the agent itself rather than slipped through**: `db-drift/schema-drift.test.ts` adds `lifecycle_state` to `store.listings`' `columnsWithNoField` exemption — the same public/internal split `campaignSchema.status` already makes; `openapi/route-drift.test.ts` adds 11 routes to `KNOWN_OUT_OF_SCOPE`, the convention campaign and watch already use; and `openapi/yourtal.openapi.json` plus `openapi/go/model_listing.go` are **mechanically regenerated** — both gates were red until it ran them. `yourtal-22` reviewed these as additive exemptions and generated output with no schema decisions. **Recorded because the boundary moved**: a module cannot keep the drift gates honest for its own tables without touching the files those gates live in, which is worth knowing before the next allowlist is drawn.

**Open, small, and nobody's yet:** there is **no `listing_view` Cerbos kind**, so public store browse uses `@PublicRoute` rather than the `campaign` / `campaign_view` split. If browse should ever require even a bare signed-in check, that is a `policies/` decision — and `policies/` is unowned.

<!-- AUTO:DASHBOARD -->

_Generated by `scripts/tasks.mjs` — do not edit by hand._

**304 tasks** — **82 finished (27%)** · 45 in progress · 173 not started · 4 blocked

**979 engineer-days left of 1209** — **19% of the estimated effort is settled**, against 27% of the task count. Effort counts every `todo`, `doing` and `blocked` task at its FULL estimate, so a half-finished task bills in full. These are ideal engineer-days for one person — divide by real throughput, not by headcount.

Of the 82 finished: **80 independently verified**, 2 awaiting a verifier. A task is only DONE when a session other than the one that did the work has checked it. **The two reviews sampled so far were both wrong**, so that queue is work rather than a formality.

### By phase

| Phase | Done | Review | Doing | Left | Settled |
|---|---|---|---|---|---|
| Phase U · UI first  ◀ NEXT | 28/36 | 0 | 5 | 21d | `████████░░` 78% |
| Phase −1 · Pilot | 0/13 | 0 | 0 | 36d | `░░░░░░░░░░` 0% |
| Phase 0 · Foundations | 43/135 | 0 | 24 | 258d | `███░░░░░░░` 32% |
| Phase 1 · Indonesia MVP | 9/92 | 2 | 16 | 312d | `█░░░░░░░░░` 12% |
| Phase 2 · Depth | 0/22 | 0 | 0 | 240d | `░░░░░░░░░░` 0% |
| Phase 3 · Marketplace & AU | 0/6 | 0 | 0 | 112d | `░░░░░░░░░░` 0% |

- **Phase U · UI first  ◀ NEXT** — **28 of 36 settled** (28 verified · 0 awaiting a verifier) · 5 in progress · **21d** left · **1 ready to start** · 2 blocked outside the graph. Widest gate: **YT-0450** `web` `blocked` — **1** open task downstream.
- **Phase −1 · Pilot** — **0 of 13 settled** (0 verified · 0 awaiting a verifier) · 0 in progress · **36d** left · **4 ready to start**. Widest gate: **YT-0220** `media` `todo` — **26** open tasks downstream.
- **Phase 0 · Foundations** — **43 of 135 settled** (43 verified · 0 awaiting a verifier) · 24 in progress · **258d** left · **44 ready to start** · 10 more once in-flight dependencies land. Widest gate: **YT-0529** `infra` `doing` — **45** open tasks downstream.
- **Phase 1 · Indonesia MVP** — **11 of 92 settled** (9 verified · 2 awaiting a verifier) · 16 in progress · **312d** left · **4 ready to start** · 13 more once in-flight dependencies land · 1 blocked outside the graph. Widest gate: **YT-0100** `adplatform` `doing` — **65** open tasks downstream.
- **Phase 2 · Depth** — **0 of 22 settled** (0 verified · 0 awaiting a verifier) · 0 in progress · **240d** left · **2 ready to start** · 6 more once in-flight dependencies land · 1 blocked outside the graph. Widest gate: **YT-0543** `data` `todo` — **3** open tasks downstream.
- **Phase 3 · Marketplace & AU** — **0 of 6 settled** (0 verified · 0 awaiting a verifier) · 0 in progress · **112d** left · **nothing ready to start now**. Widest gate: **YT-0320** `store` `todo` — **1** open task downstream.

### By epic

| Epic | Done | Review | Doing | Ready | Left | Settled |
|---|---|---|---|---|---|---|
| `adplatform` | 1/17 | 0 | 1 | **3** +1 | 93d | `█░░░░░░░░░` 6% |
| `commerce` | 0/1 | 0 | 0 | — | 20d | `░░░░░░░░░░` 0% |
| `data` | 0/9 | 0 | 2 | **2** +2 | 47d | `░░░░░░░░░░` 0% |
| `economy` | 2/8 | 0 | 3 | **1** +2 | 28d | `███░░░░░░░` 25% |
| `infra` | 6/33 | 0 | 3 | **14** +2 | 87d | `██░░░░░░░░` 18% |
| `legal` | 2/10 | 0 | 2 | **3** +1 | 34d | `██░░░░░░░░` 20% |
| `media` | 1/13 | 0 | 1 | **1** | 67d | `█░░░░░░░░░` 8% |
| `merchant` | 2/17 | 0 | 5 | **1** +6 | 66d | `█░░░░░░░░░` 12% |
| `pilot` | 0/11 | 0 | 0 | **1** | 29d | `░░░░░░░░░░` 0% |
| `platform` | 27/57 | 0 | 7 | **14** +4 | 90d | `█████░░░░░` 47% |
| `risk` | 0/15 | 0 | 0 | **5** +1 | 69d | `░░░░░░░░░░` 0% |
| `seo` | 1/5 | 2 | 1 | — | 8d | `██▓▓▓▓░░░░` 60% |
| `store` | 0/10 | 0 | 3 | **1** +1 | 92d | `░░░░░░░░░░` 0% |
| `value` | 7/29 | 0 | 5 | **3** +7 | 106d | `██░░░░░░░░` 24% |
| `watch` | 4/8 | 0 | 1 | **1** | 15d | `█████░░░░░` 50% |
| `web` | 27/61 | 0 | 11 | **5** +2 | 128d | `████░░░░░░` 44% |

**`Ready`** counts tasks whose every dependency is `done` or `cut` — work someone can pick up today. **`+n`** is how many more become available once dependencies already in flight land: a forecast, not an offer. They used to be summed under the first heading, which overstated it by **45 tasks**.

- `adplatform` — **1 of 17 settled** (1 verified · 0 awaiting a verifier) · 1 in progress · **93d** left · **3 ready to start** · 1 more once in-flight dependencies land. Widest gate: **YT-0100** `adplatform` `doing` — **65** open tasks downstream.
- `commerce` — **0 of 1 settled** (0 verified · 0 awaiting a verifier) · 0 in progress · **20d** left · **nothing ready to start now**.
- `data` — **0 of 9 settled** (0 verified · 0 awaiting a verifier) · 2 in progress · **47d** left · **2 ready to start** · 2 more once in-flight dependencies land. Widest gate: **YT-0519** `data` `doing` — **13** open tasks downstream.
- `economy` — **2 of 8 settled** (2 verified · 0 awaiting a verifier) · 3 in progress · **28d** left · **1 ready to start** · 2 more once in-flight dependencies land. Widest gate: **YT-0048** `economy` `doing` — **24** open tasks downstream.
- `infra` — **6 of 33 settled** (6 verified · 0 awaiting a verifier) · 3 in progress · **87d** left · **14 ready to start** · 2 more once in-flight dependencies land. Widest gate: **YT-0529** `infra` `doing` — **45** open tasks downstream.
- `legal` — **2 of 10 settled** (2 verified · 0 awaiting a verifier) · 2 in progress · **34d** left · **3 ready to start** · 1 more once in-flight dependencies land · 1 blocked outside the graph. Widest gate: **YT-0011** `legal` `doing` — **1** open task downstream.
- `media` — **1 of 13 settled** (1 verified · 0 awaiting a verifier) · 1 in progress · **67d** left · **1 ready to start**. Widest gate: **YT-0220** `media` `todo` — **26** open tasks downstream.
- `merchant` — **2 of 17 settled** (2 verified · 0 awaiting a verifier) · 5 in progress · **66d** left · **1 ready to start** · 6 more once in-flight dependencies land. Widest gate: **YT-0150** `merchant` `doing` — **18** open tasks downstream.
- `pilot` — **0 of 11 settled** (0 verified · 0 awaiting a verifier) · 0 in progress · **29d** left · **1 ready to start** · 1 blocked outside the graph. Widest gate: **YT-0001** `pilot` `todo` — **9** open tasks downstream.
- `platform` — **27 of 57 settled** (27 verified · 0 awaiting a verifier) · 7 in progress · **90d** left · **14 ready to start** · 4 more once in-flight dependencies land. Widest gate: **YT-0552** `platform` `doing` — **18** open tasks downstream.
- `risk` — **0 of 15 settled** (0 verified · 0 awaiting a verifier) · 0 in progress · **69d** left · **5 ready to start** · 1 more once in-flight dependencies land. Widest gate: **YT-0051** `risk` `todo` — **10** open tasks downstream.
- `seo` — **3 of 5 settled** (1 verified · 2 awaiting a verifier) · 1 in progress · **8d** left · **nothing ready to start now**. Widest gate: **YT-0205** `seo` `review` — **6** open tasks downstream.
- `store` — **0 of 10 settled** (0 verified · 0 awaiting a verifier) · 3 in progress · **92d** left · **1 ready to start** · 1 more once in-flight dependencies land. Widest gate: **YT-0130** `store` `doing` — **21** open tasks downstream.
- `value` — **7 of 29 settled** (7 verified · 0 awaiting a verifier) · 5 in progress · **106d** left · **3 ready to start** · 7 more once in-flight dependencies land. Widest gate: **YT-0142** `value` `doing` — **30** open tasks downstream.
- `watch` — **4 of 8 settled** (4 verified · 0 awaiting a verifier) · 1 in progress · **15d** left · **1 ready to start** · 1 blocked outside the graph. Widest gate: **YT-0123** `watch` `todo` — **8** open tasks downstream.
- `web` — **27 of 61 settled** (27 verified · 0 awaiting a verifier) · 11 in progress · **128d** left · **5 ready to start** · 2 more once in-flight dependencies land · 1 blocked outside the graph. Widest gate: **YT-0055** `web` `doing` — **26** open tasks downstream.

### In review (work complete, gate not yet passed)

- **YT-0181** `seo` Internationalised routing and hreflang — 6/6 AC ticked
- **YT-0205** `seo` Logged-out surfaces — 3/3 AC ticked

### In progress

- **YT-0011** Red-line register and enforcement — 1/4 AC
- **YT-0519** Seed the real database from the mock generators — 6/7 AC
- **YT-0529** Helios: environment layout and what shares the box — 3/5 AC
- **YT-0530** Helios: isolation and resource caps — 1/6 AC
- **YT-0532** Helios: deploy pipeline with rollback — 4/14 AC
- **YT-0534** Data residency: what Helios is allowed to hold — 3/4 AC
- **YT-0538** Bot-check, OTP and messaging simulators — 2/3 AC
- **YT-0509** Invert the contracts → authz dependency — 3/5 AC
- **YT-0037** Jurisdiction policy service — 1/5 AC
- **YT-0547** Test isolation: one database per package, not one lock per file — 0/5 AC
- **YT-0548** Storage for campaign chapters and video source — 0/6 AC
- **YT-0552** Wire `apps/api` repositories to Postgres — 7/13 AC
- **YT-0582** `PrincipalService` cannot populate the attributes four policies depend on — 1/2 AC
- **YT-0575** `approve_settlement_decrease` is a rule with no way to invoke it — 1/3 AC
- **YT-0513** Currency-tagged Money type — 5/6 AC
- **YT-0506** CONFIRM: does Xendit take IDR in rupiah or sen? — 15/18 AC
- **YT-0044** Invariant checker and daily proof — 8/10 AC
- **YT-0045** Reward Engine skeleton — 8/10 AC
- **YT-0048** Monetary policy, written down — 1/3 AC
- **YT-0049** Pricing engine — 1/3 AC
- **YT-0055** Next.js app shell and design tokens — 2/4 AC
- **YT-0056** UI primitives package — 1/4 AC
- **YT-0058** Internationalisation scaffolding — 2/6 AC
- **YT-0525** Migrate hand-built forms to React Hook Form — 4/5 AC
- **YT-0501** Field RUM for real INP — 3/5 AC
- **YT-0550** Player: `Home` does not return the playhead to zero — 0/1 AC
- **YT-0564** The result screen says "Total received" for a number nobody has granted — 2/3 AC
- **YT-0100** Advertiser accounts and business onboarding — 1/3 AC
- **YT-0207** Open Viewing: anonymous full-campaign playback — 0/4 AC
- **YT-0177** Streaks and daily check-in — 0/4 AC
- **YT-0203** User information architecture: five surfaces — 1/4 AC
- **YT-0212** Open Graph and share cards on public pages — 4/5 AC
- **YT-0215** Interest taxonomy — 2/4 AC
- **YT-0130** Unified catalogue — 4/6 AC
- **YT-0131** Supplier listing management — 1/3 AC
- **YT-0132** Store browse and search — 1/3 AC
- **YT-0141** Bulk issuance with two-person approval — 1/3 AC
- **YT-0142** Voucher lifecycle state machine — 3/5 AC
- **YT-0150** Redemption API: authorize — 2/3 AC
- **YT-0151** Redemption API: capture, void, refund — 3/4 AC
- **YT-0152** Merchant credentials and request signing — 2/5 AC
- **YT-0153** Enumeration defence and anomaly detection — 3/5 AC
- **YT-0155** Partial redemption policy — 2/4 AC
- **YT-0443** Business reports — 1/3 AC
- **YT-0430** Onboarding and phone OTP — 3/5 AC

### Blocked

- **YT-0124** Chapter-level reward accrual
- **YT-0562** DECIDE: what is a resale bid denominated in?
- **YT-0450** Clickable prototype walkthrough
- **YT-0451** Merchant and user reaction sessions

### Ready to start (no open dependencies)

- **YT-0598** `merchant` The merchant portal is hardcoded Indonesian · 2d
- **YT-0001** `pilot` Pilot: recruit a launch merchant · 3d
- **YT-0220** `media` Spike: self-hosted HLS on R2 · 5d
- **YT-0221** `risk` Spike: does phone verification earn its friction? · 3d
- **YT-0222** `economy` Spike: bounded-loss economic model · 3d
- **YT-0013** `legal` Entity formation via notaris and corporate services · 10d
- **YT-0015** `legal` Consumer-facing legal copy · 8d
- **YT-0016** `legal` Tax position on marketplace withholding · 3d
- **YT-0020** `infra` GCP organisation, projects, billing, IAM baseline · 3d
- **YT-0023** `infra` Redis provisioned per region · 1d
- **YT-0025** `infra` Cloudflare: domains, CDN, R2, Stream, Turnstile · 3d
- **YT-0027** `infra` Observability: OpenTelemetry, Grafana Cloud, Sentry · 4d
- **YT-0028** `infra` CI pipeline with all gates · 4d
- **YT-0032** `platform` Zitadel deployed, realm per country · 5d
- **YT-0038** `platform` Hash-chained audit log · 4d
- **YT-0047** `value` Solvency monitor and coverage dashboard · 4d
- **YT-0051** `risk` Device signal interface, web implementation · 4d
- **YT-0052** `risk` Turnstile and rate limiting · 3d
- **YT-0059** `data` Event schema and ingestion skeleton · 4d
- **YT-0505** `infra` Reconcile pnpm-lock.yaml across sessions · 1h
- **YT-0514** `platform` Idempotency: Go implementation · 2d
- **YT-0522** `infra` Split cloud tasks into local and deployed · 1h
- **YT-0524** `platform` Reporting contract gaps · 3d
- **YT-0528** `platform` The remaining seven DSAR handlers · 5d
- **YT-0539** `platform` Boundary parity suite · 2d
- _…and 30 more_

### Waiting on dependencies

- **YT-0014** PSE registration (Indonesia) → waiting on YT-0013
- **YT-0021** Terraform skeleton and two data planes → waiting on YT-0020
- **YT-0022** PostgreSQL provisioned per region → waiting on YT-0021
- **YT-0024** Cloud Run, Artifact Registry, deploy pipeline → waiting on YT-0021
- **YT-0026** Secret Manager and KMS keyrings → waiting on YT-0020
- **YT-0602** Red line 4 voids the risk acceptance and nothing enforces it → waiting on YT-0011
- **YT-0531** Helios: Postgres with a restore that has actually been run → waiting on YT-0530
- **YT-0533** Secrets and keys without a KMS → waiting on YT-0530
- **YT-0033** Phone OTP login flow → waiting on YT-0538
- **YT-0034** OIDC client for the first sister app → waiting on YT-0033
- **YT-0549** Seeded user personas for journey and load testing → waiting on YT-0519
- **YT-0560** The route gate checks method and path, not shape → waiting on YT-0559
- **YT-0561** The accuracy half of the reward has no server-side home → waiting on YT-0102, YT-0045
- **YT-0566** The hold sweeper has no alarm and availability depends on it → waiting on YT-0151
- **YT-0570** Bring the Go services into `integration.yml` once they are in compose → waiting on YT-0569
- **YT-0596** Six principal call sites still bypass the async resolver → waiting on YT-0582
- **YT-0597** The first wallet controller must resolve principals asynchronously → waiting on YT-0582
- **YT-0585** Wallet history derived from real ledger entries → waiting on YT-0044
- **YT-0053** WebAuthn passkey enrolment → waiting on YT-0033
- **YT-0054** Risk score service and trust tiers → waiting on YT-0051, YT-0052

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
