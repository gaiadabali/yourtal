# Audit: business console and merchant/store-staff surfaces

Key: `business-merchant` · Audited at HEAD `b225116` (branch `tasks-audit-2026-09-21`), 2026-09-25 · Read-only.

## Verdict in one paragraph

No step of the business journey works end to end. The web side (`apps/web/app/(app)/business/*`, `apps/web/app/(merchant)/*`) is a **fixture-only clickable prototype**. Every data seam's `live` branch rejects with "not implemented yet", and `apps/web` contains **zero** `fetch` calls to any backend. The API side (`apps/api` business/store, Go voucher service) has real Postgres-backed pieces: business creation, team roster CRUD, KYB metadata, listing management, and voucher authorize/capture. But nothing calls them, and identity is spoofable headers, so none of it can carry real traffic. Campaign authoring, points purchase, campaign funding, reports and device provisioning have **no backend at all**. On top of that, **HEAD does not compile**. Commit `b225116` (YT-0513 part 1) renamed listing/voucher money fields in `@yourtal/contracts` and says outright that "apps/web and apps/api consumers follow in part 2; they do not compile yet". I measured 29 TS errors in `apps/api` (all in `modules/store`) and 35 in `apps/web`. The `/merchant` redemption test suite now crashes at import with a ZodError.

## Journey, step by step

| #   | Step                                     | Web UI                                                 | API/backend                                                        | Verdict                               |
| --- | ---------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------- |
| 1   | Business signs up                        | none                                                   | `POST /api/auth/register` (email+password), `POST /api/businesses` | API-only, partial                     |
| 2   | KYB                                      | none                                                   | submit/list metadata only                                          | API-only, partial                     |
| 3   | Console shell / zone gating              | fixtures                                               | no "my businesses" endpoint                                        | fixture-only                          |
| 4   | Team + roles                             | fixtures (email invite, role, remove, transfer, audit) | list/invite(by userId)/change-role/remove                          | partial; not wired                    |
| 5   | Create campaign (draft, status workflow) | fixtures in `useState` + in-process `Map`              | read-only consumer GETs                                            | fixture-only                          |
| 6   | Upload video                             | simulated `setInterval` progress                       | none                                                               | stub                                  |
| 7   | Author questions                         | fixtures (PII guard, bank-size rule)                   | tables exist, seeded only, no API                                  | fixture-only                          |
| 8   | Reward / budget / pacing                 | form fields                                            | `reward_config` has no writer/reader; pacing lib unused            | missing                               |
| 9   | Buy points / fund campaign (Billing)     | placeholder                                            | ledger `/v1/*` all 501; `RecordPurchase` uncalled                  | missing                               |
| 10  | Voucher inventory + settlement value     | placeholder                                            | full listing API, **broken at HEAD**, IDR-only                     | broken                                |
| 11  | Reports                                  | fixtures + honest "unavailable" panels                 | none                                                               | fixture-only                          |
| 12  | Console Redemption zone                  | placeholder                                            | —                                                                  | stub                                  |
| 13  | Staff redeem at checkout on device       | fixtures, **crashes at HEAD**                          | voucher svc authorize/capture/void/refund live (merchant HMAC)     | UI broken; backend partial; no bridge |
| 14  | Device provisioning / revoke             | mock `/merchant/devices`, unauthenticated              | none (policy only)                                                 | fixture-only                          |
| 15  | snap-app as first merchant integration   | —                                                      | no credential issuance path                                        | missing                               |

## Evidence

### Web is fixture-only, with no path to the API

- Every console seam resolves through `resolveDataSource`, and its live branch rejects:
  - `apps/web/features/console/console-data.ts:43-53`
  - `.../campaign-builder/campaign-builder-data.ts:32-37`
  - `.../reports/reports-data.ts:46-56`
  - `apps/web/features/merchant/merchant-data.ts:90-108`
  - `.../merchant/provisioning/provisioning-data.ts:150-158`
- The default mode is `mock`: `packages/contracts/src/mock-source.ts:82-84`.
- `grep "fetch(\|process.env"` across `apps/web/features`, `app` and `lib` finds no backend call at all. It returns only 3 `NODE_ENV` checks.
- There is no login page and no middleware (`apps/web/middleware.ts` / `proxy.ts` do not exist). `/business` always renders the fixture owner `CURRENT_USER_ID` (`console-fixtures.ts:32`, `console-data.ts:27-30`).
- The business console renders inside the **consumer** `AppShell`, with the Earn/Quick/Store/Wallet/Me tabs (`apps/web/app/(app)/layout.tsx`, `features/shell/nav-items.ts:39-43`). No nav item leads to `/business`.
- Placeholder copy shows ticket IDs to end users: `console-zone-placeholder.tsx:23` ("not built yet — see {ticketId}. The console shell (YT-0440)…"), fed `YT-0441` from `business/inventory/page.tsx:24` and `YT-0445 / YT-0446` from `redemption/page.tsx:24`. Billing is `ticketId="unscheduled"` (`billing/page.tsx:24`).
- The overview is a generic grid of cards with fixed blurbs (`console-zone-grid.tsx`). There are no KPIs, balances or campaign status. This is the "AI slop" look the founder describes.

### Identity and authz: good policies, a spoofable principal

- `PrincipalService.resolve` builds the principal from headers:
  - `x-yt-user-id`, `x-yt-jurisdiction` (default `"ID"`), `x-yt-business-roles` (JSON map businessId→role) and `x-yt-suspended`, all trusted verbatim (`apps/api/src/shared/authz/principal.service.ts:69-91`).
  - It refuses to boot when `NODE_ENV=production` (`:54-61`), so the API cannot run in production mode on Helios.
- `businessRoles` is **only** ever read from that header. `grep businessRoles apps/api/src` hits only `principal.service.ts`. `AsyncPrincipalResolver` adds only `valueFrozenUntil` (`async-principal-resolver.ts:182-197`).
- The `business_members` table that invite/change-role/remove write to therefore has **zero effect on authorization**. Anyone can send `x-yt-business-roles: {"<any-id>":"owner"}`.
- The auth module issues opaque bearer sessions (`modules/auth/*`), but no code turns a session into a `Principal`. Auth is an island.
- The Cerbos layer itself is solid:
  - Tenant-scoped derived roles: `policies/derived_roles/business.yaml`.
  - Deny-by-default global `PdpGuard`: `shared/authz/pdp.guard.ts`.
  - Post-read second PDP checks for owner-targeting: `team-member.controller.ts:56-81,116-143`.
  - The same pattern for material settlement cuts: `store-listing.controller.ts:124-142`.
  - Self-approval refusal: `settlement-decrease.controller.ts:84-117`.
  - `cerbos compile` tests run in CI: `.github/workflows/authz.yml`.
- UI zone gating (`console-zone-access.ts:121-152`) mirrors `derived_roles/business.yaml` correctly. It is cosmetic by design.
- Policy actions that no route serves:
  - `campaign`: all 9 (`archive`, `create`, `edit`, `edit_questions`, `pause`, `publish`, `submit_for_review`, `view`, `view_performance`).
  - `billing`: `purchase_points`, `view_statement`, `raise_dispute`.
  - `team`: `transfer_ownership`, `delete_business`, `provision_device`, `revoke_device`.
  - `kyb_document`: `approve`, `reject`.
  - `business`: `edit`.
  - `listing`: `approve_listing`, `reject_listing`.
  - `report`: `view`, `export`.
  - `voucher_batch`: all actions.
- The `store_device` principal role is never constructed. `PrincipalService` only emits `user` / `business_user` (`principal.service.ts:83-86`). So `store_device_of` and `redemption.yaml`'s device rules cannot fire.

### Step 1–2: business sign-up and KYB (API-only)

- `POST /api/businesses` (`create-business.controller.ts:22-59`) creates the account and the owner membership atomically (`drizzle-business-onboarding.unit-of-work.ts:55`). It is idempotent.
- **The payload has no region, country, currency or tax ID.** It carries `legalName, displayName, district, roles, logoUrl` (`dto/create-business.schema.ts:14-20`), and the table has `district` and no region (`persistence/schema/business-account.table.ts:5-16`). `grep region` over the business, campaign and store modules returns nothing. This fails the founder's "two regions chosen at registration" decision.
- Register takes only email + password (`modules/auth/dto/register.schema.ts`), with no region either.
- KYB (`kyb-document.controller.ts:22-57`):
  - Stores `documentType` / `storageRef` / `expiresAt` metadata only. `storageRef` is a free string, and no upload or encryption exists (`packages/contracts/src/business/kyb-document.ts:38-40,58-63`).
  - There is no ops review endpoint. `is_verified` defaults to false and nothing ever writes it (`grep isVerified` returns only reads).
  - The document types are generic, with no ABN/ACN (AU) or NIB/NPWP (ID) distinction.
  - Board YT-0100 is `doing` and says so honestly.

### Step 3–4: console and team

- UI:
  - Team zone (`team-screen.tsx`, `team-actions.ts`): invite by **email**, change role, remove, transfer ownership with a 5-minute re-auth check, and an audit trail. All mutations run against `useState`.
  - The audit trail is UI-derived, with no audit contract (`console-audit.ts`).
- API:
  - `GET/POST invite` / `PATCH role` / `DELETE` exist (`team-directory`, `team-invite`, `team-member` controllers).
  - The invite takes a **`userId`, not an email** (`dto/invite-member.schema.ts:6-7`).
  - There is no invitation token, no accept endpoint, and no email send. Invitees keep `joinedAt = null` forever (`business-member.table.ts:17` says "null until the invitee accepts", and nothing accepts).
  - There is no `GET /api/businesses` or "my memberships" endpoint, which the console's `listMyBusinesses` would need.
  - There is no transfer-ownership endpoint.
- Billing contact GET/PUT exists (`billing-contact.controller.ts:22-57`). It reuses `billing:update_payment_method`, and it is IDR-phone-centric only by fixture.

### Step 5–8: campaign authoring

- The campaign API is **read-only and consumer-facing**:
  - `GET /api/campaigns` and `GET /api/campaigns/:id`, gated by `campaign_view:watch_open` (`modules/campaign/campaign.controller.ts:27-58`).
  - The repository has only viewer reads (`persistence/campaign.repository.ts:120-133`).
  - Campaigns exist only because `packages/db/src/seed.ts:99-115` inserts `mockCampaigns`.
- Builder UI (`features/console/campaign-builder/*`):
  - It has a five-state workflow (`campaign-draft-actions.ts:81-128`), chapters, targeting, reward, budget and a question bank.
  - Drafts live in a module-scope `Map` (`campaign-builder-data.ts:18-30`) and in client `useState`.
  - Targeting is `interests` + `districts`, free-text and Indonesia-flavoured (`campaign-draft.ts:33-36`).
- Video upload is a fake progress timer (`campaign-editor-upload.tsx:13-60`). `packages/media` has only an HLS origin, signed segment URLs and a fixture. There is no ingest or transcode. Old ticket YT-0110 targets Cloudflare Stream, which contradicts the self-hosted Helios posture with simulated drivers.
- Question bank:
  - The UI rules are real logic: PII guard `question-pii-guard.ts`, bank size `question-bank-rules.ts`.
  - DB tables exist (`migrations/20260920000017_question_bank.sql`), but no API route writes them.
- Reward and budget:
  - `campaign.reward_config` (`allocation_id`, `reward_points_per_completion`, `max_points_for_campaign`) has **no writer or reader anywhere**. The only hits are the two migrations and the drift test. The seed does not populate it either.
  - The builder's `rewardPoints` / `budget.totalBudgetPoints` fields go nowhere.
- Pacing: `packages/contracts/src/campaign/campaign-pacing.ts` is imported by nothing except its own test.
- `campaign-reward-risk.ts:33-75` shows businesses a "20x data cost" ratio. It is computed from `MOCK_BACKING_RATE_*` and a sen-denominated data cost (`:38`, 400 sen/MB), which predates the founder's whole-Rupiah decision in `d2dc5c7`. It is advisory only (it does not block submit).

### Step 9: buy points / fund campaign

- The Billing zone is a placeholder (`business/billing/page.tsx:9-28`).
- Every ledger `/v1` route returns 501 `notYetExposed`: balance, quote, transfers and grants (`services/ledger/internal/api/routes.go:77-108`).
- `reward.RecordPurchase` (`services/ledger/internal/reward/purchase.go:79`) is correct and atomic. Nothing calls it (`grep RecordPurchase` returns only its definition).
- The payments simulated driver (`packages/drivers/src/boundaries/payments.ts`) has **no consumer**. Only `packages/drivers/package.json` references `@yourtal/drivers`.

### Step 10: voucher inventory (listing) — broken at HEAD

- The API is the most complete in this area:
  - create / list / get / edit / pause / resume / retire / settlement-value / price-revisions (`store-listing.controller.ts:46-196`).
  - Two-person material-decrease propose/approve (`settlement-decrease.controller.ts`).
- **It does not compile.** `tsc --noEmit` on `apps/api` gives 29 errors, all in `modules/store`. `listing-assembler.ts:44-51` still maps `faceValueIdr` / `settlementValueIdr` / `minimumSpendIdr` into `listingSchema`, which now requires `currency` / `faceValueMinor` / … (`packages/contracts/src/listing/listing.ts:71-82`).
- Run under an untyped transpiler (vitest/tsx), `safeParse` fails for every row and `assembleListings` silently drops it (`listing-assembler.ts:56,68-71`). The catalogue and "my listings" would return empty and `get` would 404.
- The DTO is IDR-only (`dto/create-listing.schema.ts:30-32`). The drizzle table has already moved to `currency` / `face_value_minor` (`schema/listing.table.ts:29-39`).
- `priceInPoints` is **client-supplied** (`create-listing.schema.ts:16-32`), so the supplier sets their own points price. This contradicts docs/09 / YT-0130, "a supplier can never set a points price directly". The ledger quote route that should price it is 501.
- A new business cannot create a listing at all. `locationIds` must belong to the merchant (`drizzle-listing.repository.ts:41-46`), and no endpoint creates `store.merchant_location` rows (seed only).
- Nothing links a listing to voucher issuance. The voucher service builds `issue.New` but never mounts a route (`services/voucher/cmd/voucher/main.go:89`; it is used only in a log line at `:143`).

### Step 11: reports

- The UI is fixture-only (`reports-data.ts:33-44`). It renders "unavailable" panels for metrics no contract supports (`reports-unavailable-metrics.ts`), which is the right honesty posture.
- The chapter reason is stale: `campaign.chapter` exists since YT-0101 / YT-0548.
- `reports-metrics.ts:148` sums `voucher.faceValueIdr`, which no longer exists. The total is NaN and 2 tests fail.
- Currency comes from `getRegionDisplayConfig()`, which defaults to `ID` (`features/region/get-region.ts:11`).
- There is no reporting API. The `report` policy is unused.

### Step 13–14: store staff at the counter

- UI (`/merchant`):
  - Provisioning code, then PIN unlock, then scan or manual code, then a simulated authorize/capture (`merchant-redemption.ts:47-80`), an offline pending queue and today's log.
  - The logic is well tested, but it is all fixtures. The device receives the **entire cross-merchant voucher catalogue** (`merchant-data.ts:49-57,117-119`) instead of doing a server-side lookup by code.
- **Broken at HEAD.** `merchant-voucher-fixtures.ts:39` calls `voucherSchema.parse({... faceValueIdr ...})` at module scope. The voucher contract now requires `faceValueMinor` / `remainingValueMinor` / `currency` (`packages/contracts/src/voucher/voucher.ts:67-69`). `vitest run features/merchant/merchant-redemption-screen.test.tsx` fails at suite load with a ZodError. Because `merchant-data.ts` imports those fixtures, every `/merchant` request would throw.
- Security pattern in the mock (it must not carry forward):
  - The device binding cookie is unsigned base64 JSON (`device-session-cookie.ts:48-54`).
  - The unlock check is `cookie === "1"` (`:101-104`), so the PIN is bypassable by setting one cookie.
  - The PIN is unsalted-KDF SHA-256 (`pin-hash.ts`).
  - `/merchant/devices` revokes with no auth (`app/(merchant)/merchant/devices/page.tsx`). It admits it is "a mock stand-in", and the real place is the Team zone, which lacks it.
- `lang="id-ID"` is hardcoded for the whole merchant group (`app/(merchant)/layout.tsx:47`). Tracked as YT-0598, `todo`.
- Backend (Go voucher service):
  - `POST /v1/vouchers/{authorize,capture,void,refund}` are live behind merchant HMAC verification and an idempotency middleware (`services/voucher/cmd/voucher/main.go:114-118`, `internal/redeem/routes.go:22-25`), with ownership checks (`internal/redeem/ownership.go`).
  - Authentication is **merchant-level** only: there is no device identity and no Cerbos call (`grep -i cerbos|pdp services/voucher` returns nothing). Any credential holder can void or refund, which contradicts `redemption.yaml`'s "a counter device never moves value backwards".
  - `merchant_credential` rows are inserted only in tests (`merchantauth/middleware_test.go:80`, `redeem/http_test.go:89`). There is no provisioning path, so snap-app cannot be onboarded.
- There is no BFF from web to the voucher service.

### i18n

- Console strings are hardcoded English JSX. No `useTranslations` or `getTranslations` appears in `features/console` or `features/merchant`.
- The merchant surface carries its own `en-AU` / `id-ID` dictionary (`merchant-copy.ts`).
- Region defaults to `ID` (`get-region.ts:11`).

## Board vs reality

- YT-0440, 0441, 0442, 0444, 0445 and 0446 are marked `done` (`docs/tasks/phase-u-ui-business.md`). They are done **as mock prototypes**. Read as "feature done", every one is false: none touches a backend.
- YT-0101 is `done` for contract and storage. It has no authoring endpoint.
- YT-0106 (pacing) is `todo`, yet commit `77a98ff` landed an unused library.
- YT-0100, 0130, 0131, 0132, 0150 and 0152 are `doing`, which is accurate.

## What to keep

These are good assets:

- Cerbos policies + tests + CI.
- `PdpGuard` deny-by-default + `@Authorize` + `authorized-routes.test.ts`.
- The post-read second-PDP-check pattern.
- Business module use-cases and repositories (Drizzle, neverthrow, idempotent create/invite/KYB).
- Store listing management and the two-person settlement decrease, after the rename is fixed.
- Voucher redeem, merchantauth and idempotency.
- Ledger `RecordPurchase`.
- The payments simulated driver.
- Pure web logic: `console-zone-access.ts`, the rules in `team-actions.ts`, `campaign-draft-status` / `-actions`, `question-bank-rules`, `question-pii-guard`, `merchant-redemption-errors`, `merchant-today-log` (offline queue), `merchant-qr-validation`.
- The reports "unavailable, never fabricated" discipline.
- The `resolveDataSource` seam.

## Recommended order

1. **Unbreak HEAD.** Land YT-0513 part 2 in `apps/api/modules/store` and in the `apps/web` store/wallet/burn/merchant/reports/public consumers. Gate merges on `tsc` for both apps.
2. **Real identity.** Change `PrincipalService` to read the auth-module session, load `businessRoles` from `business_members`, and delete header trust. Add `GET /api/me/businesses`.
3. **Region on business.** Add region, currency, tax-ID kind and state/postcode at creation, defaulting to `en-AU`. Drop `district` as the address model.
4. **Web BFF.** Use session cookie → server actions → `apps/api`. Flip the console zones to live one at a time. Put the console in its own business shell, not the consumer `AppShell`.
5. **Campaign authoring API.** Draft CRUD, chapters, simulated media-ingest driver, question-bank CRUD, submit → ops moderation → publish/pause, writing `reward_config` + allocation.
6. **Billing.** Simulated payment → ledger purchase route (authenticated) → allocation → campaign funding, plus a balance view.
7. **Inventory.** UI on the listing API, locations CRUD, and the price from the ledger quote rather than the client.
8. **Counter redemption.** Device provisioning from the Team zone (server-side device record, `store_device` principal, signed credential), then a BFF to voucher authorize/capture with server-side lookup by code. Add merchant credential issuance so snap-app can integrate.
9. **Minimal real reports** from `watch_session`, `question_response` and voucher captures.
10. **Redesign and i18n** of the console and merchant UI (next-intl, en-AU default).
