# Phase 0 · Helios deployment target and the simulation seam

**Decision, 2026-09-19:** the deployment target is **Helios** (`server-c`, `<helios-ip>`, Ubuntu 24.04, CloudPanel + nginx, 8 vCPU / 31 GB), the existing production box in the sister-company fleet. **All third-party connections are held** until later; every external boundary runs a simulator instead. Auth is ordinary email + password.

This supersedes the GCP/Cloudflare shape in [`phase-0-foundation.md`](phase-0-foundation.md) (YT-0020, 0021, 0022, 0024, 0025, 0026), which is **deferred, not deleted** — a two-region managed deployment is still the right answer for production, and those tasks describe it.

**What this buys:** deployment stops waiting on the founder opening cloud accounts. **What it costs:** one box, one country, no HA, no managed PITR, and no HSM — each of which is a task below rather than an assumption.

---

## The target

### YT-0529 · Helios: environment layout and what shares the box
`todo` · P0 · infra · 2d · dep: —

- [ ] `staging` and `production` are **separate Postgres databases and separate system users** on one host — not one database with a flag
- [ ] YourTal cannot read, write or restart anything belonging to the client sites already on Helios
- [ ] The existing `gaiada-poll.timer` is **green before we add to it** — it was failing every 60 s for an unrelated repo as of 2026-08-18, and adding a site to a red timer hides our own failures in the noise
- [ ] Every port we take is recorded in one file; nothing binds `0.0.0.0` that does not have to

### YT-0530 · Helios: isolation and resource caps
`todo` · P0 · infra · 2d · dep: YT-0529

- [ ] Dedicated system user, systemd slice with **hard CPU and memory caps**
- [ ] A YourTal runaway degrades YourTal and nothing else — **proved by running one**, not by reading the unit file
- [ ] CloudPanel's nginx is touched only through one dedicated vhost; no edits to shared config

### YT-0531 · Helios: Postgres with a restore that has actually been run
`todo` · P0 · infra · 3d · dep: YT-0530

- [ ] Nightly base backup plus WAL archiving to **off-host** storage — a backup on the same disk is not a backup
- [ ] **A restore into a scratch database is performed and the ledger invariant checker passes against it.** Not "PITR enabled"
- [ ] Restore time measured and written down, because that number is the real RPO conversation

### YT-0532 · Helios: deploy pipeline with rollback
`todo` · P0 · infra · 4d · dep: YT-0530, YT-0028

- [ ] Build once in CI, publish a checksummed artifact, host verifies before it deploys
- [ ] Health check after deploy; **failure rolls back automatically** and the rollback path is exercised in CI, not just written
- [ ] Node version in the build matches the Node version on the host — a standalone bundle shipping native modules (`pg`, `sharp`) built on the wrong major fails at runtime, not at build

### YT-0533 · Secrets and keys without a KMS
`todo` · P0 · infra · 2d · dep: YT-0530

- [ ] Separate keys for voucher codes, PII and signing — **the separation is the point**, and it survives the move to a real KMS
- [ ] Keys live outside the repo and outside the build artifact; rotation procedure written and run once
- [ ] Encrypt/decrypt sits behind one interface so YT-0026 becomes a driver swap, not a rewrite
- [ ] ⚠️ **Single-host key custody is weaker than a KMS and must not be carried into production.** Recorded in `docs/03` rather than left as a silence

### YT-0534 · Data residency: what Helios is allowed to hold
`blocked` · P0 · legal · 1d · dep: —

- [ ] **Where Helios physically is** is established and written down — this is a fact about a rented box, not a design choice
- [ ] A one-line rule in `docs/24`: Helios holds **simulated and internal data only** until residency is resolved
- [ ] The architecture's country isolation (`docs/02`) is **not** quietly weakened to match the infrastructure — where the two disagree, the deployment is wrong, not the policy
- [ ] ⚠️ Blocked on the founder confirming the host's location and that real Indonesian or Australian personal data will **not** land here

## The simulation seam

### YT-0535 · One driver interface per external boundary
`todo` · P0 · platform · 3d · dep: YT-0031

- [ ] Each boundary — payments, disbursement, bot check, OTP, messaging, digital-goods supply, receipt ingest, moderation LLM — has **one interface and two implementations**, `simulated` and `live`
- [ ] The driver is selected by configuration and **`simulated` is the default everywhere**, including CI and a fresh clone
- [ ] Choosing `live` without the matching credential **fails at boot**, loudly — never falls back to the simulator, because a silent fallback in production is indistinguishable from working
- [ ] No domain code imports a vendor SDK; a lint rule enforces it

### YT-0536 · Simulators that can fail
`todo` · P0 · platform · 3d · dep: YT-0535

- [ ] Each simulator can be driven into **decline, timeout, duplicate webhook, out-of-order webhook, and 5xx-then-success**
- [ ] The fault set is a named catalogue, not per-test ad-hoc mocking
- [ ] **At least one test per boundary asserts the unhappy path**, because a simulator that only succeeds ships code whose error handling has never executed
- [ ] ⚠️ Directly answers `docs/03` risk 37 — _guarantees that stay green by never running_

### YT-0537 · Payment and disbursement simulator
`todo` · P0 · platform · 3d · dep: YT-0535, YT-0536

- [ ] Xendit-**shaped** but **unit-agnostic**: the money unit is a declared property of the driver, not a constant baked into the simulator
- [ ] A wrong unit therefore **fails a parity test** rather than silently settling 100× wrong — this is what makes YT-0506 safe to defer instead of guess
- [ ] Idempotency, webhook signature verification and replay are exercised against the simulator

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
`todo` · P0 · platform · 4d · dep: YT-0516

- **Schema decided 2026-09-19 (coordination session) so this is no longer blocked.** Four tables in an `identity` schema, and the shape is dictated by rules this codebase already follows:
  - `identity.credential` — `(user_id, kind, secret_hash, updated_at)`, **one row per credential kind**, not a password column on the user. This *is* the seam in YT-0541: adding phone-OTP or an OIDC subject later is a new row, not a migration of the user table.
  - `identity.session` — opaque CSPRNG id **stored hashed**, plus `user_id, created_at, last_seen_at, absolute_expires_at, revoked_at`. Hashed at rest for the same reason voucher codes are: a database read must not yield a usable credential.
  - `identity.verification_token` — password reset and email verification share one table with a `purpose`, `consumed_at` and an expiry. **Single-use is enforced by `consumed_at`, not by deletion**, so a replay is distinguishable from a token that never existed.
  - **No `is_expired`, no `failed_attempt_count`, no `is_locked` column anywhere.** Expiry derives from `absolute_expires_at`; lockout derives from the counters. Storing either is the derived-value bug in `docs/13`, and under concurrency the stored copy is the one that will be wrong.
- **Throttling counters live in Valkey, not Postgres** — high-write, ephemeral, and they must be shared across processes. This is the same mistake as the per-process idempotency store: a counter each instance keeps privately is not a counter, and two API processes behind one proxy would each grant the full allowance.
- Throttle **the account and the source separately**. One counter protects a user from a targeted attack; the other protects every user from a broad one. A single combined counter does neither job well.
- [ ] Argon2id, server-side sessions, rotation on privilege change, absolute and idle expiry
- [ ] Login, logout, password change, password reset, email verification — reset and verification tokens are **single-use and time-boxed**
- [ ] Lockout and throttling on the account **and** on the source, with the counters in shared storage rather than per-process
- [ ] Authorization still runs through Cerbos; this task issues a principal, it does not decide anything

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
