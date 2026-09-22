# Phase 0 · Helios deployment target and the simulation seam

> ⚠️ **This repository was PUBLIC for a few hours on 2026-09-20 and is private again.** Infrastructure addresses that used to appear here inline — Helios's IP, its VPS hostname, the jump hosts, the WireGuard hub, and the office IP that `ufw` allowlists for SSH — are now written as `<placeholders>` — **addresses AND host names**. The first pass replaced only address literals and missed the names, so `<decommissioned-jump>` and `<wg-hub>` survived a scrub that claimed to have removed them. Caught by `yourtal-22`. **A redaction list built from one kind of identifier misses every other kind**, and the banner asserting completeness was the part that made it hard to notice. The real values live in **`gaiada-setups/access/`**, which is private: `server-inventory.md` and `helios-home-access.md`.
>
> **Why this matters more than it looks.** No credential leaked — `.env` has never been committed and no key files are tracked. The disclosure was *targeting information*: taken together these named which box to attack, what it runs, and which sources it trusts. The sharpest item was not the Helios IP, which DNS publishes anyway, but the **combination** of the WireGuard hub's address with the fact that the mesh subnet is SSH-allowlisted on both boxes — that describes a route which bypasses the per-IP allowlist entirely.
>
> ⛔ **The scrub closed the tip and not the exposure, for two reasons.** It was never pushed — it sat behind the Actions freeze while `origin/main` went on serving the real values to the world. And even pushed, two earlier commits carry them in history, where a scrub commit hides them from the tip and from nobody else. **What actually closed it was the visibility flip** — the founder asked for the exposure closed and `yourtal-24` made the change. Recorded precisely because YT-0578 is `blocked` on the founder, and a record that credits them with a decision they have not made would read as though it were already taken.
>
> ⏭️ **The history rewrite is still outstanding — YT-0578.** Harmless while private; **it must happen before this repository is ever made public again**, or the next flip re-exposes everything instantly. Forks were 0 at the moment it went private and the repo was a few hours old, so realistic exposure is small — not provably zero.
>
> **Assume these values are known** and treat the allowlist as what it always was: a control that requires an attacker to *come from* those addresses, not one that depends on them staying secret.


**Decision, 2026-09-19:** the deployment target is **Helios** (`server-c`, `<helios-ip>`, Ubuntu 24.04, CloudPanel + nginx, 8 vCPU / 31 GB), the existing production box in the sister-company fleet. **All third-party connections are held** until later; every external boundary runs a simulator instead. Auth is ordinary email + password.

This supersedes the GCP/Cloudflare shape in [`phase-0-foundation.md`](phase-0-foundation.md) (YT-0020, 0021, 0022, 0024, 0025, 0026), which is **deferred, not deleted** — a two-region managed deployment is still the right answer for production, and those tasks describe it.

**What this buys:** deployment stops waiting on the founder opening cloud accounts. **What it costs:** one box, one country, no HA, no managed PITR, and no HSM — each of which is a task below rather than an assumption.

---

## The target

### YT-0529 · Helios: environment layout and what shares the box
`doing` · P0 · infra · 2d · dep: —

**Surveyed live 2026-09-20 over SSH.** `server-c` / `<helios-vps-hostname>` — Ubuntu 24.04.5 LTS, x86_64, **8 cores, 31 GB RAM (9 used, 22 available), 387 GB disk with 166 GB free**, load average ~1.0. Connection is **direct**, not via the jump host: ufw rule 5 allowlists this office IP (`<office-ip>`, `# operator-ssh`) on 22/tcp.

**What actually shares the box — worse than "some client sites":**

| | |
| --- | --- |
| **nginx** | **30 distinct `server_name` entries**, including `balispaguide.com`, `blossomcatering.online`, `cosmedic.bimcbali.com`, `dms.viceroybali.com` — live client production |
| **NOW platform** | 6 containers: `now-web-bali`, `now-web-jakarta`, `now-engine-api`, `now-engine-worker`, `now-postgres`, `now-redis` |
| **sGTM** | 2 containers (server-side Google Tag Manager) |
| **Databases** | **MariaDB** (~0.6 GB, for the PHP/CloudPanel sites) and a **host Postgres on `127.0.0.1:5432`**, separate from `now-postgres` |
| **Control plane** | CloudPanel (`clp-agent`, `clp-nginx`, `clp-php-fpm`) on `0.0.0.0:8443` |
| **Secrets** | **Infisical self-hosted and running** — `/opt/infisical-core`, v0.43.121, `active`. See YT-0533, which assumed there was none |
| **Observability** | Grafana **Alloy**; plus `fail2ban`, `chrony` |
| **Other** | `bsc-api-proxy`, `cmc-api`, a bare `node` on `0.0.0.0:8082`, a **PM2** process on `0.0.0.0:3016` |

**Port 3000 is already taken** by a `node` process, so `.env.example`'s `PORT=3001` does not clash. **No `26xxx` port is in use anywhere on the box**, so YourTal's entire local port scheme transfers unchanged.

⚠️ **Two existing services bind `0.0.0.0` without obvious need** — `:8082` (node) and `:3016` (PM2). Not ours and not this ticket's to fix, but recorded: the fourth criterion below is a rule we are about to hold ourselves to while the box already breaks it.

- 🚫 **RETIRED by founder decision S-3, 2026-09-22 — not deferred, cancelled.** `staging` and `production` are **separate Postgres databases and separate system users** on one host — not one database with a flag
- ℹ️ **Why it is retired rather than failed**: it asks for a separation between `staging` and `production`, and there will be **only one environment** while the project is in development. A comparison with nothing on one side cannot be verified or falsified. Left as an open box it would cost the next reader a session discovering that. **If a real staging environment is wanted before launch, that is a new decision and a new criterion**
- [ ] YourTal cannot read, write or restart anything belonging to the client sites already on Helios
- [x] **`gaiada-poll.timer` is green — verified 2026-09-20 on the box, not assumed.** `active (waiting)` since 2026-09-13, `Result=success`, `NRestarts=0`, `ExecMainStatus=0`. The 60-second failure loop recorded on 2026-08-18 has been fixed by someone since. Re-check before adding to it, because this is exactly the kind of fact that expires
- [x] **Access survives leaving the office.** `<decommissioned-jump>` is decommissioned and was the only non-Hostinger jump, so every remaining route and destination is AS47583 — a Hostinger-wide block on an address removes the box and all paths to it simultaneously, and a firewall cannot help because the block is upstream. **Solved using what already existed**: the Alloy WireGuard mesh's hub is `<wg-hub>`, **Tencent Cloud Singapore**, and Helios dials **out** to it. `helios-w` (`ProxyJump <wg-hub>` → `10.88.0.3`) contacts no Hostinger address and does not need the operator's IP allowlisted, because the source Helios sees is the hub's `10.88.0.2`. **Tested end to end.** Needed one firewall rule for `10.88.0.0/24` — the fix the org's own notes had recommended for months without anyone applying it
- [x] **Delphi is on the mesh too** — same rule applied 2026-09-20 on founder authorisation, `delphi-w` verified returning `server-d` with source `10.88.0.2`. This mattered beyond redundancy: **Delphi is the diagnostic separating _not-allowlisted_ from _edge-blocked_**, both of which present as an identical silent timeout, and while it was reachable only over Hostinger that diagnostic would have failed in precisely the scenario it exists for
- [ ] Every port we take is recorded in one file; nothing binds `0.0.0.0` that does not have to — **HALF VERIFIED, and deliberately left unticked; see below**
- ⚠️ **Criterion 3 splits cleanly into a repo half and an on-box half, and only the repo half has two pairs of eyes. Left unticked because the UNVERIFIED half is the security-relevant one.**
  - **Repo half — verified twice, independently.** `infra/PORTS.md` cross-checks cleanly against `docker-compose.yml`: every published port in compose (`26080, 26379, 26432, 26592, 26900, 26901, 26910, 26911`) appears in the registry, and the registry's one extra — `26300` at `:63`, the deployed `apps/web` under PM2 fronted by nginx — is correctly absent from compose because it is not a container. **Nothing in either file is unaccounted for in the other.** Checked by `yourtal-ca`, then again by `yourtal-fe`
  - **On-box half — single-sourced and NOT signed.** *"Nothing binds `0.0.0.0` that does not have to"* was established by `yourtal-6c` reading the owning UID of each listening pid on production. **`yourtal-ca` has no production access, did not attempt it, and declined to sign it.** That is the correct call, and it is recorded here rather than quietly folded into a tick
- ✅ **The registry honours the 2026-09-20 scrub by construction**, which matters because a port registry is exactly the file that would otherwise accumulate addresses: an explicit header rule that no addresses or hostnames appear, pointing at the private `gaiada-setups/access/` for real values. `yourtal-6c` also declined to record which client accounts or sites hold the two `0.0.0.0` binds, on the grounds that *"this named client's backend listens on all interfaces"* is the same class of targeting information the scrub removed — **a judgement worth keeping as precedent**
- ✅ **The artefact records its own expiry and the ticket did not.** `PORTS.md:100` states *"2026-09-21: `26300` and `26432` are both listening. The claim expired."* — while this ticket's own *"no 26xxx port is in use on the box"* claim went stale silently. **The file is better than the ticket, because it was written to be re-read.** And the reason the claim expired is the good part: those ports are listening **because YourTal itself deployed**. The ticket offered a free range as evidence the port scheme would transfer; the scheme transferring is what consumed the range
- ✅ **Independent corroboration of the cgroup correction, and it reverses a finding.** `PORTS.md:63-64` records the app running under `uyourtal`, matching `/proc/<pid>/cgroup` and contradicting the `nologin` service user these tickets describe. **The caps ARE in force** — `0::/yourtal.slice/pm2-uyourtal.service`, with the Postgres container a direct child of the same slice. *"Wrong user"* and *"no isolation"* are very different findings, only the first is true, and `yourtal-6c` nearly filed the second
- ✏️ **The `helios-w` discrepancy is struck — this ticket was right.** It was reported absent from `~/.ssh/config`; the reporting session's `sed` range stopped at line 175 and the entry is at 281. **A truncated read reported as an absence**, withdrawn by the session that made it
- ⚠️ **`yourtal-mem-proof.service` is in `failed` state on production** — a leftover from YT-0530's memory-cap experiment, never cleaned up. Small, and it is a failed unit sitting on the box YourTal now ships to

### YT-0530 · Helios: isolation and resource caps
`doing` · P0 · infra · 2d · dep: YT-0529

**Built and proved 2026-09-20.** A dedicated unprivileged system user (`yourtal`, uid 994, `/usr/sbin/nologin`, home `/opt/yourtal` at 0750 with `secrets/` at 0700) and a systemd slice, `/etc/systemd/system/yourtal.slice`, that every YourTal unit joins.

Caps sized against **measured** headroom (22 GB free, load ~1.0) and deliberately leaving the majority to the 30 client sites: `CPUQuota=200%` (2 of 8 cores), `MemoryHigh=3G`, `MemoryMax=4G`, `MemorySwapMax=0`, `TasksMax=512`, `IOWeight=50`.

- [x] **CPU cap proved by a runaway, not by reading the unit file.** Eight busy loops launched into the slice on an 8-core box were throttled to **2.02 cores** against a 2.00 cap. Host load stayed at 1.82 and the client sites were unaffected
- [ ] ⚠️ **Memory cap only PARTIALLY proved, and the distinction matters.** A deliberate 6 GiB allocation inside the 4 GiB slice hit the runtime limit at a **3.1 G peak against `MemoryHigh=3G`** — so the *soft* limit demonstrably throttled reclaim, and the host finished healthy (22.8 GB free, nginx/docker/postgres all active). **It never reached `MemoryMax`, so the hard OOM-kill-inside-the-slice is still unproven.** Re-run with a faster allocator and no runtime limit
- [ ] ⚠️ **A first attempt at that proof was mis-read and nearly recorded as a pass**: sampled at 25 s, the unit reported `Result=success`, `ExecMainStatus=0` — which is what a **still-running** unit reports. `systemd-run --wait` gives the true result. A status field read at the wrong moment is indistinguishable from the answer you wanted

- [ ] Dedicated system user, systemd slice with **hard CPU and memory caps**
- [ ] A YourTal runaway degrades YourTal and nothing else — **proved by running one**, not by reading the unit file
- [ ] CloudPanel's nginx is touched only through one dedicated vhost; no edits to shared config

### YT-0531 · Helios: Postgres with a restore that has actually been run
`todo` · P0 · infra · 3d · dep: YT-0530

- [ ] Nightly base backup plus WAL archiving to **off-host** storage — a backup on the same disk is not a backup
- [ ] **A restore into a scratch database is performed and the ledger invariant checker passes against it.** Not "PITR enabled"
- [ ] Restore time measured and written down, because that number is the real RPO conversation

### YT-0532 · Helios: deploy pipeline with rollback
`doing` · P0 · infra · 4d · dep: YT-0530, YT-0028

**Decided 2026-09-20 (S-1): the existing pull-based poller, not push-from-CI. They are not alternatives — CI proves and publishes the artifact, the poller pulls and installs it.**

The poller `gaiada-poll` already runs on Helios, is **green** (`Result=success`, `NRestarts=0`, active since 2026-09-13) and states its own case: _"No inbound port, no webhook, no DNS, no nginx. Outbound HTTPS only."_ It polls for `deploy/<env>-` releases with conditional ETag requests, and its discovery loop **auto-enrols any repo whose `.gaiadeploy.yml` names this server** — org `gaiadabali`, which is now where YourTal lives. So joining needs a file in the repo and **no server-side change**.

**Why push-from-CI is the wrong shape here, specifically:**

| | |
| --- | --- |
| **The allowlist is the control** | Helios permits SSH **per source IP**, and that is what protects 30 live client sites. GitHub Actions runners egress from thousands of rotating addresses. Push-deploy means opening 22 broadly or maintaining an impossible list — **discarding the control to automate the thing it protects** |
| **Inbound is the fragile direction** | Proved the same day: from a new home address, direct SSH to Helios **and** Delphi both timed out, while outbound was untouched. A deploy that needs inbound reachability fails exactly when an operator IP rotates |
| **Credential blast radius** | Push-deploy puts a key in GitHub that can SSH to a box holding 30 clients. The poller needs only **outbound read** access |
| **It is the house pattern** | `gaiada-deploy` already does releases + symlink swap + **rollback**, and reloads Node apps with `pm2 reload --update-env` under a per-site user |

- [x] **LIVE 2026-09-20: https://yourtal.gaiada.com** — `/`, `/au` and `/id` all 200 over HTTPS with a valid certificate and CSS served. The full loop runs: push to `production` → CI gates and builds → publishes `deploy/production-*` with a checksum → poller detects within 60 s → verifies the sum → extracts → swaps the symlink → `pm2 reloaded: yourtal-web` → `health check OK (200)` → `DEPLOY OK`. **No inbound port, no key in GitHub, no allowlist touched**
- [x] **Rollback proved by a real failure, not a drill.** A health check failed, `gaiada-deploy` reverted to the previous release, and **the app kept serving 200 throughout**
- [x] ⚠️ **The health check must target the port, not the domain.** `gaiada-deploy` uses `http://127.0.0.1:$PORT/` when `port` is set and falls back to `https://$DOMAIN/` when it is not. Setting `domain` alone made it probe a name with no DNS and no certificate, so it got `000` six times and **rolled back a release that was serving correctly the whole time**. A health check aimed at a public URL makes the pipeline depend on DNS, TLS and nginx to report on a process it can already reach — it calls a routing problem a bad release
- [x] ⚠️ **A manifest change takes up to 15 minutes; a code change takes 60 seconds.** The poller re-reads `.gaiadeploy.yml` only on the discovery sweep, so the `port` fix sat inert while two further deploys failed against the cached copy. **Changing deploy config and changing code are not the same latency**, and nothing says so
- [ ] ⚠️ **Bug in shared tooling, not ours: `gaiada-deploy`'s rollback path loses `PM2_NAME`.** Forward deploys reload `yourtal-web` correctly; every rollback then reports `no pm2 process found for: uyourtal` — the site *user*, not the configured name. **So a rollback swaps the symlink and cannot restart the process**, leaving pm2 on the new code while `current` points at the old release. Harmless here only because both releases were the same commit. **This affects every Node site on the box**, so it belongs upstream in `deploy-workflows` rather than here
- [ ] `.gaiadeploy.yml` in this repo naming **server-c**, so the discovery loop enrols it with no server-side edit
- [ ] CI publishes a `deploy/<env>-` release **only from a green run** — the poller installs whatever it is given, so the gate has to be upstream of it
- [ ] Rollback **exercised, not assumed**: deploy, roll back, confirm the previous release serves. Per `docs/13c`, a rollback path first used during an incident has not been tested
- [ ] ⚠️ **The poller must page when it has NOT run**, per YT-0566. This exact timer was failing every 60 s for an unrelated repo in August and nobody noticed — **a job that stops running emits no errors at all**, and a deploy pipeline that has silently stopped looks identical to one with nothing to deploy
- [ ] ⚠️ The `yourtal` system user is `/usr/sbin/nologin`; confirm `pm2` works under it or give the deploy its own site user. Decide before the first deploy, not during it
- [ ] Secrets come from `/opt/yourtal/secrets/app.env` (0600), never from the release artifact

- [ ] Build once in CI, publish a checksummed artifact, host verifies before it deploys
- [ ] Health check after deploy; **failure rolls back automatically** and the rollback path is exercised in CI, not just written
- [ ] Node version in the build matches the Node version on the host — a standalone bundle shipping native modules (`pg`, `sharp`) built on the wrong major fails at runtime, not at build
- ⛔ **STATUS CHANGED BY FOUNDER DECISION S-4, 2026-09-22: the rollback defect is a BLOCKER ON THE NEXT DEPLOY, no longer an accepted standing risk.** It was knowingly shipped on 2026-09-21 with the numbers put in front of the founder beforehand — that acceptance is now withdrawn, and the reverse path is fixed before anything else goes out
- ℹ️ **The failure, first-hand from `yourtal-0c`**: `gaiada-deploy` loses `PM2_NAME` on rollback, reports `no pm2 process found for: uyourtal`, swaps the symlink and then **cannot restart** — leaving pm2 running new code while `current` points at old, **across every Node site on that box**. The blast radius is the reason this one stopped being acceptable: it is shared tooling, and the damage is not confined to YourTal

### YT-0533 · Secrets and keys without a KMS
`todo` · P0 · infra · 2d · dep: YT-0530

⚠️ **This ticket's premise is out of date: there is already a secrets manager on the box.** **Infisical is self-hosted and running** on Helios — `/opt/infisical-core`, v0.43.121, `infisical-runsvdir.service` active, config at `/etc/infisical/infisical.rb`. Found while surveying for YT-0529 on 2026-09-20.

That changes the task from _"design secret handling without a KMS"_ to _"decide whether to use the Infisical already here, and on whose terms"_ — a much smaller and much better-supported question. **It is not automatically the answer**: it is shared with the client sites and the NOW platform, so using it means YourTal's secrets live in the same system as another product's, which is the same blast-radius argument as risk 39 applied to credentials rather than CPU. Worth answering deliberately before either adopting or rebuilding.

- [ ] Separate keys for voucher codes, PII and signing — **the separation is the point**, and it survives the move to a real KMS
- [ ] Keys live outside the repo and outside the build artifact; rotation procedure written and run once
- [ ] Encrypt/decrypt sits behind one interface so YT-0026 becomes a driver swap, not a rewrite
- [ ] ⚠️ **Single-host key custody is weaker than a KMS and must not be carried into production.** Recorded in `docs/03` rather than left as a silence

### YT-0534 · Data residency: what Helios is allowed to hold
`doing` · P0 · legal · 1d · dep: —

**Evidence gathered 2026-09-20 from the box itself. Conclusion: Helios is in JAKARTA, INDONESIA — high confidence, one confirmation short of certain.**

| Signal | Reading |
| --- | --- |
| `ipinfo.io` on the IPv4 | **Jakarta, ID**, `AS47583 Hostinger International Limited`, postal 12850 |
| Reverse hostname | `<helios-vps-hostname>` — a Hostinger VPS |
| Latency to `itb.ac.id` (Bandung, ~120 km) | **14.4 ms** — consistent with Jakarta |
| Latency to `sydney.edu.au` | **169.7 ms** — definitively **not** Australia |
| Server timezone | `Etc/UTC` — deliberately neutral, tells us nothing |

⚠️ **Measurements deliberately discarded, and why this matters more than the ones kept.** `unimelb.edu.au` returned **0.96 ms** and `mit.edu` **0.77 ms** — physically impossible, so those names resolve to local CDN edges rather than the institutions. An earlier pass had `sydney.au.speedtest.net`, `google.co.id` and `google.de` all at ~14.7 ms, which is three continents at one latency and therefore anycast. **Had the first pass been accepted, it would have "proven" the box is simultaneously in Australia, Indonesia and Germany.** The IPv6 `2a02:4780:...` is a RIPE (European) allocation and `ipinfo` flags it `anycast: true` — a registry allocation is not a location, which is the trap this ticket was opened to avoid.

**The legal consequence, if Jakarta is confirmed:** Indonesian personal data is **onshore** and UU PDP's transfer rules do not bite. **Australian personal data would be offshore** — APP 8 cross-border disclosure, where the entity stays accountable for what the overseas recipient does. That is a compliance obligation rather than a prohibition, but **Australia is the primary market**, so it lands on the main path rather than a side one.

**What is still missing is confirmation, not evidence.** Geolocation databases are wrong often enough that a legal position should not rest on one. The authoritative source is the **Hostinger billing/VPS page**, which names the datacentre outright — a founder can read it in under a minute, and that closes this.

- [x] **Where Helios physically is** is established and written down — **accepted as Jakarta, Indonesia, by founder decision 2026-09-21, on the indirect evidence above, confidence Medium.** Recorded in `docs/24` § _Helios residency_ with the confidence stated, because *accepted on inference* and *confirmed* are different claims and only one of them is true here
- [x] A one-line rule in `docs/24`: Helios holds **simulated and internal data only** until residency is resolved — now **red line 11**, alongside the other ten absolute prohibitions rather than as a footnote, so it is enforced where the prohibitions are read
- [x] The architecture's country isolation (`docs/02`) is **not** quietly weakened to match the infrastructure — asserted explicitly in `docs/24`: the two-region design stands, and **Helios is a development box that does not satisfy it**, which is a fact about Helios rather than a reason to change the policy
- ✅ **The blocker is lifted: the founder accepted Jakarta on the available evidence rather than waiting for the billing page.** That is a defensible call for a development-stage box and it is recorded as *accepted*, not *confirmed*
- ⛔ **Accepting the location does not lift red line 11, and confirming it would not either.** For **APP 8** and for Indonesian residency obligations, what counts is a **contractual statement of where data is held** — a hosting agreement or an invoice. Geolocation is evidence about a route, not an undertaking by a provider, and no quantity of it becomes a commitment. **Worse: confirming Jakarta makes Australian personal data on Helios a cross-border disclosure requiring APP 8 treatment**, on the primary market's main path. Knowing costs more than not knowing, which is why the rule is written to survive the answer
- [ ] **A document naming the datacentre, plus the APP 8 position for Australian data** — the two things that would actually lift red line 11. Left open deliberately: this ticket's other criteria are met and this one is the real bar, so closing the ticket without it would retire the question rather than answer it

## The simulation seam

### YT-0535 · One driver interface per external boundary
`done` · P0 · platform · 3d · dep: YT-0031

**`packages/drivers`, 60 tests. `pnpm verify` 11/11, 1745 tests, lint 11/11.**

- [x] All eight boundaries have one interface and two implementations. `BOUNDARIES` in `boundary.ts` is the registry, and `registry.test.ts` asserts it agrees with what `createDrivers` wires — a boundary in code but not in the catalogue is one the parity suite (YT-0539) would never run against a vendor
- [x] `simulated` is the default with **no configuration at all**, asserted for every boundary. Opting *in* to simulation would mean a missing variable reaches for a vendor, and the first person to notice is whoever gets the bill
- [x] **Choosing `live` without its credential fails at boot, and never falls back** — a loop asserts this for all eight, not just payments. A typo (`Live`, `production`, `true`) is also a boot failure rather than a silent default: a typo that quietly means "simulated" is indistinguishable from choosing it. Every misconfigured boundary is reported at once, because fixing a deployment one restart at a time is a slow way to learn four variables are missing
- [x] **`live` refuses at construction, not per call.** A driver that returns "not implemented" from each call boots, serves traffic, and fails one request at a time — indistinguishable from a vendor outage, and found by a user rather than a deploy. The two failures stay separable: *"you did not set the key"* and *"there is no implementation yet"* have different fixes, and the error names the ticket that will build it
- [x] `eslint-rules/no-vendor-sdk.mjs`, applied repo-wide. **Verified it fires** — a `stripe` import in `packages/contracts` errors, the same import inside an adapter does not. Adapters are allowlisted inside the rule (`packages/drivers`, `packages/media`), next to the reasoning
- [x] The money unit is a **declared property of the payments driver**, not inherited from storage. YT-0506 settled what we store, not what a processor accepts, so `declaredMinorUnitExponent` is what YT-0537's parity test compares against

- ✅ **Verified 2026-09-21 by `yourtal-22`, which did not write this ticket.** `BOUNDARY_NAMES` (`boundary.ts:29-38`) holds exactly **eight** — `payments`, `disbursement`, `bot_check`, `otp`, `messaging`, `digital_goods`, `receipt_ingest`, `moderation` — and the `BOUNDARIES` record defines all eight, no more and no fewer. The catalogue-versus-wiring check the criterion describes is real: `registry.test.ts:19` asserts `Object.values(DRIVER_KEY_TO_BOUNDARY).sort()` equals `[...BOUNDARY_NAMES].sort()`, so a boundary in code but not in the catalogue fails. `eslint-rules/no-vendor-sdk.mjs` exists and is referenced three times from `eslint.config.mjs`
- ✏️ **A note on the verification, not the ticket.** My first count of the registry returned **5**, because the pattern I matched keys with excluded underscores and silently dropped `bot_check`, `digital_goods` and `receipt_ingest`. A verifier reporting "5 of 8 boundaries defined" would have sent a correct ticket back. Fifth instance today of the instrument narrowing the question — see `_schema.md` and the `grep -c $'\r'` case on YT-0568
### YT-0536 · Simulators that can fail
`done` · P0 · platform · 3d · dep: YT-0535

- [x] All five faults, driveable on every boundary through one shared `FaultEngine` — so "what a timeout looks like" has one answer across payments, OTP and messaging rather than eight
- [x] `FAULT_CATALOGUE` names each one with **the caller bug it catches**, not just an error code. A fault nobody can state the purpose of is one that gets deleted the first time it is inconvenient
- [x] **The per-boundary coverage is itself asserted.** The exercise table is checked against `BOUNDARY_NAMES` in both directions, so a new boundary fails the suite until somebody writes its failing case, and an orphaned exercise cannot keep passing while testing nothing. Satisfying the criterion with eight tests and a promise to remember is the shape risk 37 keeps taking
- [x] **Deterministic throughout** — no randomness, no wall-clock sleeps, and deterministic idempotency keys even in the retry test. A simulator that fails at random makes a flaky test, a flaky test gets retried until it passes, and a real failure then hides inside the retry
- [x] `mayHaveSucceeded` is on the failure type, and `true` for timeouts. That is the whole reason the field exists: a caller retrying an uncertain operation without an idempotency key double-charges, so the uncertainty has to be something a caller must look at
- [x] Webhook faults act on **delivery, not the call** — the request succeeds and the events arrive twice, or reversed. A caller that only tests the request path never sees either, which is exactly how they reach production
- [x] ⚠️ **Faults cannot be switched on by environment**, only passed in by a test. A fault configurable from the outside is one that can reach a running deployment
- ✅ **Verified 2026-09-21 by `yourtal-ca`, which wrote none of this work.** `packages/drivers` is **6 files / 88 tests green**, with one shared `FaultEngine` across every boundary — so *"what a timeout looks like"* genuinely has one answer rather than one per adapter
- ✅ **`mayHaveSucceeded` is exactly right where it matters**, which is the field this design exists for: `fault-engine.ts:103` `decline → false` (*"the call completed and the answer was no"*), `:110` `timeout → true` (*"no response; the operation may have completed on the far side"*). Getting that backwards is how a retry double-charges
- ✅ **The coverage assertion is real set equality, not a loop that can drift**: `driver-mode.test.ts:106` — `expect(Object.keys(modes).sort()).toStrictEqual([...BOUNDARY_NAMES].sort())`. A new boundary fails the suite **and** an orphaned exercise cannot keep passing
- ✅ **Determinism holds structurally rather than by discipline**: zero `Math.random`, `setTimeout` or `sleep(` in `packages/drivers/src` outside tests, and **no `process.env` read anywhere near fault selection** — so faults are passed in by a test or they do not exist, and cannot be switched on by environment
### YT-0537 · Payment and disbursement simulator
`done` · P0 · platform · 3d · dep: YT-0535, YT-0536

**88 tests in `packages/drivers` (was 60). Typecheck, lint and prettier clean.**

- [x] Xendit-shaped and unit-agnostic. `declaredMinorUnitExponent` is on the driver; `provider-amount.ts` converts between what we store and what a processor speaks. Payload uses `external_id` / `amount` / `currency`
- [x] **The parity property is value preservation, not exponent equality.** Asserting the driver's exponent equals `MINOR_UNIT`'s would have *forbidden* the case this design exists for — a processor legitimately wanting whole Rupiah. What must hold is that Rp 45.000 arrives as Rp 45.000 whether it travels as 4_500_000 sen or 45_000 Rupiah, and that catches a 100× error in either direction
- [x] **Neither side derives from the other.** `MINOR_UNIT` says what we store, the driver says what it speaks. A driver reading its exponent from `MINOR_UNIT` would make the test compare a value to itself — exactly what `openapi:go:check` was doing when it compared the generator's output to the generator's output, which is why nobody noticed the Go module had never compiled
- [x] **A mis-declared driver is constructed and caught.** `convertAmounts: false` builds a driver that *claims* Rupiah and *sends* sen — the 100× bug in its natural habitat, where nothing throws and every type checks. Without building the wrong case the suite could only prove the right one, which says nothing about whether it would catch anything
- [x] **Conversion can refuse.** Rp 45.000,50 has no whole-Rupiah representation; rounding would discard 50 sen per transaction, invisible per item and material per million. The driver declines rather than deciding for the caller
- [x] Disbursement converts identically. The direction is what makes it worse: a charge in the wrong unit overcharges a user who complains, a payout in the wrong unit overpays a merchant who has no reason to mention it
- [x] **Webhook signature verification is real HMAC-SHA256** over `timestamp.body`, constant-time compared, with a two-sided freshness window. Every rejection path is exercised — tampered body, wrong secret, missing signature, missing timestamp, malformed timestamp, stale, future, wrong-length signature
- [x] ⚠️ **Deliberately stronger than Xendit's own scheme.** Xendit sends a static `x-callback-token`: no expiry, no binding to the body, permanent on a single leak. The simulator implements the Stripe-style scheme so handlers are written against a real signature check rather than a string equality; a live driver implements whatever the vendor requires behind the same interface
- [x] **Replay is a separate defence from the signature, and the test proves it.** Under the `duplicate_webhook` fault both copies verify — they are genuinely from the provider — and the inbox admits each event id once. A signature cannot help here, which is the whole point of having both
- [x] Idempotency: a replayed key returns the original charge and the provider is charged once

- ✅ **Verified 2026-09-21 by `yourtal-22`, which did not write this ticket.** `packages/drivers/src/boundaries/provider-amount.ts` exists and `declaredMinorUnitExponent` is a property of the driver (`disbursement.ts:47,53,69`), defaulting IDR to 2 **per driver** rather than reading `MINOR_UNIT` — which is the criterion's load-bearing claim that *neither side derives from the other*. A test comparing a value to itself is precisely the failure this design avoids, and it is avoided structurally rather than by care
- ✅ **The webhook scheme is what the ticket says it is, read rather than assumed.** `boundaries/webhook-signature.ts` imports `createHmac` and `timingSafeEqual` from `node:crypto` (`:1`), signs with `createHmac("sha256", secret)` (`:77`), and its comment at `:39` states why constant-time comparison rather than `===` — *"string comparison short-circuits"*. That is real HMAC-SHA256 with a constant-time compare, not a stub shaped like one
### YT-0538 · Bot-check, OTP and messaging simulators
`todo` · P0 · platform · 2d · dep: YT-0535

- [ ] Bot check returns pass, fail and expired-token; the **verify step is real code** even when the token is simulated
- [ ] OTP simulator issues and burns single-use codes with a real TTL and real velocity limits
- [ ] Codes are retrievable in development through a deliberate, logged, development-only route — never printed into ordinary logs

### YT-0539 · Boundary parity suite
`todo` · P0 · platform · 2d · dep: YT-0537

- [ ] **One suite runs against both drivers**; the simulator's contract is defined by the suite, not by its own source
- [ ] Runs against `simulated` on every CI run and against `live` only when a credential is present
- [ ] A vendor behaviour we learn later becomes **a new case in this suite first**, then a code change

## Auth

### YT-0540 · Email and password authentication
`done` · P0 · platform · 4d · dep: YT-0516

- **Schema decided 2026-09-19 (coordination session) so this is no longer blocked.** Four tables in an `identity` schema, and the shape is dictated by rules this codebase already follows:
  - `identity.credential` — `(user_id, kind, secret_hash, updated_at)`, **one row per credential kind**, not a password column on the user. This *is* the seam in YT-0541: adding phone-OTP or an OIDC subject later is a new row, not a migration of the user table.
  - `identity.session` — opaque CSPRNG id **stored hashed**, plus `user_id, created_at, last_seen_at, absolute_expires_at, revoked_at`. Hashed at rest for the same reason voucher codes are: a database read must not yield a usable credential.
  - `identity.verification_token` — password reset and email verification share one table with a `purpose`, `consumed_at` and an expiry. **Single-use is enforced by `consumed_at`, not by deletion**, so a replay is distinguishable from a token that never existed.
  - **No `is_expired`, no `failed_attempt_count`, no `is_locked` column anywhere.** Expiry derives from `absolute_expires_at`; lockout derives from the counters. Storing either is the derived-value bug in `docs/13`, and under concurrency the stored copy is the one that will be wrong.
- **Throttling counters live in Valkey, not Postgres** — high-write, ephemeral, and they must be shared across processes. This is the same mistake as the per-process idempotency store: a counter each instance keeps privately is not a counter, and two API processes behind one proxy would each grant the full allowance.
- Throttle **the account and the source separately**. One counter protects a user from a targeted attack; the other protects every user from a broad one. A single combined counter does neither job well.
- [x] Argon2id, server-side sessions, rotation on privilege change, absolute and idle expiry
- [x] Login, logout, password change, password reset, email verification — reset and verification tokens are **single-use and time-boxed**
- [x] Lockout and throttling on the account **and** on the source, with the counters in shared storage rather than per-process
- [x] Authorization still runs through Cerbos; this task issues a principal, it does not decide anything

**BUILT AND PROVED BY BREAKING IT, 2026-09-21 — and held at `doing` by one schema decision that needs the founder, not an engineer.** Migration `20260921180000_auth_credential_session_verification_token.sql` applied (26/26 executed); `apps/api` **41 files / 240 tests**; policy suite **452/452**, up from 407 by exactly the 45 new `session` assertions; `packages/authz` 37/37; `packages/contracts` 559/559; `packages/db` 78/78.

- **All four criteria are met on their own terms, each proved by breaking it rather than asserted.** Argon2id hashes read out of the row; a session's stored id is the SHA-256 and the raw token **does not appear in the row at all**; a tampered token is refused as `not_found` rather than as a mismatch; an expired-but-never-revoked session is refused; `changePassword` revokes **every other** session including its own caller's and issues a fresh one
- **Lockout proved the way a lockout has to be proved:** five failures, then the **correct** password on the sixth still returns `throttled` — *a lockout that only blocks wrong passwords is not a lockout.* Account and source counters are independent, read directly out of Valkey: a success clears the account key while the source key keeps its recorded failures
- **Single-use proved past the boundary.** A consumed token, a replay and a pure forgery all collapse to one `token_invalid` at the service edge — but the repository's own result distinguishes `already_consumed` from `not_found` from `expired`, and the test asserts those are **not** the same value **before** the boundary throws the distinction away. The replay presents the identical raw token, captured from the dev log rather than fabricated

**✅ THE BLOCKER IS RESOLVED — founder decision, and `user_id` is now an opaque UUID. The original text is kept below because the reasoning is the reusable part.** Superseded, not deleted.

- The agent flagged this itself as the one place it filled a gap the four-table spec left open, and asked for a second pair of eyes. **It was right to ask, and the answer is no.** Its reasoning was sound as far as it went — there is no `identity.user` and no email column anywhere, `user_id` is free text everywhere else, and email is the one namespace unique without a lookup table. Syntactically it is a consistent application of the existing convention
- **What it changes is not the syntax but the contents.** `user_id` / `owner_id` is the join key into stores whose grants deliberately forbid removal:
  - `ledger.account`, `ledger.transfer`, `ledger.entry` — `GRANT SELECT, INSERT` only, **and sealed daily by YT-0044's write-once Merkle root**
  - `ledger.grant` — `GRANT SELECT, INSERT` only
  - `watch.coverage` — `GRANT SELECT, INSERT` only, append-only evidence a reward is paid against (YT-0120)
- ⛔ **So the address becomes unerasable, and that collides with this epic's own work.** YT-0528 is the remaining seven DSAR handlers and YT-0036 is the consent service; an erasure request cannot be honoured against a store with no DELETE grant and a published Merkle root over its contents. **This is not a hypothetical conflict — the erasure obligation is a ticket in the same epic as the decision that would break it**
- ⛔ **And it fails on a mundane fact before any legal one: people change their email address.** The key cannot be updated either, because the same grants forbid UPDATE. A change would orphan a user's ledger history or require rewriting an append-only store, which is impossible by construction rather than merely hard
- **The recommendation, for the founder rather than for an engineer:** `user_id` stays an **opaque** identifier — a UUID minted at registration — and the email lives in `identity.credential`, which is a mutable, erasable table. That preserves the ticket's own stated reason for having no `identity.user` (one row per credential kind, adding OIDC later is a row not a migration) while keeping PII out of every sealed store. **The cost is one indirection at login; the cost of the alternative is an unerasable address in a cryptographically sealed ledger**
- ⏭️ **Nothing is reverted pending that decision.** The auth module works and is proved; only the identifier's *content* is in question, and it is cheap to change now and expensive after the first real registration. Whoever changes it should also re-read `docs/24`'s positions on UU PDP and the Privacy Act, since erasure is the specific obligation at stake

**Three real gaps the work surfaced rather than worked around, all recorded by the agent rather than smoothed over:**

- **Nothing persists “this email is verified.”** No column on any of the four tables, no `isEmailVerified` on the principal. `confirmEmailVerification` proves inbox control at a moment in time, auditable via `consumed_at`, and nothing more. Needs a home before it is claimed as a feature
- **`admin` cannot log in, log out or change its own password** under `session.yaml`, because the `platform_setting` structural boundary forbids `admin` appearing in any other policy file. Surfaced in the policy's own header rather than quietly excepted
- ⚠️ **Cerbos still authorises these routes off the interim `x-yt-*` header principal, not off the bearer token.** Two independently-real checks answering different questions: the guard needs a dev-only header to pass, and `AuthService` needs a valid session token to know whose credential it is touching. **They are not yet the same mechanism** — that unification is the future change to `PrincipalService.resolve()`'s body this ticket deliberately did not make, and `PrincipalService` is untouched with no member added, so the duck-typed fakes in other sessions' files still compile
- ⚠️ **`.github/workflows/integration.yml` has no Valkey service and needs one** — `valkey/valkey:8-alpine`, `26379:6379`, healthcheck `valkey-cli ping`, matching compose. Without it `auth.service.test.ts` fails in CI while passing locally, which would read as “this change broke the build”. That file is another session's; **not touched, reported instead**
- **`register` was added beyond the ticket's five flows**, on the grounds that `login` means nothing without it and YT-0033's own re-parenting note assumes accounts exist by the time OTP arrives. Reasonable, and recorded because it is scope the ticket did not ask for

**→ `review` 2026-09-21. `user_id` is an opaque UUID; email lives only in `identity.credential.identifier`.** All four criteria met. `review` rather than `done` because this session did the work.

- **Verified independently against the live database, not from the report.** `identity.credential` columns are `user_id, kind, identifier, secret_hash, updated_at`, carrying **both** `credential_pkey PRIMARY KEY (user_id, kind)` and `credential_kind_identifier_key UNIQUE (kind, identifier)`
- **The uniqueness fires, proved by my own insert rather than through the app:** two rows with the same `(kind, identifier)` → `ERROR: duplicate key value violates unique constraint "credential_kind_identifier_key"`. So *“this email is already registered”* remains a **constraint violation rather than a query**, which was the property worth preserving from the original design
- **Email cannot appear in the other two tables — structurally, not by convention.** `identity.session` is `id, user_id, created_at, last_seen_at, absolute_expires_at, revoked_at` and `identity.verification_token` is `id, user_id, purpose, expires_at, consumed_at, created_at`. **Neither has a column that could hold one**, which is a stronger guarantee than a test
- **YT-0541's seam is intact**: a second credential kind is still a new row, not a migration — `identifier` holds the email for `kind = 'password'` and would hold an OIDC subject or phone number for the next kind. The decision cost exactly **one indirection at login** (`findByKindAndIdentifier` → `user_id` → verify), which was the predicted price
- **Atlas reconciled on the documented path with no force.** The three auth tables were confirmed empty and free of FK dependents, dropped, the revision row removed, the migration edited, `atlas.mjs hash` regenerated `atlas.sum` (**never hand-edited**), then reapplied: `Migration Status: OK, Current Version: 20260921180000, Executed Files: 26, Pending Files: 0`. **`identity.principal_security_state` was not touched**, confirmed before and after
- **The migration now records why**, including the argument that is only visible from the grants: the original header planned *“the migration that adds a canonical identity table owns backfilling `user_id` away from email”* — **and backfilling is an UPDATE, which `ledger.*` and `watch.coverage` forbid just as they forbid DELETE.** A planned remedy that could never have run
- **`user_id` stays SQL type `text` rather than native `uuid`**, matching the existing convention on `business.business_members` and others. The decision was about the **value** being opaque, not about a column type, and there is still no canonical identity table to justify a stronger one. Recorded as a deliberate minimal-scope choice
- **One leftover removed on its own merits:** the reset-delivery log line used to hash the identifier, because the identifier *was* the email. It logs `userId` directly now — hashing an opaque UUID hides nothing and suggests it is sensitive when it is not
- **Live evidence rather than inference:** a real run printed `password_reset token for 5eddc991-…: <token>` — a UUID, confirming the opaque value flows through in execution and not merely in the type signature
- **Re-proved after the key changed, since every property hung on it:** raw session token absent from the stored row, tampered token refused, expired session refused, `changePassword` revoking every other session, lockout still returning `throttled` on the **correct** password after five failures, account and source counters independent. `apps/api` **41 files / 240 tests**; `packages/db` **81** from a **fresh per-package database that applied the edited migration from scratch** — the strongest evidence the migration is sound; `packages/contracts` **559/559** including the schema-drift gate, so the Drizzle table matches the applied schema down to the constraint name; policy suite **452/452**
- ✅ **Verified 2026-09-21 by `yourtal-ca`, which wrote none of this work, against the RUNNING database rather than the migration file.** `information_schema.columns` for schema `identity` returns exactly `credential(user_id, kind, identifier, secret_hash, updated_at)`, `session(id, user_id, created_at, last_seen_at, absolute_expires_at, revoked_at)`, `verification_token(id, user_id, purpose, expires_at, consumed_at, created_at)` and `principal_security_state`
- ✅ **The NEGATIVE check is the one worth having and it passes.** Querying `identity` for any column named `is_expired`, `failed_attempt_count`, `is_locked`, `password`, `password_hash` or `email` returns **zero rows** — no derived state stored, and **no email anywhere in the session or token tables**, which is the whole point of moving `user_id` to an opaque UUID
- ✅ **Single-use is atomic, not check-then-set**: `drizzle-verification-token.repository.ts:36-41` is `UPDATE … SET consumedAt = now WHERE … consumedAt IS NULL`, so **a replay loses the race** rather than being detected after it. `:66` distinguishes *consumed* from *never existed*, which is what this ticket's "not by deletion" argument was for
- ✅ **Throttling has two scopes that are never combined** — `"account"` and `"source"` under separate keys, with `reset` deliberately never called for `"source"`, **so a legitimate success cannot clear a broad attack's counter**. The account key is `sha256(identifier)` with the reason written down: an operator listing throttle keys should not get a mailing list for free
- ✅ Argon2id via `@node-rs/argon2`; session ids hashed at rest (`opaque-token.ts:39` returns `sha256(token)` and the mint function hands back `{token, hash}`), **so a database read yields no usable credential**. A password reset rotates every session and issues a fresh one (`auth.service.ts:232-233`), on the stated ground that a reset is exactly as privilege-relevant as a change
- ℹ️ The 45 new `session` assertions are part of the **452/452** run under YT-0035, so that figure is now confirmed independently from two directions
### YT-0541 · Identity provider seam
`todo` · P0 · platform · 2d · dep: YT-0540

- [ ] Routes depend on a **verified principal**, never on how it was verified
- [ ] Zitadel stays in the local stack and is **not** on the critical path; adding OIDC or phone-OTP later is a driver, not a migration
- [ ] One test proves a second provider can be added without touching a route handler

### YT-0542 · Record what deferring phone verification costs
`todo` · P0 · risk · 1h · dep: YT-0540

- [ ] The fraud model in `docs/18` §5 rests on a **phone-OTP identity anchor**; email and password alone make a fake account nearly free
- [ ] Recorded as a numbered risk in `docs/03` with the trigger that forces it back in: **the first real points issued to a real person**
- [ ] Velocity caps and trust tiers are built against the anchor's **interface** now, so restoring it is configuration rather than redesign

### YT-0578 · Rewrite history before this repository is ever public again
`todo` · P0 · infra · 1d · dep: —

- ⛔ **Blocked on a founder decision, and it is a decision rather than a task.** The repository was **public for a few hours on 2026-09-20**, during which `origin/main` served Helios's IP and VPS hostname, its OS version, the jump hosts, and the office IP that `ufw` allowlists for SSH. It is private again, which closed it
- ⚠️ **The scrub commit does not help.** Two earlier commits carry the values, so removing them from the tip hides them from the tip and from nobody else. **The next flip to public re-exposes everything instantly** — which is the trap: the danger is not the current state but a future, reasonable-looking decision
- ⚠️ Forks were **0** at the moment it went private and the repo was hours old, so realistic exposure is small. **Not provably zero**, and it should not be recorded as zero
- [x] **DECIDED 2026-09-20 by the founder: rewrite.** Not accept-as-known. Relayed via `yourtal-24`, who will run it. Unblocked
- ⛔ **`origin/production` carries the SAME exposed values — rewriting `main` alone leaves a second world-readable copy fully intact.** Verified: `git grep` over `origin/production` finds them in `TASKS.md` and `docs/tasks/phase-0-helios.md`. **This is the single easiest way for this whole exercise to accomplish nothing**, and it is not in the plan as written
- [ ] **Every ref, not just `main`.** `origin` carries `main` and `production`; there are **3 remote `deploy/*` tags** and 5 local `worktree-agent-*` branches. A rewrite that misses one ref leaves the history reachable from that ref
- [ ] ⚠️ **Acceptance evidence is a FULL-HISTORY scan, and the criterion that used to sit here was not sufficient.** It said _"verify against `origin`, not HEAD"_ — necessary, and not enough: `git grep <pattern> <ref>` greps **the tree at that ref** and says nothing about history, which is the only thing this ticket is about. `yourtal-24`'s loop reported **"clean across 5 refs"** and **would have reported the same before the rewrite ran**, because `main`'s tip was already scrubbed
- [ ] The evidence is `git grep <patterns> $(git rev-list --all)` against a **fresh clone of origin**, returning zero — **and the same scan shown returning NON-ZERO on the pre-rewrite state**, so the check is proved capable of failing. Measured on the mirror: **99 commits carried an identifier before, 0 after**, with 46 now carrying placeholders. The tip-scoped check reported 0 in both cases
- ⚠️ **The second half is the part that was skipped, and it is the half that matters.** A check that cannot fail is not evidence. `yourtal-24` caught it only because the tree diff between old and new `main` came back empty and they asked why instead of accepting it
- [ ] **Quiesce first.** `yourtal-22` holds three worktrees, two locked and live; 12 unpushed commits here and 2 there all get new SHAs. Their YT-0577 fix is not to be traded for this
- [ ] **Sweep dangling SHA citations afterwards.** Board prose currently cites `f74897d`, `353b267`, `86df050`, `e485b75` and the deployed release tag — all become dangling references. Content survives; the citations do not
- ⚠️ **The push freeze is the founder's, not mine.** A rewrite without a force-push accomplishes nothing, since the exposure lives on `origin` — so the decision to rewrite implies the push. **I am not inferring that**; it goes to the founder explicitly, because a force-push of 97 of 104 commits across two branches is not the same action as lifting a pause on ordinary pushes
- [ ] If rewriting: the office IP, home IPs, fleet addresses, the WireGuard hub and the VPS hostname all go, not only the two files the scrub touched
- [ ] Either way, a **check that fails when an infrastructure address appears in a tracked file**, so this cannot recur by someone writing a runbook in the wrong repository
- [ ] ⏭️ The durable fix already exists and is not this ticket: identifiers live in `gaiada-setups/access/` (private) and appear here as `<placeholders>`
