# YourTal — SnapApp's receipt package: receipt points paid by the partner, at cost

**Date:** 2026-10-21 · **Status:** Agreed. Designed for group task 2.10.b (YourTal 14.14.b–c), reviewed by the group lead; the founder answered the four open questions on 2026-10-21 (F127).
**Builds on:** F119–F122 (receipt points, who pays, packages and tiers), F101 (superseded for receipts), F104 (ID is a demo), F106 (payment simulation), F117 (partner link defaults), K6 (backing), F54 (B stays off the wire).
**Feeds:** group 2.10.c (SnapApp buys its first package and shows "receipt points paused"), 2.9.c–d (staff view, tests).

Until now a receipt a partner reports was paid from YourTal's own marketing budget. From this change, the partner's business pays for its receipt points in advance, by buying a **receipt package** at cost. A receipt draws its points from that package; when every package is used up, receipts stop earning and the partner API says so.

## 1. Decisions (F127, founder 2026-10-21)

| Question                              | Answer                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Price                                 | The **tier sizes** (1,000 / 10,000 / 50,000 points) at **exactly B = 3c a point, no volume discount**: A$30 / A$300 / A$1,500 ex-GST (A$33 / 330 / 1,650 with GST). ID demo: IDR 6,000 / 60,000 / 300,000, no tax. A discount below B would leave points unbacked (K6). |
| B visible to the partner              | **Allowed for the receipt funder only.** Its owner and finance members see the at-cost prices in Studio and on invoices. No other business can see or buy receipt packages, and no API field is named after the rate.                                                   |
| Per-person receipt limit              | **Removed.** The ledger's 10-receipts-a-person-a-day limit goes; only the general daily and monthly earn caps apply. A receipt needs a paid scan (about 9c) to earn a 3c point, so farming loses money.                                                                 |
| Receipts while the package is used up | **They never earn.** The partner's outbox treats `allocation_exhausted` as final; the 50% and 80% alerts give time to buy more, and the partner shows "receipt points paused".                                                                                          |

## 2. Today's path (before this change)

- `POST /api/partners/actions` (`apps/api/src/modules/partners/partner-actions.controller.ts`) → `grant-partner-action.use-case.ts`. It claims `(partner, externalRef)` in `platform.partner_receipt`; a receipt first claimed for another user answers `200 {granted:false, points:0, duplicate:true}`. Otherwise it calls the ledger's `grantAction({kind:"receipt", …})` with the idempotency key `sha256("partner_receipt:<partnerId>:<externalRef>")`. The partner id is **not** sent to the ledger.
- The ledger (`services/ledger/internal/reward/contract.go` `GrantAction` → `contractGrant` → `engine.go` `issue`) draws from `alloc_marketing_<R>`, backs the grant with marketing cash moved into the reserve, and posts Dr marketing_expense / Cr user.pending. Receipts are `MarketingFunded` in `taxonomy.go`, which also gives them a 10-a-person-a-day count.
- Refusals reach the partner as `409 {code}`: `velocity_capped`, `insufficient_available`, `solvency_blocked`, `allocation_exhausted`. SnapApp treats all four as final.
- 14.13's packages: tiers come from the region setting `point_package_tiers`; `pricing/tiers.go` refuses any tier under B; `RecordPurchase` (`reward/purchase.go`) refuses `AmountMinor < price`; a package becomes a `partner` allocation the business can fund campaigns from. Alerts at 50/80/100% run every 2 minutes (`billing/alerts/`).
- Nothing ties a partner to a business. SnapApp's businesses exist in the staging seed (`Snap App Pty Ltd` …0001 AU, `PT Snap App Indonesia` …0002 ID).

## 3. Design

### 3.1 Data model

- A **receipt package** is a `partner` allocation (`funder_id` = the buying business) plus a row in a new table `ledger.receipt_package (allocation_id PK, purchase_id unique, funder_id, region, rate_id, created_at)`, written in the purchase's transaction and never changed.
- The **receipt funder** is a region setting `receipt_funder.<partnerId>` = `{"businessId":"<lowercase uuid>"}`, one per partner per region, proposed by finance and approved by a second person (the existing two-person rule and audit). Staging and dev seed `receipt_funder.snap-app` → …0001 (AU) and …0002 (ID) the way `ensureDemoInvoiceIssuer` works (never overriding an approved row). Production gets nothing until finance names the real business.
- Validation when the setting is proposed or approved: the partner exists; the business exists, is verified and is in the same region. `receipt_points` must divide 1,000.

### 3.2 The at-cost purchase

- Studio, funder only: `POST …/studio/billing/purchases {tierKey, currency, programme:"receipts"}`. A business that is not a funder gets 404 `not_a_receipt_funder` before any checkout. The card purchase row carries `programme='receipts'`; checkout and the webhook are unchanged; the ledger's `purchasePoints` gets `programme:"receipts"`.
- The ledger's `purchasePrice` gains one branch, only for `programme = receipts`: the business must be the approved funder in this region (else `ErrNotReceiptFunder` → 400 `refused`), `tierKey` is required and points must equal that tier's size, and `price = ceil(points × B in force)`. Every other purchase is unchanged.
- **K6:** the whole ex-GST payment enters the reserve when the package is bought, before any of its points exist. Each receipt issues p points backed at exactly B. A fully spent package has added `ceil(N × B)` to the reserve and N × B to liabilities: coverage 1.0 for that slice, the K6 floor, the same backing today's marketing-funded receipts have. A deferred trigger on `ledger.receipt_package` refuses any package whose purchase paid less than points × B at its own rate, so the floor holds even if the Go code is wrong.
- Invoices (14.9) need no new job; the line reads "1,000 YourTal points for receipt rewards".

### 3.3 Paying a receipt from the package

- The API sends `partnerId` with every receipt grant.
- `contractGrant`'s replay lookup still runs first, so a receipt that was paid replays its first grant before funding is looked up: **a duplicate stays a duplicate after the package is spent.** For receipts only, the same key answers the first grant even if `points` differ (no `idempotency_conflict` after a rate change).
- In `issue`, after the caps and inside the same SERIALIZABLE transaction, a new `drawReceipt` (`reward/receipts.go`) reads `receipt_funder.<partnerId>` for the region, lists the funder's receipt packages with room (oldest first), and holds and consumes from the first that fits. A grant is never split. No setting, no package or no room → `ErrAllocationExhausted` → 409.
- Receipts become `MarketingFunded = false` (`TaxonomyVersion` 2): they post Dr points_issued / Cr user.pending (`GrantPartner`), with no marketing cash and no solvency pause. The 10-a-day receipt count is removed (F127).
- A receipt grant without `partnerId` is refused. The campaign paths (`campaignGrant`, `HoldForCampaign`, `Hold`) refuse a receipt package; a trigger on `ledger.grant` is the backstop (a `receipt_scanned` grant must come from a package, and no other grant may).

### 3.4 Partner API

- `POST /api/partners/actions` keeps its shape. Paused: `409 {"code":"allocation_exhausted","message":"receipt points are paused: the receipt package is used up","linkId":"…"}`. The API replaces the ledger's message so no ledger or business ids leak.
- New `POST /api/partners/receipts/status` (partner HMAC, not value-moving, 60/min): `{"region":"AU"}` → `200 {"region":"AU","earning":true,"pointsPerReceipt":1,"remainingPoints":412}`. `earning` is true when a package has room for one receipt.
- No webhook: YourTal has no outbound partner channel; the partner polls the status read.
- `docs/developers/partner-api.md`: 1 point in AU and 10 in ID; receipt packages; the status read; the error table split (`allocation_exhausted` = paused, nothing paid; `insufficient_available` and `solvency_blocked` not expected for receipts); the per-day limit sentence removed.

### 3.5 Studio and alerts

- `GET /api/:tenantId/studio/billing/receipt-programme` (billing `view`), 404 for any business that is not a funder: `{partners, pointsPerReceipt, earning, remainingPoints, packages[] with pricing:"at_cost"}`. A "Receipt rewards" panel on Billing for the funder only.
- Balance totals leave receipt packages out. The campaign-funding list hides them, and a reward config naming one is refused with `allocation_not_campaign_funding`.
- 14.13.b's alerts run per package with `programme='receipts'` and receipt wording to the funder's owner and finance. At 100% the wording says receipts stopped when no other package has room, or names the next package when one does.

### 3.6 Migrations (add-only)

- **A:** `ledger.receipt_package` with its deferred trigger and grants (`yourtal_ledger` SELECT, INSERT; `yourtal_app` nothing); `platform.ledger_setting` view also returns `receipt_funder.*`; `programme` columns on `payment.card_purchase` (with "programme needs a tier"), `payment.budget_alert` and the fake allocation table.
- **B (the switch):** the `ledger.grant` trigger. Historical rows are untouched.

### 3.7 Wire changes

`/v1/actions/grants` gains `partnerId` (required for receipts); `/v1/allocations/purchase` gains `programme`; allocation views gain `programme`; the package quote gains `programme` and `businessId`, and tier views gain `pricing: "tier" | "at_cost"`; new `/v1/pricing/receipt-package-tiers {region, businessId}`. New answer fields use `.default()` so an older ledger's answer still parses. No property is named after the rate.

## 4. Rollout: every push to `main` deploys

The Go ledger refuses unknown fields, and pm2 reloads the api before the ledger, so the order matters:

1. T3a and T1.
2. T2a (the ledger also _accepts_ `partnerId`), then T8.
3. T3b (the API starts sending `partnerId`; the ledger still pays from marketing).
4. T5, T5b and T6, then T7.
5. **Buy the first AU and ID receipt packages on staging** (§5 Phase A).
6. **T2b, the switch.** If it ships before a package exists, every receipt is refused, and the partner drops them for good.
7. T4, then T9.

## 5. Staging check (T9, `scripts/check-2.10b-receipt-package.mjs`)

- **Phase A** (after step 4): the staff settings screen shows `receipt_funder.snap-app`; as the AU owner, Studio → Billing → Receipt rewards shows A$30 + A$3.00 GST, A$300 + GST, A$1,500 + GST, and a brand that is not a funder gets no panel and 404; buy the AU Starter with 4242 → paid, allocation `programme` receipts with 1,000 points, invoice line correct; buy the ID Starter for IDR 6,000.
- **Phase B** (after T2b): status AU `earning:true, remainingPoints:1000`; set AU `receipt_points` to 100 (two people) for the drain; three linked demo adults send 5 + 3 + 2 receipts → the 50%, 80% and 100% alerts once each with the receipt wording; a fourth receipt → `409 allocation_exhausted`, status `earning:false`; a replay of a paid receipt → `200 {granted:true, duplicate:true}`; one first reported for another user → `200 {granted:false, points:0, duplicate:true}`; restore `receipt_points` to 1, buy a second Starter, and a new receipt earns 1 point. Run it while staging is quiet (any real scan during the drain earns 100 points).

## 6. Tickets

| Ticket                                                           | Owner model     | Owns                                                                                                                                                                                                                                       | Needs                                           |
| ---------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| **T1** Schema and queries (money core)                           | senior-db, Opus | migration A + `atlas.sum`, `services/ledger/db/schema.sql`, `db/query/ledger.sql` (insert, is-package, packages-with-room ordered oldest first, `is_receipt_package` on allocation reads), regenerated sqlc, `receipt_package_db_test.go`  | —                                               |
| **T2a** At-cost purchase (money core)                            | senior-be, Opus | `pricing/atcost.go`, `settings.IsReceiptFunderIn`, `reward/purchase.go` + `purchase_atcost_test.go`, `contract.go` (only `PurchasePoints` and `ActionRequest.PartnerID`), `api/{funding,package,earning}_routes.go`, `routes.go` error map | T1                                              |
| **T2b** Receipt draw, the switch (money core)                    | senior-be, Opus | `reward/receipts.go` + tests, `engine.go`, `holds.go`, `budget.go`, `terms.go`, `taxonomy.go`, `contract.go` (only `GrantAction`, `contractGrant`), migration B                                                                            | T1; merge after T2a, T3b and the first packages |
| **T3a** Contracts                                                | medior, Sonnet  | `packages/contracts` (`rewards.ts`, `funding.ts`, `pricing.ts`, `billing/billing.ts`, `device/partner-action.ts`, new `billing/receipt-funder.ts`)                                                                                         | —                                               |
| **T3b** Fake ledger, HTTP client, partner call (money semantics) | senior-be, Opus | `apps/api/src/shared/ledger-client/**` and its contract spec, `grant-partner-action.use-case.ts` (send `partnerId`), `partner-e2e-kit.ts` (`fundReceipts`)                                                                                 | T3a, T1; merge after T2a deploys                |
| **T4** Partner status read, wording, guide                       | medior, Sonnet  | partners controller or `partner-receipts.controller.ts`, `receipt-status.use-case.ts`, `to-http-exception.ts`, `partner-receipt-package.e2e.test.ts`, route registry + OpenAPI, `docs/developers/partner-api.md`                           | T3b (live: T2b)                                 |
| **T5** Studio billing API and invoices                           | medior, Sonnet  | `apps/api/src/modules/billing/**` except `alerts/**`, `packages/db/src/invoicing/{sources,format}.ts`, billing route registry                                                                                                              | T3a, T3b                                        |
| **T5b** Campaign funding guard                                   | junior, Haiku   | `studio/campaign-funding.controller.ts`, `set-reward-config.use-case.ts`, `studio.errors.ts` and its HTTP mapping                                                                                                                          | T3a, T3b                                        |
| **T6** Receipt package alerts                                    | medior, Sonnet  | `billing/alerts/**`, `budget-alerts.e2e.test.ts`                                                                                                                                                                                           | T1, T3a, T3b                                    |
| **T7** Studio web panel                                          | medior, Sonnet  | `apps/web/features/studio/billing/**` (`receipt-programme-panel.tsx`), the Billing page, en-AU and id-ID messages                                                                                                                          | T5, T6                                          |
| **T8** Funder setting validation and demo seed                   | medior, Sonnet  | `staff/economy/setting-validation.ts` + call sites, `packages/db/src/seed/demo-receipt-funders.ts`, `main-staging.ts`, `seed.ts`                                                                                                           | T3a                                             |
| **T9** Staging check                                             | qa, Sonnet      | `scripts/check-2.10b-receipt-package.mjs`                                                                                                                                                                                                  | all merged and deployed                         |

Shared files: `reward/contract.go` (T2a and T2b edit separate functions); the generated `yourtal.openapi.json` (T4 and T5; whoever merges second regenerates it).

## 7. Risks

- **Reload window** (unknown fields to an old ledger): follow §4.
- **A gap before the first package** drops receipts for good: buy first, then switch.
- **B rises:** at-cost points carry no spread; the 1.2 coverage alert and the two-person rule on rate changes cover it, as for today's receipts.
- **A hot row:** every receipt updates the same package row; the SERIALIZABLE retry absorbs it, as for the marketing allocation today.
- **A wrong funder setting:** the wrong business could buy at cost, but those packages fund only receipts, behind two-person approval and validation.
- **Card fees on at-cost sales** come out of YourTal's own money once real payments start (6.8).
- **The ledger still trusts the API's `points` for receipts,** as today (optional hardening: compare with `receipt_points`).
