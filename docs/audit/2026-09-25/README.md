# Audit, 2026-09-25

This is the read-only audit behind [`TASKS.md`](../../../TASKS.md). It was taken against `b225116` on `tasks-audit-2026-09-21`. Ten auditors each covered one area. Every engine defect was then given to a second, adversarial reader told to refute it. **Treat these as evidence, not instructions:** a task in `TASKS.md` is what to do, and the report is why.

| Report                                       | Covers                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [product-intent.md](product-intent.md)       | The launch spec: surfaces, the 14 journeys, the 14 engines at "minimum correct", economic invariants, red lines, what "finished" means, and what is deferred |
| [consumer-surfaces.md](consumer-surfaces.md) | Every consumer route: data source, dead ends, missing states                                                                                                 |
| [business-merchant.md](business-merchant.md) | The business console and merchant counter, journey step by step                                                                                              |
| [public-i18n.md](public-i18n.md)             | Why Indonesian is the default, every string and default to change, and the public site                                                                       |
| [ui-design.md](ui-design.md)                 | Why the UI looks broken, the primitive inventory, the redesign order, and three candidate directions                                                         |
| [api-backend.md](api-backend.md)             | Endpoint inventory (39 routes), identity, the missing wiring, migrations, packages                                                                           |
| [engine-money.md](engine-money.md)           | Ledger, pricing, solvency, reward, proof (EM-01 … EM-24)                                                                                                     |
| [engine-voucher.md](engine-voucher.md)       | Issuance, redemption, chain, clearing (D1 … D17)                                                                                                             |
| [engine-watch.md](engine-watch.md)           | Watch session, checkpoints, questions, pacing, selection, risk (EW-01 … EW-23)                                                                               |
| [infra-process.md](infra-process.md)         | CI, the gate, Helios deploy, the old board, and how much work went into process                                                                              |
| [before/](before/)                           | Screenshots of the live site at 390 px, taken during the audit                                                                                               |

Line numbers refer to `b225116`. They drift once Phase 0 lands, so search by symbol if a line has moved.

## Engine defects: verdicts

Each defect was re-checked by a second agent whose job was to refute it. Of 64: **60 confirmed, 3 plausible, 1 refuted** (D17). The verifier also found 8 more, listed under each table. The severity shown is the verifier's, which is sometimes lower than the auditor's.

### engine-money

| ID    | Verdict   | Severity | Defect                                                                                            | Where                                                                     |
| ----- | --------- | -------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| EM-01 | confirmed | high     | Merchant sets the points price directly; pricing engine bypassed                                  | `apps/api/src/modules/store/dto/create-listing.schema.ts:32`              |
| EM-02 | confirmed | high     | K6 broken: unfunded points issued with no reserve transfer                                        | `services/ledger/internal/reward/setup.go:46`                             |
| EM-03 | confirmed | critical | Money engines are not wired into the product at all                                               | `services/ledger/internal/api/routes.go:80`                               |
| EM-04 | confirmed | high     | No overdraft protection; concurrent burns double-spend                                            | `services/ledger/internal/ledger/transfer.go:309`                         |
| EM-05 | confirmed | high     | Reward magnitude hardcoded, far above the founder's ceiling                                       | `services/ledger/internal/reward/taxonomy.go:89`                          |
| EM-06 | confirmed | medium   | Velocity caps racy and driven by a caller-supplied clock                                          | `services/ledger/internal/reward/engine.go:158`                           |
| EM-07 | confirmed | medium   | Daily Merkle proof inert and not tamper-evident                                                   | `services/ledger/internal/proof/checker.go:104`                           |
| EM-08 | confirmed | medium   | Ledger role can inflate allocations, bypassing K6                                                 | `packages/db/migrations/20260919000007_reward_engine.sql:67`              |
| EM-09 | confirmed | medium   | Entry currency not bound to account currency; balances ignore currency                            | `services/ledger/db/query/pricing.sql:45`                                 |
| EM-10 | confirmed | high     | Solvency only measured in tests; K7 thresholds unenforced; reserve and liability terms incomplete | `services/ledger/internal/pricing/solvency.go:75`                         |
| EM-11 | confirmed | medium   | Margin guarantee fails below 1.0 multiplier; multiplier caller-chosen                             | `packages/db/migrations/20260920000014_pricing.sql:62`                    |
| EM-12 | confirmed | high     | Country isolation (B6) not enforced in the ledger                                                 | `services/ledger/internal/ledger/chart.go:117`                            |
| EM-13 | confirmed | high     | No holdback, pending state, reversal or escrow                                                    | `packages/db/migrations/20260919000007_reward_engine.sql:42`              |
| EM-14 | confirmed | low      | Idempotency returns wrong results on replay                                                       | `services/ledger/internal/ledger/transfer.go:172`                         |
| EM-15 | confirmed | medium   | Sign convention contradicts itself; balance sheet by kind is wrong                                | `services/ledger/internal/ledger/chart.go:262`                            |
| EM-16 | confirmed | medium   | Any caller can drain any partner's allocation; partner money pays for platform marketing          | `services/ledger/internal/reward/engine.go:290`                           |
| EM-17 | confirmed | medium   | Transfer and grant ids omit user id                                                               | `services/ledger/internal/reward/engine.go:239`                           |
| EM-18 | confirmed | low      | Transfers not sealed; ledger role can backdate entries                                            | `packages/db/migrations/20260919000002_ledger.sql:103`                    |
| EM-19 | confirmed | low      | Quote can be backdated                                                                            | `services/ledger/internal/api/routes.go:222`                              |
| EM-20 | confirmed | low      | Contracts pricing rounds to nearest; Money ceiling inconsistent                                   | `packages/contracts/src/money/money.ts:169`                               |
| EM-21 | confirmed | medium   | IDR unit and AU rate decisions contradictory or missing                                           | `packages/contracts/src/money/minor-unit.ts:107`                          |
| EM-22 | confirmed | high     | YT-0513 money wire migration half-landed; store and seed broken                                   | `apps/api/src/modules/store/persistence/drizzle-listing.repository.ts:99` |
| EM-23 | confirmed | low      | validate() int64 overflow; checker bigint cast can be crashed                                     | `services/ledger/internal/ledger/transfer.go:323`                         |
| EM-24 | confirmed | low      | Proof day-boundary race and future-day proofs                                                     | `services/ledger/internal/proof/checker.go:65`                            |

Found by the verifier, not the auditor:

- **high** — Campaign completion is refused for every user; nothing can ever be earned (`apps/api/src/modules/watch/watch.controller.ts`)
- **high** — Store browse and get silently return empty after YT-0513 part 1 (parse failure is swallowed) (`apps/api/src/modules/store/persistence/listing-assembler.ts`)
- **medium** — Decided points expiry (12 months rolling) has no implementation (`services/ledger/internal/ledger/chart.go`)

### engine-voucher

| ID  | Verdict   | Severity | Defect                                                                                     | Where                                                                  |
| --- | --------- | -------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| D1  | confirmed | critical | HEAD migration renames the voucher money columns the voucher service still queries         | `services/voucher/db/query/issue.sql:57`                               |
| D2  | confirmed | high     | Voucher container cannot boot under docker compose (merchant_hmac key never generated)     | `docker-compose.yml:214`                                               |
| D3  | plausible | medium   | Redemption writes bypass the lifecycle transition table                                    | `services/voucher/internal/issue/support.go:130`                       |
| D4  | confirmed | medium   | Kill switch does not stop captures; batch scope never fires                                | `services/voucher/internal/redeem/redeem.go:154`                       |
| D5  | confirmed | medium   | Minimum-spend compared to the draw amount, never re-checked at capture                     | `services/voucher/internal/redeem/redeem.go:270`                       |
| D6  | confirmed | medium   | Hash chain misses deletion of the latest events and is never anchored or reconciled        | `services/voucher/internal/chain/chain.go:159`                         |
| D7  | confirmed | low      | Authorize replay by order ref ignores the presented code, the amount and the hold's expiry | `services/voucher/internal/redeem/settle.go:111`                       |
| D8  | plausible | medium   | Refund can be applied twice through a permanently stuck idempotency key                    | `services/voucher/internal/idempotency/claim.go:33`                    |
| D9  | confirmed | low      | Idempotency-Key not covered by the merchant HMAC, and no nonce                             | `services/voucher/internal/merchantauth/signing.go:159`                |
| D10 | confirmed | medium   | AUD redemptions always refused and logged as wrong_merchant                                | `services/voucher/internal/redeem/redeem.go:241`                       |
| D11 | confirmed | medium   | Solvency coverage drops the voucher liability at burn time                                 | `services/ledger/internal/ledger/chart.go:186`                         |
| D12 | confirmed | medium   | Minted vouchers take batch terms that are never reconciled with the listing                | `services/voucher/internal/issue/issue.go:229`                         |
| D13 | confirmed | medium   | Enumeration throttle keeps itself running and counts honest refusals                       | `services/voucher/db/query/redeem.sql:134`                             |
| D14 | confirmed | low      | Retryable conflicts surface as 500 internal_error                                          | `services/voucher/internal/redeem/httpmap.go:103`                      |
| D15 | confirmed | low      | A swept stale hold leaves the voucher held, and the expiry sweep skips held vouchers       | `services/voucher/internal/redeem/release.go:175`                      |
| D16 | confirmed | low      | Merchant counter auth forgeable, and every merchant's voucher codes shipped to the browser | `apps/web/features/merchant/provisioning/device-session-cookie.ts:104` |
| D17 | refuted   | low      | Manual code entry on the counter does not apply Crockford normalisation                    | `apps/web/features/merchant/merchant-redemption-screen.tsx:118`        |

Found by the verifier, not the auditor:

- **high** — atlas.sum not regenerated for the currency migration, so every migrate apply refuses the directory (`packages/db/migrations/atlas.sum`)
- **high** — Voucher service has no issuance, allocation or merchant-credential surface; the redemption network is test-only (`services/voucher/cmd/voucher/main.go`)

Not confirmed:

- **D3** plausible: True: issue.Move (support.go:130-174) never calls lifecycle.Check; only Minter.transition does (support.go:92). There is no DB trigger enforcing transitions either; migrations 15/16/19 carry only CHECKs on state values and void_reason. Scenario A is reachable but harmless. SweepExpiredHolds (release.go:175-181) leaves the voucher 'held', check() accepts Held as Spendable (lifecycle.go:176), and pl
- **D8** plausible: The stuck-key mechanism is real. runAndRecord completes the idempotency row with r.Context() (claim.go:33); middleware.Timeout at 10s (main.go:44, 101) or a client disconnect cancels that context after the handler's transaction has committed. ClaimIdempotencyKey is ON CONFLICT DO NOTHING with no expiry or staleness reclaim (idempotency.sql:7-10), unlike packages/idempotency/src/postgres-store.ts:5
- **D17** refuted: handleSubmitCode (merchant-redemption-screen.tsx:116-122) does use only trim/toUpperCase, but the failure scenario does not happen in this code. The wallet renders detail.code raw (voucher-detail-view.tsx:113-115), not in code.Format's hyphenated groups. The codes the counter matches against are mock fixtures that are not Crockford: 'OTHRSHOP1' and 'GOODCODE1' contain the letter O (merchant-vouche

### engine-watch

| ID    | Verdict   | Severity | Defect                                                                                          | Where                                                                                 |
| ----- | --------- | -------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| EW-01 | confirmed | critical | Progress rate check bypassable by bursts and parallel reports                                   | `packages/contracts/src/watch/watch-progress-report.ts:126`                           |
| EW-02 | confirmed | critical | Watch-path identity is a spoofable header; suspension is self-declared                          | `apps/api/src/shared/authz/principal.service.ts:70`                                   |
| EW-03 | confirmed | high     | campaign_view routes send empty resource attributes and are denied under the real Cerbos        | `apps/api/src/modules/watch/watch.controller.ts:66`                                   |
| EW-04 | confirmed | medium   | Answer keys shipped to the browser; scoring done client-side                                    | `apps/web/app/(app)/watch/[campaignId]/checkpoint/page.tsx:23`                        |
| EW-05 | confirmed | high     | Reward magnitude hard-coded; partner reward_config ignored                                      | `services/ledger/internal/reward/taxonomy.go:89`                                      |
| EW-06 | confirmed | high     | Completion never grants; Reward Engine unreachable                                              | `apps/api/src/modules/watch/watch.controller.ts:186`                                  |
| EW-07 | confirmed | medium   | Honest completion impossible: server demands campaign duration, asset is a 30s fixture          | `apps/api/src/modules/watch/watch.controller.ts:219`                                  |
| EW-08 | confirmed | medium   | Checkpoint issuance not bound to playback; schedule enumerable; unlimited tokens per checkpoint | `apps/api/src/modules/watch/checkpoint/checkpoint.controller.ts:57`                   |
| EW-09 | plausible | low      | Nonce prune deletes the one-answer-per-checkpoint guarantee                                     | `apps/api/src/modules/watch/checkpoint/persistence/checkpoint-nonce.repository.ts:93` |
| EW-10 | confirmed | low      | Concurrent completes both report success                                                        | `apps/api/src/modules/watch/persistence/drizzle-watch-session.repository.ts:129`      |
| EW-11 | confirmed | medium   | Reward Engine velocity caps are check-then-act outside the transaction                          | `services/ledger/internal/reward/engine.go:144`                                       |
| EW-12 | confirmed | medium   | Reward evidence accepted on presence only                                                       | `services/ledger/internal/reward/engine.go:131`                                       |
| EW-13 | confirmed | low      | Grant/transfer IDs omit user ID; cross-user external_ref collision                              | `services/ledger/internal/reward/engine.go:239`                                       |
| EW-14 | confirmed | low      | No client playback-rate lock or foreground enforcement                                          | `apps/web/features/player/use-video-event-wiring.ts:90`                               |
| EW-15 | confirmed | low      | Accrual indicator credits seeks and shows chapter accrual contrary to O-1                       | `apps/web/features/player/use-watch-session.ts:282`                                   |
| EW-16 | confirmed | medium   | Pacing and per-campaign budget unenforced anywhere                                              | `packages/contracts/src/campaign/campaign-pacing.ts:193`                              |
| EW-17 | confirmed | medium   | Campaign lifecycle transitions not enforced; no API                                             | `packages/contracts/src/campaign/campaign-lifecycle.ts:65`                            |
| EW-18 | confirmed | medium   | Signed segment URLs unexported and unused; origin anonymous; no cross-check                     | `packages/media/package.json:5`                                                       |
| EW-19 | confirmed | low      | Checkpoint tokens issued for paused campaigns                                                   | `apps/api/src/modules/watch/checkpoint/checkpoint.controller.ts:82`                   |
| EW-20 | confirmed | low      | Completion target ignores the terms version the session entered under                           | `apps/api/src/modules/watch/watch.controller.ts:219`                                  |
| EW-21 | confirmed | low      | Three conflicting definitions of question/checkpoint count                                      | `apps/api/src/modules/watch/checkpoint/checkpoint.controller.ts:92`                   |
| EW-22 | confirmed | medium   | Indonesian defaults on the watch path                                                           | `apps/web/features/player/accrual-indicator.tsx:41`                                   |
| EW-23 | confirmed | medium   | Board marks unwired watch tickets as done                                                       | `docs/tasks/phase-1-campaign.md:178`                                                  |

Found by the verifier, not the auditor:

- **medium** — Default region is Indonesia at the root of the web app (`apps/web/features/region/get-region.ts`)
- **low** — Completion refusal miscounts unwatched seconds when coverage rows overlap (`packages/contracts/src/watch/watch-session.ts`)
- **low** — Progress endpoint accepts spans for paused or ended campaigns (`apps/api/src/modules/watch/watch.controller.ts`)

Not confirmed:

- **EW-09** plausible: The core logic holds. prune() (checkpoint-nonce.repository.ts:93-103) deletes rows past expires_at, and those rows carry UNIQUE(session_id, checkpoint_index). The migration's justification (20260921120000_watch_checkpoint_nonce.sql:61-66) covers only nonce replay. The cited lines :144 and :155-160 do not exist, because the file has 71 lines; the constraint is at :50. The claimed consequence (answe
