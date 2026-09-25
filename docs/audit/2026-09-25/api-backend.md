# Audit: api-backend (apps/api + backend packages)

Audited 2026-09-25 against HEAD `b225116` on branch `tasks-audit-2026-09-21`, which is `origin/main` (`bd05da7`) plus 5 unpushed local commits. The working tree was read-only. Uncommitted changes from another session (14 business `*.test.ts` files, YT-0547 test isolation) do not affect these findings.

Evidence I ran myself:

- `npx tsc --noEmit` in apps/api: **29 errors**, all in `modules/store`.
- A scratch copy of `packages/db/migrations` through the pinned Atlas image: **`Error: checksum mismatch — 20260922030000_currency_tagged_money.sql was added`**.
- DB-free vitest in apps/api (`authorized-routes`, `mutating-routes`, `principal-attribute-coverage`), 14/14 pass.
- Contracts `route-drift` and `openapi`, 94/94 pass.
- authz `policy-drift`, 22/22 pass.
- drivers, 117/117 pass.

## 1. Verdict

The backend is a set of carefully built parts that are not connected into a working product.

**What it has:**

- A NestJS app with 39 routes.
- A real PDP guard and idempotency interceptor.
- Postgres-backed repositories.
- Well-reasoned migrations.

**What it lacks:**

- No web page calls any of those routes. Every `live` data source in apps/web rejects with "not implemented".
- The email+password sessions from YT-0540 are **not used for authorization**. Every route's identity comes from caller-supplied `x-yt-user-id` / `x-yt-business-roles` headers, trusted as sent.
- The API never talks to `services/ledger` or `services/voucher`.
- The earn loop cannot finish: `POST /complete` hard-codes `questionsAnswered: false` and grants nothing.
- The spend loop (buy points, burn points, issue voucher) has no API at all.

**What is broken at HEAD:** the last commit (YT-0513 "part 1") leaves:

- the store module failing typecheck;
- `atlas.sum` stale, so `db:migrate` and **every** DB-backed test suite fail before running;
- the seed script inserting dropped columns;
- the Go voucher service querying renamed columns.

**Deployment:** Helios deploys only `yourtal-web`. The API is not deployed, and `PrincipalService` refuses to boot when `NODE_ENV=production`.

**Regions:** nothing server-side models them. There is no user/profile table, no region on business or campaign, and the principal's jurisdiction defaults to `"ID"`.

## 2. Critical blockers (ranked)

1. **Identity is self-asserted.**
   - `apps/api/src/shared/authz/principal.service.ts:70,72,80` builds the principal from `x-yt-user-id`, `x-yt-jurisdiction` (default `"ID"`) and `x-yt-business-roles`, trusted as sent.
   - `policies/derived_roles/business.yaml` derives owner/admin/etc. from `P.attr.businessRoles`, so any caller can declare themselves owner of any business.
   - `bearerToken()` / `SessionService.validateAndTouch` are used only inside `AuthService` (`auth.service.ts:176,265`), never by `PdpGuard`, `AsyncPrincipalResolver` or any other module.
   - `business.business_members` is never read to authorize.
   - `principal.service.ts:55` throws on `NODE_ENV=production`.
2. **HEAD is broken by b225116** (YT-0513 part 1, unpushed):
   - (a) `tsc` reports 29 errors across 10 store files, e.g. `listing-assembler.ts:44`, `drizzle-listing.repository.ts:108`, `store-listing.controller.ts:130`. At runtime `assembleListing` `safeParse` returns `null`, so the catalogue returns `[]` and reads return 404 — silently. `create` omits the now-NOT-NULL `currency`.
   - (b) `packages/db/migrations/atlas.sum` has no line for `20260922030000_currency_tagged_money.sql`. Atlas refuses: `checksum mismatch`, confirmed by running it. `packages/db/scripts/test-db.mjs:198-226` exits on that failure, so apps/api, packages/db, packages/idempotency and packages/queue tests all go red.
   - (c) `packages/db/src/seed.ts:343,410` still inserts `face_value_idr` / `settlement_value_idr` / `remaining_value_idr`.
   - (d) `services/voucher/db/query/issue.sql:58,96,113,135` and `services/voucher/db/schema.sql:56-59,164-171` still use `face_value_idr` / `remaining_value_idr`. The API side and the voucher side cannot both be right against one database.
   - (e) 26 non-test web files still reference `faceValueIdr` etc.
3. **No API-to-engine wiring.**
   - `apps/api/src/config/env.schema.ts:24-77` has no ledger or voucher URL.
   - No `fetch` or HTTP client exists in apps/api.
   - Every ledger `/v1` route returns 501 `notYetExposed`: `services/ledger/internal/api/routes.go:80-106`, covering balance, pricing/quote, transfers and rewards/grants.
   - The voucher service exposes only merchant-HMAC `/v1/vouchers/{authorize,capture,void,refund}` (`services/voucher/internal/redeem/routes.go:22-25`), and nothing calls them.
   - `store.module.ts:45-47` says it outright: "no burn-saga … endpoints".
4. **The earn loop cannot finish.**
   - `watch.controller.ts:180-186` has `TODO(YT-0122) … questionsAnswered: false`, so every completion is refused.
   - On success it only sets `state='completed'` (`drizzle-watch-session.repository.ts:129-134`), with no reward grant.
   - `CheckpointService.redeem` (`checkpoint.service.ts:96`) has no caller.
   - No endpoint serves questions or captures answers, although `campaign.question*` tables and `question-selection.ts` exist.
5. **The web is 100% mock.**
   - Zero runtime `fetch` calls in `apps/web`.
   - All 12 `resolveDataSource` seams reject in live mode: `campaign-data.ts:53`, `store-data.ts:49`, `wallet-data.ts:68`, `console-data.ts:50`, `burn-data.ts:111`, `merchant-data.ts:105`, `store-balance-data.ts:24`, `quick-data.ts:50`, `checkpoint-data.ts:88`, `player/get-watch-campaign.ts:55`, `reports-data.ts:55`, `provisioning-data.ts:154`.
   - There is no login or register page. Onboarding uses a phone-OTP mock (`features/onboarding/otp-mock-service.ts`).
6. **The API is not deployed to Helios.**
   - `.gaiadeploy.yml:17-21` has only `pm2_name: yourtal-web` on port 26300.
   - `infra/PORTS.md:63-64` shows only `next-server` and Postgres live.
   - `docker-compose.yml` has no `api` or `web` service, and still includes `zitadel` despite the email+password decision.

## 3. Endpoint inventory (39 routes)

None of these routes has a caller in apps/web. The last column names the web feature that _would_ need each one; all of those features currently run on mock fixtures.

| #     | Method + path                                                                                    | Module     | State                                                                                                        | Web feature that needs it          |
| ----- | ------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| 1     | POST /api/auth/register                                                                          | auth       | works; returns `{userId}` only (no session, region, locale or name)                                          | none (no signup UI)                |
| 2     | POST /api/auth/login                                                                             | auth       | works; returns bearer token                                                                                  | none                               |
| 3     | POST /api/auth/logout                                                                            | auth       | works                                                                                                        | none                               |
| 4     | POST /api/auth/password/change                                                                   | auth       | works; **raw token persisted in idempotency table**                                                          | me-security-section                |
| 5     | POST /api/auth/password/reset/request                                                            | auth       | partial: token goes only to in-memory `DevTokenAccess` (`auth.service.ts:332`), never emailed                | none                               |
| 6     | POST /api/auth/password/reset/confirm                                                            | auth       | works, but unreachable without delivery                                                                      | none                               |
| 7     | POST /api/auth/email/verify/request                                                              | auth       | partial: no delivery                                                                                         | none                               |
| 8     | POST /api/auth/email/verify/confirm                                                              | auth       | partial: verified state not stored anywhere (`auth.service.ts:284-308`)                                      | none                               |
| 9     | POST /api/businesses                                                                             | business   | works; requires `district`, no region or currency                                                            | console-no-business                |
| 10    | GET /api/:t/business                                                                             | business   | works                                                                                                        | console-data.getBusinessMembership |
| 11    | GET /api/:t/business/team                                                                        | business   | works                                                                                                        | team-screen                        |
| 12    | POST /api/:t/business/team/invite                                                                | business   | partial: by `userId` (`invite-member.schema.ts:6`); web invites by **email**; no invite email or accept flow | team-invite-dialog                 |
| 13    | PATCH /api/:t/business/team/:userId/role                                                         | business   | works (second post-read PDP check)                                                                           | team-change-role-dialog            |
| 14    | DELETE /api/:t/business/team/:userId                                                             | business   | works                                                                                                        | team-remove-dialog                 |
| 15-16 | GET, PUT /api/:t/business/billing-contact                                                        | business   | works                                                                                                        | business/billing                   |
| 17    | GET /api/:t/business/kyb-documents                                                               | business   | works                                                                                                        | none                               |
| 18    | POST /api/:t/business/kyb-documents                                                              | business   | partial: free-text `storageRef`, no upload, no ops review; `is_verified` never set                           | none                               |
| 19    | GET /api/campaigns                                                                               | campaign   | works; no region filter; limit only                                                                          | earn board, quick feed             |
| 20    | GET /api/campaigns/:id                                                                           | campaign   | works                                                                                                        | entry card, player                 |
| 21-22 | GET /api/store/listings[/:id]                                                                    | store      | **broken at HEAD** (empty or 404); no region or currency filter                                              | store browse, offer detail, burn   |
| 23-31 | POST, GET, PATCH /api/:t/store/listings…, settlement-value, price-revisions, pause/resume/retire | store      | **broken at HEAD**; merchant supplies `priceInPoints` directly                                               | business/inventory                 |
| 32-33 | POST …/settlement-decrease-requests[/:rid/approve]                                               | store      | **broken at HEAD**                                                                                           | none                               |
| 34    | POST /api/watch/sessions                                                                         | watch      | works                                                                                                        | player                             |
| 35    | GET /api/watch/sessions/:id                                                                      | watch      | works                                                                                                        | player resume                      |
| 36    | POST /api/watch/sessions/:id/progress                                                            | watch      | works (server-clock rate check)                                                                              | player                             |
| 37    | POST /api/watch/sessions/:id/complete                                                            | watch      | **refuses every call**; no reward                                                                            | checkpoint-result                  |
| 38    | POST /api/watch/sessions/:id/checkpoints/:i/token                                                | checkpoint | works; nothing can redeem it                                                                                 | checkpoint quiz                    |
| 39    | GET /api/health                                                                                  | health     | works (PDP + Postgres)                                                                                       | —                                  |

The OpenAPI document (`packages/contracts/openapi/yourtal.openapi.json`) covers only #9-20, #34-37 and #39: 17 operations. Auth, store and checkpoint are exempted in `route-drift.test.ts:168-215`. Nothing consumes the generated Go models, and no TS client exists.

## 4. What the web needs and the API lacks

- **Identity and profile:**
  - current user (`GET /me`)
  - region and locale committed at registration
  - interests
  - consent grant/withdraw (the `packages/consent` domain exists, with no table and no API)
  - DSAR/delete account (`packages/db/src/dsar-handlers.ts` exists, with no route)
  - referrals
  - phone OTP (`packages/drivers` has a simulator, unused)
- **Wallet:** balance, pending unlocks, vouchers list and detail, history. The ledger balance route is 501.
- **Earn:** question delivery, answer submission, scoring, reward grant, and the accuracy bonus.
- **Spend:** price quote/lock, burn points, issue voucher. None exist.
- **Business console:**
  - list my businesses and memberships;
  - campaign authoring: create, draft, edit, chapters, video upload, questions, targeting, budget, submit for review, publish/pause;
  - question bank;
  - reports;
  - buy points and fund campaign: `billing.purchase_points` exists in policy, with no route;
  - business-side redemption view.
- **Merchant/store staff:** device provisioning and PIN, voucher identify, redeem (the voucher service has authorize/capture, but no web path or device credential issuance), today log.
- **Public pages:** these could use #19/#20/#21 but read fixtures.

**The reverse** — what the API provides and nothing uses: all 39 routes. Specifically orphaned are:

- auth (no UI);
- KYB and billing-contact;
- settlement-value, price-revisions and the two-person settlement-decrease workflow.

## 5. Admin / internal-staff backend

**Missing.**

- `packages/authz/src/roles.ts` defines `support`, `moderator`, `risk_analyst`, `finance`, `ops`, `admin`.
- Policies exist for `ledger_adjustment`, `moderation_item`, `platform_setting` and `kyb_document:approve/reject`.
- But `PrincipalService` can only ever emit `["user"]` or `["user","business_user"]` (`principal.service.ts:85`).
- No staff route, no staff UI, and no way to create a staff account.
- Campaign review/approval, KYB review, merchant onboarding and kill switches have no backend.

## 6. Migrations, seed, roles, RLS

- **Files:** 31 SQL files, lexicographically ordered.
  - `000018` is skipped (a cosmetic gap).
  - Numbering switches from `…000019` to real timestamps (`20260920014200`), which still sorts correctly.
  - All 31 are tracked in git; nothing dangles on disk.
  - **`atlas.sum` is stale** (see §2.2b); re-run `pnpm --filter @yourtal/db migrate:hash`.
- **Roles:**
  - `yourtal_app` and `yourtal_ledger` are created in `infra/postgres/init/01-schemas.sql:16-19`, outside Atlas.
  - `yourtal_voucher` (`…15_voucher_custody.sql:35`) and `yourtal_analyst` (`20260922010000…:48`) are created inside migrations with hard-coded passwords (`voucher_local_only`, `analyst_local_only`).
  - Grants are careful and least-privilege, e.g. `REVOKE ALL ON SCHEMA ledger FROM yourtal_app`, and `question_response` is INSERT-only for the app.
  - `PersistenceModule` refuses to boot as a superuser.
- **RLS:** none. There are zero `ENABLE ROW LEVEL SECURITY` or `CREATE POLICY` statements. Tenant isolation rests entirely on the (spoofable) PDP input and on `WHERE merchant_id = :tenantId` in repositories.
- **Model gaps:**
  - No users/profile table; `user_id` is a bare uuid/text everywhere.
  - No region/jurisdiction column on business, campaign or user.
  - `campaign.campaigns.merchant_id` and `store.listings.merchant_id` have no FK to `business.business_accounts` (`…04_catalogue.sql:18,43`).
  - No consent table.
  - Campaign has no budget, funding, targeting, upload state or created-by. `reward_config` exists (`…12_campaign_lifecycle.sql:154`) but nothing writes it.
- **Seed** (`packages/db/src/seed.ts`):
  - Seeds mock campaigns, listings, vouchers and questions only.
  - Seeds no credential, business, member, ledger account, allocation or `reward_config`, so no seeded user can log in and no seeded campaign can pay.
  - It is broken at HEAD (§2.2c).
  - There is no snap-app merchant anywhere in code; "snap-apps" appears only in consent copy (`packages/consent/src/purpose-catalogue.ts:131`).

## 7. Packages

- **contracts:** zod types plus mocks, used heavily by web (210 files) and api (47). This is the real shared asset.
  - Region config is already AU-first: `region.ts` has `AU → en-AU/AUD`.
  - The mock/live switch (`mock-source.ts:73`) is a clean seam.
  - The OpenAPI document is partial (§3).
- **drivers:** 9 simulated boundaries: payments, disbursement, bot_check, otp, messaging, digital_goods, receipt_ingest, moderation, device_reputation. Each has fault injection and tests pass (117).
  - **Zero consumers** anywhere in the repo.
  - Vendors are Indonesia-first (Xendit, WhatsApp, "Indonesian SMS gateway"; `boundary.ts:56-140`).
  - **Missing boundaries:** email (needed by password reset and verification), KYB/business verification, object storage + video upload/transcode.
- **queue:** pg-boss wrapper with idempotent worker and DLQ; pgboss schema migrated. **Zero consumers.**
- **media:**
  - A fixed 30s HLS fixture published to MinIO, plus `signed-segment-url.ts`.
  - The latter is not in package `exports`, and nothing outside its test uses it.
  - No upload or transcode pipeline.
  - Used only by one web e2e spec and one contracts test.
- **consent / jurisdiction:** pure, well-tested domain logic with AU and ID policy data. Consumed only by packages/db DSAR handlers; not by the API or web.
- **authz + policies:**
  - 17 resource kinds, a Cerbos test suite, and a drift test (22 pass).
  - The API uses 7 kinds.
  - The quality is high, but the input principal is untrusted (§2.1).
- **idempotency:** solid.
  - Fingerprints the raw body.
  - The guard runs before the interceptor.
  - The mutating-route gate passes.

## 8. Other defects

- **Raw session tokens stored in plaintext.** `password/change` and `password/reset/confirm` are `@Idempotent` and return `{token}` (`auth.controller.ts:107,132`). The interceptor stores `JSON.stringify(value)` into `platform.idempotency.body` (`idempotency.interceptor.ts:125-127`) for 1h. That table is readable by `yourtal_app` and `yourtal_voucher` (`…15_voucher_custody.sql:41`), which defeats the hashing of `identity.session`.
- **No `trustProxy`.** `main.ts:26` uses `new FastifyAdapter()` without it. Behind Helios nginx, `request.ip` is the proxy's address, so the per-IP limits become site-wide:
  - register: 5/h;
  - reset request: 3/h;
  - login source throttle: 20 failures per 15 min locks everyone out.
- **Aggressive idle timeout.** `SESSION_IDLE_TTL_MS` is 30 min (`session.service.ts:21`), which is harsh for a consumer PWA.
- **Throttle races.**
  - peek-then-record TOCTOU, and `incr` then `expire` is not atomic (`throttle.service.ts`).
  - A crash between the two leaves a key with no TTL, which is a permanent lockout.
- **Merchant sets the points price.** `priceInPoints` is taken from the merchant's request body (`create-listing.schema.ts:32` → `drizzle-listing.repository.ts:110`). This contradicts board YT-0130's `[x]` "A supplier can never set a points price directly".
- **YT-0122 is marked `done` and "Verified",** yet no API code writes `campaign.question_response`, and `watch.controller.ts:180` still carries `TODO(YT-0122)`.
- **Six pg pools.** Five modules plus idempotency each open their own `pg` Pool, up to 60 connections by default.
- **Indonesia-first shapes.** The create-listing money fields use `idrMinorUnitsSchema` (IDR-typed). `district` is mandatory for a business. AU is therefore second-class in the API shape.
- **No HTTP hardening.** No CORS, cookie, CSRF or helmet setup in `main.ts`. No BFF exists, so the browser-to-API auth transport (Bearer in localStorage vs httpOnly cookie) is undecided.

## 9. Keep

- The PDP guard with deny-by-default and its build gates.
- The idempotency interceptor and `packages/idempotency`.
- The Argon2id password hashing, the hashed opaque session tokens, the timing-equalised login, and the non-enumerating reset flow.
- The watch-session coverage model (server-clock rate check, completion decided by coverage) and the checkpoint PRF tokens.
- The campaign repository's "draft is unrepresentable" pattern.
- The migrations' grant model, `reward_config`, and the `question*` tables.
- The contracts zod schemas, region config and the mock/live seam.
- The drivers' simulators and fault engine.
- packages/consent and packages/jurisdiction.
- The Cerbos policies and tests.

## 10. Cut or defer

- Zitadel in `docker-compose.yml` and YT-0032.
- The `oidc_consent_screen` / `import_from_sister_app` consent sources until snap-app integration exists.
- The two-person settlement-decrease workflow, charity settlement, disbursement, receipt-ingest, device-reputation, moderation LLM and digital-goods aggregator — all post-MVP.
- The Go OpenAPI model generation (no consumer).
- Separate per-module DB pools.
- The 3-layer comment essays: the code is buried under historical narrative (e.g. `principal.service.ts`, `dev-token-access.ts`). New work should stop adding them.

## 11. Recommendations (ordered)

1. **Unblock HEAD first.** Finish YT-0513:
   - rename the store module fields to `*Minor` plus `currency`;
   - fix seed.ts;
   - regenerate `atlas.sum`;
   - update the voucher service's `issue.sql` and `schema.sql` and re-run sqlc;
   - update the 26 web files;
   - or revert b225116 before pushing.
2. **Real identity.**
   - Replace `PrincipalService.resolve` with a session lookup via the Bearer header or an httpOnly cookie.
   - Load `businessRoles` from `business.business_members` and roles from a new `identity.user` or staff table.
   - Delete the `x-yt-*` headers.
   - Remove the production refusal.
   - Add `trustProxy`.
   - Stop persisting token-bearing responses: make those two routes `@NotValueMoving`, or store a redacted body.
3. **Add `identity.user_profile`** with region (AU/ID, immutable after signup), locale (default `en-AU`), display name and date of birth. Register takes the region. Add `GET /api/me`. The jurisdiction default becomes the user's stored region, never `"ID"`.
4. **Wire the API to the ledger over HTTP** with a service credential:
   - expose balance, quote, transfer and grant behind service auth;
   - complete → grant (via reward_config/allocation);
   - buy-points → point_purchase (simulated payments driver);
   - burn → ledger debit, then voucher issue.
5. **Build the missing earn half:** question delivery (`question-selection.ts`), answer capture into `question_response`, scoring, then flip `questionsAnswered`.
6. **Campaign authoring API:** CRUD, upload via a MinIO presigned URL and simulated transcode, `reward_config` and funding, submit/approve/publish, and a staff approval endpoint.
7. **Wallet/voucher read API and merchant device API**, fronting the voucher service.
8. **Minimal staff backend:** a staff role table plus approve-campaign, approve-KYB and adjust routes.
9. **Implement the web live data sources one seam at a time** through a thin server-side BFF client in apps/web, which keeps the API token server-side.
10. **Deploy the API** (plus Cerbos and Valkey) on Helios under pm2 next to web, and add it to `.gaiadeploy.yml`.
11. **Add an email driver** (simulated inbox, viewable in dev) and wire `AuthService.deliver`.
