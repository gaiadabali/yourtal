# Consumer surfaces audit (apps/web `(app)` consumer routes)

Audited 2026-09-25 at HEAD `b225116` (branch `tasks-audit-2026-09-21`). No uncommitted changes under `apps/web` or `packages/contracts` at audit time, so HEAD is what runs.

## Verdict

**Not one consumer route reads from `apps/api`.** The whole consumer app is a mock-mode prototype. On top of that, **HEAD is broken**. The last commit, YT-0513 "part 1", renamed the money fields in the contract and says in its own message that _"apps/web and apps/api consumers follow in part 2; they do not compile yet."_ The results:

- `tsc --noEmit` on apps/web reports **35 errors**, so `next build` and the Helios release build (`.github/workflows/release.yml:70-71`) fail.
- **39 consumer unit tests fail** across 10 files (716 run).
- **Four of the nine purchase and wallet routes crash or render `NaN`** in the running app (proven below).

The journey register → region → onboard → watch → answer → earn → browse → buy → wallet → checkout has no working end-to-end path, even in mock mode:

- There is no account.
- Nothing is earned.
- A purchase mints nothing.
- The wallet shows a fixed fixture list.
- The QR is only understood by the in-browser mock merchant portal.

The Indonesian default has one root cause: `get-region.ts:11`. It is then reinforced by 24 `locale = "id-ID"` parameter defaults, 15+ route boundary files with Indonesian hardcoded in them, and a mock catalogue that is Jakarta-only for every region.

## How I checked (commands, all read-only)

- `grep -rn "fetch(" apps/web/app apps/web/features` finds **0** calls. No HTTP client, no API base URL, no `middleware.ts`/`proxy.ts`.
- `vitest run features/{onboarding,player,checkpoint,quick,campaign,store,burn,wallet,me,streak,shell,region,open-view}` gives **10 files failed / 124 passed; 39 tests failed / 677 passed.** Failures: `burn-data`, `store-burn-agreement`, `burn-flow`, `burn-summary`, `burn-errors`, `burn-redemption`, `wallet-history`, `voucher-detail-cache`, `voucher-detail-view`, and `merchant-redemption-screen` (pulled in transitively).
- `tsc --noEmit --incremental false -p apps/web` gives **35 errors**, all from the YT-0513 field rename.
- Scratch probes (vitest run from the scratchpad, importing the real repo modules and real mock catalogues):
  - `formatListingPrice(mockListings[0]...)` returns `"Worth $NaN"` (en-AU) and `"Senilai RpNaN"` (id-ID).
  - `buildWalletHistory(mockVouchers, ...)` **throws** `ZodError: expected number, received NaN`.
  - `buildCachedVoucherDetail(mockVouchers[0], ...)` **throws** `ZodError: path faceValueIdr, received undefined`.
  - `import burn-data.ts` **throws** at `burn-data.ts:50` (`listingSchema.parse` is missing `currency`, `faceValueMinor`, `settlementValueMinor` and `minimumSpendMinor`).

## Data layer: every seam is mock, and every live branch is `Promise.reject`

There are 13 data seams, all shaped as `resolveDataSource({mock, live})` (`packages/contracts/src/mock-source.ts:108,123`, default `"mock"` at `:83`):

| Seam                                   | File                                           | Live branch |
| -------------------------------------- | ---------------------------------------------- | ----------- |
| listCampaigns / getCampaign            | `features/campaign/campaign-data.ts:53-62`     | reject      |
| listListings / getListing              | `features/store/store-data.ts:49-58`           | reject      |
| getCurrentBalance                      | `features/store/store-balance-data.ts:24-29`   | reject      |
| balance / vouchers / voucher / history | `features/wallet/wallet-data.ts:68-73`         | reject      |
| getRedeemData                          | `features/burn/burn-data.ts:111-118`           | reject      |
| getCheckpointData                      | `features/checkpoint/checkpoint-data.ts:88-94` | throw       |
| listQuickCampaigns                     | `features/quick/quick-data.ts:50-55`           | reject      |
| getWatchCampaign                       | `features/player/get-watch-campaign.ts:55-60`  | throw       |

**What the API could serve today if the web called it:**

- `GET /api/campaigns` and `/:id` (`campaign.controller.ts:33,48`, Drizzle-backed)
- `GET /api/store/listings` and `/:id` (`store-catalogue.controller.ts:32,47`, public)
- `POST /api/watch/sessions`, `/:id/progress` and `/:id/complete` (`watch.controller.ts:68,125,171`)
- `POST /api/watch/sessions/:id/checkpoints/:i/token` (`checkpoint.controller.ts:57`)
- `POST /api/auth/register|login|logout|password/*` (`auth.controller.ts:59-152`, email and password, bearer token)

**What does not exist anywhere:**

- Consumer balance, the voucher list or detail, and a purchase (burn) or voucher-issue endpoint. `apps/api` has none. The ledger `GET /accounts/{id}/balance`, `/pricing/quote`, `/transfers` and `/rewards/grants` are all 501 `notYetExposed` (`services/ledger/internal/api/routes.go:80-106`). The voucher service mounts only merchant-signed `authorize/capture/void/refund` (`services/voucher/internal/redeem/routes.go:22-25`, `cmd/voucher/main.go:113-117`).
- An answer-submission endpoint. `CheckpointService.redeem` exists (`checkpoint.service.ts:96`) but no controller route calls it.
- Consent, interests, profile and streak endpoints.
- Region on the account. `RegisterDto` is only `{email, password}` (`dto/register.schema.ts:12-13`). Region lives only in a web cookie.
- Region filtering on reads. `CampaignRepository.listVisible(limit)` (`campaign.repository.ts:23`) and the store browse query take no region.
- **The earn gate itself.** `watch.controller.ts:186` hardcodes `questionsAnswered: false`, so `/complete` refuses every completion. Nobody can earn, even with perfect wiring.

The old board already admits most of this in YT-0600 "Nothing wires apps/web to apps/api" (`docs/tasks/phase-0-web.md:131-143`, `todo`, 5d). But it is scoped as "campaign, listing, wallet and watch data", while the wallet and purchase endpoints it would call do not exist. 5d is an underestimate by an order of magnitude.

## Route by route

### Shell, region and locale (`app/(app)/layout.tsx`, `features/shell`, `features/region`, `i18n/request.ts`)

**Partial.**

- The region cookie drives locale, messages and currency (`layout.tsx:44-47`, `i18n/request.ts:39-54`).
- **`DEFAULT_REGION: Region = "ID"` at `get-region.ts:11` is why the app opens in Indonesian.**
- The five-tab nav is localised (`nav-items.ts:38-44`, `messages/*/nav.json`).
- There is no auth gate: `app/(app)/page.tsx` renders the Earn board to any visitor, with no redirect to onboarding.
- `(app)` also hosts `/business/*`, so the business console inherits the consumer bottom nav (out of scope, noted).
- Nested `<main>`: `app-shell.tsx:27` wraps pages that render their own `<main>` (`watch/page.tsx:28`, `checkpoint/page.tsx:26`, `redeem/page.tsx:51`).

### `/onboarding` (region picker)

**Works (cookie only).**

- `region-picker.tsx:33-75` uses a Server Action (`commit-region-action.ts:120-144`) to set the httpOnly cookie `yourtal-region` and redirect to consent.
- Copy is bilingual side by side (`region-picker.tsx:37-47,65`), because the layout has already defaulted to id-ID before any choice (`<html lang>` comes from the ID default).
- It shows a hardcoded money "Example reward": A$12.50 / Rp45.000 (`region-option.ts:186,192`). That contradicts the founder's "no hardcoded magnitude" and "reward is points".

### `/onboarding/[region]/consent`

**Fixture-only.** Three unticked purposes, done well (`consent-form.tsx:55-111`), but saved only to `localStorage` (`onboarding-local-store.ts:166-183`). Nothing reaches `packages/consent` or the API.

### `/onboarding/[region]/verify`

**Stub, and the wrong mechanism.**

- Phone OTP with a demo code, `DEMO_OTP_CODE = "123456"` (`otp-mock-service.ts:13`), and a simulated 500 ms network (`:29`).
- No account is created. The founder's decision is email and password, and `/api/auth/register` exists but is never called.

### `/onboarding/[region]/interests`

**Fixture-only.** Saved to `localStorage` (`interest-picker.tsx:71`) and read by nobody for ranking. `campaign-sort.ts:42-48` sorts only by value, reward, duration or newest.

### `/onboarding/[region]/done`

**Partial.** It shows the country and currency, plus a hardcoded example reward in money (`done/page.tsx:22,46-49`). The CTA goes to `/` or `returnTo` (`:57`). Nothing marks the user as onboarded.

### Account, login, session, logout

**Missing.** There is no `/login` or `/register` route, no session cookie, and no bearer token handling in web. `/me` has no logout or password change, even though the API has both.

### `/` Earn board

**Fixture-only, renders.**

- Data: `listCampaigns()` from the mock catalogue (`campaign-data.ts:29-33`).
- Loading: yes (`(app)/loading.tsx`, in-page `Suspense` at `page.tsx:32-34`). Empty: yes. Error: yes, but **hardcoded Indonesian** (`(app)/error.tsx:28-29`).
- Every campaign comes from the Jakarta roster (`campaign.mock.ts:87` `pickMockMerchant(faker, "ID")`), so AU users see Indonesian merchants and titles.
- Cards are text-only, four fixed rows (`campaign-card-layout.tsx`). There is no image field in the `Campaign` or `Listing` contract.

### `/campaign/[campaignId]` entry card

**Fixture-only, renders.**

- Error and not-found text is hardcoded Indonesian (`error.tsx:20-21`, `not-found.tsx:8-14`).
- **The "contract screen" computes the base/bonus split from a hardcoded `BASE_REWARD_RATIO = 0.6`** (`campaign-reward-split.ts:17`). The funded contract is absolute amounts, `rewardPointsPerCompletion` + `accuracyBonusPoints` (`packages/contracts/src/campaign/campaign-reward-config.ts`). So the terms shown are not the terms the backend would honour.

### `/watch/[campaignId]` player

**Fixture-only.**

- No call to `/api/watch/sessions`. Accrual is computed client-side from back-loaded chapter weights (`use-watch-session.ts:282-288`), which contradicts O-1's single grant.
- **Every campaign plays the same 20-second fixture at a loopback URL**, `http://127.0.0.1:26900/.../attention-30s/index.m3u8` (`campaign.mock.ts:48-49`), stretched to the advertised 5-30 min by `time-remap.ts`. The Helios release ships only the web tarball (`release.yml:70-88`), so on any device but the dev box the video cannot load.
- `HlsAttacher`'s `onFatalError` is never passed (`video-player.tsx:61-65`), so a failed stream is a silent black box. There is no video error state.
- The route never 404s. Any id synthesizes a campaign (`get-watch-campaign.ts:45-53`).
- Copy is **hardcoded English and not localised** (`accrual-indicator.tsx:51,71-73`, `completion-handoff.tsx:30-35`, `resume-prompt.tsx:34`). Points still format as id-ID because the player never passes `locale` (`video-player.tsx:76-81,108`, defaults at `accrual-indicator.tsx:41`, `completion-handoff.tsx:23`). The result is sentences like "Reward if you finish 1.200 poin".
- `watch/error.tsx` is English-only.

### `/watch/[campaignId]/checkpoint`

**Fixture-only, and it dead-ends.**

- Questions come from `generateQuestions`, with **Indonesian prompts for every region** (`question.mock.ts:29,40,49,65,75`).
- **The full answer key ships to the browser**: the `Question` type carries `correctOptionId`/`correctAnswer`, and scoring runs client-side (`checkpoint-data.ts:77-85`, `checkpoint-scoring.ts:50`). `presented-question.ts` exists to fix this and is unused by the web.
- The route is reachable without watching anything, and synthesizes for any id (`checkpoint-data.ts:56-59`).
- The UI asks all questions after the video. The API model is PRF-scheduled mid-video checkpoint tokens (`checkpoint.controller.ts:103-117`). These are two incompatible designs.
- The result card has **no next action** (`checkpoint-result.tsx:40-92`). It says "Guaranteed for watching and answering" (`messages/en-AU/checkpoint.json:6`) while the server refuses every completion.
- Error and loading text is hardcoded Indonesian (`checkpoint/error.tsx:28-34`, `loading.tsx:7`).

### `/quick`

**Fixture-only, renders.**

- Not a video feed: text cards in a snap viewport that link to the long-form player (`quick-feed-card.tsx:27`, "DELIBERATELY NOT A VIDEO PLAYER").
- There is no route `error.tsx`. It inherits `(app)/error.tsx`, titled "Papan earn gagal dimuat" ("Earn board failed to load").

### `/store`

**Broken at HEAD (renders NaN), fixture-only.**

- `store-listing-card.tsx:35` reads the removed `listing.faceValueIdr`. Probe: every card shows "Worth $NaN" or "Senilai RpNaN".
- Structural bug that survives the rename: `store/page.tsx:36,45` passes the **viewer's region currency**, not `listing.currency`. An AU viewer would see IDR sen labelled AUD (Rp180.000 becomes "$180,000.00").
- All 30 listings are IDR/Jakarta (`listing.mock.ts:28,68`). The AU fixtures in `packages/contracts/src/region/region.mock.ts:62-104` are used only by the public SEO pages.
- Error text is hardcoded Indonesian (`store/error.tsx:29-30`).

### `/store/[listingId]` offer detail

**Broken at HEAD (NaN face value and minimum spend), fixture-only.**

- `store-offer-card.tsx:42,74` reads removed fields.
- The balance is a fixed fixture of 8,400 points (`store-balance-data.ts:21`).
- Not-found and error text is hardcoded Indonesian.

### `/store/[listingId]/redeem` burn flow

**Broken at HEAD: the module throws at import** (`burn-data.ts:50-75`, `holdbackDemoListing` still uses `faceValueIdr: rupiah(...)`). Every request hits `redeem/error.tsx`.

Even when fixed, the purchase is a simulation:

- `attemptBurn` (`burn-redemption.ts:56-80`) mints a mock code, debits nothing and creates no voucher.
- "View in wallet" (`burn-flow.tsx:160`) leads to the fixed fixture list, so **the bought voucher never appears**.

Hardcoded Indonesian: page title and heading "Tukar Poin" (`redeem/page.tsx:24,53`) and the live-region announcements (`use-price-lock-countdown.ts:24-32`).

### `/wallet`

**Broken at HEAD: throws.** `listWalletHistory` calls `buildWalletHistory`, where `pointsPriceFromSettlement(voucher.faceValueIdr)` is `NaN` and the Zod check throws (`wallet-history.ts:52`). The page shows "Wallet gagal dimuat" (`wallet/error.tsx:19-23`). Its data is a fixed fixture balance plus 17 fixture vouchers (`wallet-data.ts:34-59`). Even fixed, `wallet-voucher-card.tsx:66` formats with the region currency.

### `/wallet/voucher/[voucherId]` (the "show at checkout" screen)

**Broken at HEAD: throws.** `buildCachedVoucherDetail`'s Zod schema requires `faceValueIdr`/`remainingValueIdr` (`voucher-detail-cache.ts:80-81,126-127`).

- The QR is a client-side FNV hash, `YT1.<id>.<window>.<hash>` (`voucher-qr-rotation.ts:62-64`). It is explicitly not the Ed25519-signed QR from docs/09 §8.3.
- The only thing that parses it is the in-browser mock merchant portal (`features/merchant/merchant-qr-validation.ts:44`). The voucher service does not.

### `/me`

**Fixture-only, renders.**

- Consent, interests, passkey and delete are all `localStorage` (`me-consent-store.ts`, `me-security-store.ts:22-51`, `me-interests-store.ts`).
- The passkey is labelled "(demo)" (`messages/en-AU/me.json:43-47`), and passkeys are not the founder's auth model.
- Language is read-only and locked to region (`me-language-section.tsx:10-24`), so an ID user cannot choose English.
- No logout or password change.
- No route error or loading boundary; it inherits the "Earn board failed" copy.

### Streak card (on `/`)

**Fixture-only.** It stores to `localStorage` (`streak-state.ts:23-59`) and uses **hardcoded point magnitudes `[10,15,20,25,30,40,75]`** (`streak-schedule.ts:33`). Its copy says "Credited by YourTal's daily reward pool" (`messages/en-AU/streak.json:12`), but nothing is credited.

### Open View (public `/[locale]/c/[id]/watch` → sign-up → back)

**Partial, with an honesty bug.** Sign-up returns to `/watch/<public-id>` (`open-view-signup-href.ts:16`). The public campaigns are seeded 9_300/9_400 (`region.mock.ts:78,82`) while the app catalogue is seeded 1_000 (`campaign.mock.ts:166`). So the app **synthesizes a different campaign**, with a different merchant, title and reward, for the id the viewer just watched (`get-watch-campaign.ts:45-53`).

## English-default inventory (what "make it English" actually touches)

1. `features/region/get-region.ts:11`: the default region is `"ID"`. The docs say AU is primary.
2. `packages/contracts/src/money/money-format.ts:107`: `formatPoints(..., locale = "id-ID")`.
3. 24 feature defaults of `locale = "id-ID"`, each a silent Indonesian fallback when a caller forgets the argument:
   - `campaign-scoring-copy.ts:18,36`
   - `accrual-indicator.tsx:41`, `completion-handoff.tsx:23`
   - `quick-feed-label.ts:27`
   - `listing-locations.ts:38,53`, `store-facets.ts:36,46`, `store-format.ts:40,63,85`, `store-redemption-policy.ts:25,59,90`
   - `wallet-format.ts:39,53`, `wallet-history.ts:77`, `wallet-voucher-status-copy.ts:95`

   These should become required parameters so a forgotten locale fails at compile time.

4. Hardcoded Indonesian in route boundaries:
   - `(app)/error.tsx:28-29`
   - `campaign/[campaignId]/error.tsx:20-21`, `not-found.tsx:8-14`
   - `store/error.tsx:29-30`, `store/[listingId]/error.tsx:20-21`, `not-found.tsx:8-14`
   - `redeem/error.tsx:20-25`, `redeem/loading.tsx:7`, `redeem/page.tsx:24,53`
   - `wallet/error.tsx:19-23`, `wallet/voucher/[voucherId]/error.tsx:19-23`, `not-found.tsx:8-14`
   - `watch/[campaignId]/checkpoint/error.tsx:28-34`, `loading.tsx:7`
   - Bilingual: `onboarding/error.tsx:20-25`, `onboarding/[region]/not-found.tsx:8-15`
   - Features: `features/burn/use-price-lock-countdown.ts:24-32`
5. Hardcoded English that is not localised at all: the player (see above) and `watch/error.tsx`.
6. Mock content is Indonesian for every region: the merchant roster call `pickMockMerchant(faker,"ID")` in `campaign.mock.ts:87`, `listing.mock.ts:28` and `voucher.mock.ts:23`; the Jakarta districts and branch labels (`internal/jakarta.ts`); the question prompts (`question.mock.ts`); and `holdbackDemoListing` (`burn-data.ts:53-55`).
7. **7 e2e files assert Indonesian copy**: `spend-journey.spec.ts:85,99-101`, `earn-journey`, `open-view-journey`, `overflow-320`, `redeem-journey`, `keyboard-seek` and `find-bonus-accuracy-campaign`. Flipping the default breaks them unless they are updated in the same change.
8. Product gap: display language is welded to region (`region-config.ts:73-76`, `me-language-section.tsx:10-24`). "English by default" for Indonesian users needs a separate display-language field.

## Loading, empty and error coverage

| Route                    | loading        | empty                               | error                                           | not-found         |
| ------------------------ | -------------- | ----------------------------------- | ----------------------------------------------- | ----------------- |
| `/`                      | yes            | yes                                 | yes, ID-hardcoded                               | n/a               |
| `/campaign/[id]`         | yes            | n/a                                 | yes, ID-hardcoded                               | yes, ID-hardcoded |
| `/watch/[id]`            | yes            | n/a                                 | yes, EN-only; **no video-failure state**        | **never 404s**    |
| `/watch/[id]/checkpoint` | yes, ID        | 0 questions goes straight to result | yes, ID                                         | **never 404s**    |
| `/quick`                 | yes            | yes                                 | **inherits "Earn board failed"**                | n/a               |
| `/store`                 | yes            | yes (filter-aware)                  | yes, ID                                         | n/a               |
| `/store/[id]`            | yes            | n/a                                 | yes, ID                                         | yes, ID           |
| `/store/[id]/redeem`     | yes, ID        | n/a                                 | yes, ID (currently the **only** thing it shows) | inherits parent   |
| `/wallet`                | yes            | yes                                 | yes, ID (currently **what it shows**)           | n/a               |
| `/wallet/voucher/[id]`   | yes            | n/a                                 | yes, ID (currently **what it shows**)           | yes, ID           |
| `/me`                    | inherits group | n/a                                 | **inherits "Earn board failed"**                | n/a               |
| `/onboarding/*`          | **none**       | n/a                                 | bilingual                                       | bilingual         |

Also missing: an "API unavailable" state distinct from "no results". This is YT-0600's criterion 4, and it cannot exist until there is an API call to fail.

## UI and design notes (evidence for "AI slop")

- **No imagery anywhere.** `Campaign` and `Listing` have no image or thumbnail field, and no consumer card renders `<img>` or `next/image`.
- Cards are four fixed-height text rows (`campaign-card-layout.tsx`).
- The palette is stock: grey `--color-surface: #f3f4f6`, heavy mid-grey borders `#888e94`, generic indigo primary `#3548c4` (`packages/ui/src/styles/tokens.css`). There is one font (Plus Jakarta Sans, `root-document.tsx:46`).
- Disclaimers take over the screen: the player shows a full sentence under the progress bar (`accrual-indicator.tsx:71-73`), and the region picker is four paragraphs of stacked bilingual text (`region-picker.tsx:37-47`).
- There is no merchant branding, no reward animation or moment, and no hero content.
- Onboarding hides the nav with a `fixed inset-0 z-50` overlay (`onboarding/layout.tsx:28-33`). The shell nav is still in the DOM and in the keyboard tab order.
- The bones are good and worth keeping through a redesign: layout-shift discipline (skeleton parity tests), 320px and 200% zoom e2e, safe-area handling, a11y roles.

## What to keep

- The `resolveDataSource` seam and its fail-loud live branches. They make the wiring a per-module swap.
- The honesty-first copy discipline, O-1/O-5 comments and discriminated-union flows: the burn flow state machine, the phone reducer, the price-lock re-check.
- Player engineering: seek coalescing (`use-watch-session.ts:149-243`), coverage tracking, the tab-visibility pause, resume position.
- The next-intl catalogue parity test (`messages/messages-parity.test.ts`) and the per-feature message JSON.
- The AU region fixtures (`packages/contracts/src/region/region-mock-au-*.ts`). They are already built; the consumer app just does not use them.
- The consent-form structure (per-purpose, unticked), the wallet offline cache pattern and the voucher QR rotation mechanics.
