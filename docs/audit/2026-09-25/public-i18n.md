# Audit: public-i18n (language/region default + public surface)

Audited 2026-09-25 against HEAD `b225116` on branch `tasks-audit-2026-09-21`. Read-only. Nothing in apps/web was dirty in the shared tree. Commands I ran: `tsc --noEmit --incremental false` on apps/web (the tsbuildinfo was not modified), `vitest run` on features/public, features/region, messages and region-option, plus node scripts in the scratchpad for catalogue parity and string scanning.

## Headline

1. **Why the app defaults to Indonesian: one line.** `apps/web/features/region/get-region.ts:11` has `const DEFAULT_REGION: Region = "ID";`. When there is no `yourtal-region` cookie, `getRegion()` returns "ID" (line 37). The cookie is written only by the onboarding region picker (`features/onboarding/commit-region-action.ts:61`). The fallback then spreads to four places:
   - `i18n/request.ts:40`, which picks the next-intl catalogues.
   - `app/(app)/layout.tsx:46-55`, which sets `<html lang>` and `RegionProvider`.
   - Every page that calls `getRegionDisplayConfig()`, for example `app/(app)/page.tsx:45`.
   - Every client leaf, through `useRegion()`.

   No middleware or `proxy.ts` exists, nothing reads `Accept-Language`, and next-intl routing has no `defaultLocale`. A new visitor at `/` always gets `id-ID` and IDR.

2. **Flipping that line is not enough.** These also force Indonesian:
   - About 57 hardcoded Indonesian-only strings in 22 files ignore the locale entirely, including the home Earn board's filter and sort controls and most error, not-found and loading boundaries.
   - 22 formatter or component parameters default to `"id-ID"` or `"IDR"`.
   - `(merchant)/layout.tsx:44` hardcodes `lang="id-ID"`.
   - The player never passes a locale (`features/player/video-player.tsx:76,108`), so every user sees "1.250 poin" inside English sentences.
3. **The other direction is also broken: Indonesian is not fully available.** Neither the business console (47 components, 0 translator calls) nor the player (10 components) has any copy layer. Both are English-only. A heuristic scan finds at least 111 hardcoded English UI strings in 52 files.
4. **Catalogue key parity is perfect** (298/298 keys, 0 missing), but the JSON catalogues cover only part of the UI. The app runs **four parallel i18n mechanisms**:
   - the next-intl provider (6 namespaces);
   - 10 per-feature `createTranslator` wrappers;
   - TypeScript copy modules (onboarding, merchant, provisioning);
   - inline `locale === "id-ID" ? ... : ...` ternaries.
5. **apps/web does not compile at HEAD.** `tsc` reports 35 errors. Commit `b225116` (YT-0513 part 1) renamed `faceValueIdr` to `faceValueMinor` in contracts, and its own message says "apps/web and apps/api consumers follow in part 2; they do not compile yet." On the public surface this is live breakage: every voucher's "Worth" renders **`RpNaN`** and JSON-LD `price` is **`"NaN"`**. Two public unit tests fail and show it (`public-reward-facts.test.ts:41`, `public-jsonld.test.ts:36`).
6. **The public surface is fixture-only and static.** It never calls the API. Open Viewing cannot play for any real visitor, because every campaign's manifest is `http://127.0.0.1:26900/...` (`packages/contracts/src/campaign/campaign.mock.ts:48-49`), baked into static pages. That points at the visitor's own machine, over http, from an https page.
7. **The board overstates these tickets.** YT-0405 is marked `done` (`docs/tasks/phase-u-ui.md:75`), while its own body says "It is still not `done`". YT-0431 and YT-0432 are marked `done` despite points 5 and 6.

---

## Part A: language and region default

### A.1 Root-cause chain

| #   | File:line                                                               | What it does                                                                          |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | `features/region/get-region.ts:11,37`                                   | `DEFAULT_REGION = "ID"`, returned when the cookie is missing or invalid               |
| 2   | `i18n/request.ts:40`                                                    | `locale` comes from `getRegionDisplayConfig()`, which gives `id-ID`                   |
| 3   | `app/(app)/layout.tsx:46-48,55`                                         | `lang={locale}`, `RegionProvider region=ID`, next-intl messages in id-ID              |
| 4   | `features/region/region-config.ts:26-29`                                | ID maps to `id-ID`/`IDR`. The table is correct; it is simply selected by the fallback |
| 5   | `app/(merchant)/layout.tsx:44`                                          | `<RootDocument lang="id-ID">`, hardcoded; the doc comment at lines 13-33 admits it    |
| 6   | no `middleware.ts`/`proxy.ts`; grep for `accept-language` finds nothing | No first-visit negotiation                                                            |
| 7   | `app/(app)/page.tsx` is `/`                                             | The root URL is the private consumer Earn board, not a public chooser                 |
| 8   | `features/region/region-cookie-roundtrip.test.ts:39-46`                 | The test pins `expect(await getRegion()).toBe("ID")`                                  |

### A.2 Every change needed for "English (en-AU) and AUD by default, region selectable, Indonesian fully available"

1. **Flip the default.** In `get-region.ts:11`, change `"ID"` to `"AU"`. Update the doc comments at `get-region.ts:21-24` and `(app)/layout.tsx:24-26`, and the test at `region-cookie-roundtrip.test.ts:24-46`: the "non-default" case becomes ID and the fallback case becomes AU.
2. **Remove the 22 `id-ID`/`IDR` default parameters.** Make them required so a missing locale is a type error, not a silent "Rp". The sites:
   - `packages/contracts/src/money/money-format.ts:107` (`formatPoints`, used everywhere);
   - `features/campaign/campaign-scoring-copy.ts:18,36`;
   - `features/player/accrual-indicator.tsx:41` and `completion-handoff.tsx:23`;
   - `features/quick/quick-feed-label.ts:27`;
   - `features/store/listing-locations.ts:38,53`, `store-facets.ts:36,46`, `store-format.ts:40,41,63,85`, `store-redemption-policy.ts:25,59,60,90`;
   - `features/wallet/wallet-format.ts:39,53`, `wallet-history.ts:77`, `wallet-voucher-status-copy.ts:95`.
3. **Pass the locale in the player.** `features/player/video-player.tsx:76-81` (`<AccrualIndicator>`) and `:108` (`<CompletionHandoff>`) omit `locale`, so they fall back to `id-ID`: "You watched the whole video. 1.250 poin pending…" (`completion-handoff.tsx:29-33`).
4. **Move the locale-agnostic Indonesian strings into catalogues** (about 57 strings in 22 files):
   - Earn board: `features/campaign/campaign-sort.ts:17-20` ("Nilai terbaik", "Reward tertinggi", "Durasi tersingkat", "Terbaru"), `campaign-filter.ts:32-34` ("Semua", "Video panjang", "Cepat"), `campaign-board-controls.tsx:49` (aria "Filter jenis campaign") and `:78` ("Urutkan").
   - Error boundaries: `app/(app)/error.tsx:28-29`, `campaign/[campaignId]/error.tsx:20-21`, `store/error.tsx:29-30`, `store/[listingId]/error.tsx:20-21`, `store/[listingId]/redeem/error.tsx:20,23,25`, `wallet/error.tsx:19,21,23`, `wallet/voucher/[voucherId]/error.tsx:19,21,23`, `watch/[campaignId]/checkpoint/error.tsx:28,30-32,34`.
   - Not-found pages: `campaign/[campaignId]/not-found.tsx:8,10,14`, `store/[listingId]/not-found.tsx:8,10,14`, `wallet/voucher/[voucherId]/not-found.tsx:8,10-11,14`.
   - Loading states: `store/[listingId]/redeem/loading.tsx:7`, `watch/[campaignId]/checkpoint/loading.tsx:7`.
   - Redeem page: `store/[listingId]/redeem/page.tsx:24` (metadata "Tukar Poin") and `:53` (h1).
   - Burn price lock: `features/burn/price-lock-countdown.tsx:58,59,63,67` and `use-price-lock-countdown.ts:27,28,32,83`.
   - Shared panels: `features/campaign/campaign-error-panel.tsx:28` and `features/store/store-error-panel.tsx:27` ("Coba lagi").
   - `features/wallet/voucher-qr-canvas.tsx:49` (QR failure fallback).
5. **Move the English-only surfaces into catalogues, with id-ID translations.**
   - The whole business console (`features/console/**`, 47 components, 0 translator or copy calls).
   - The player: `accrual-indicator.tsx:61,71`, `completion-handoff.tsx:30-35`, `quality-selector.tsx:51,64`, `resume-prompt.tsx:34`.
   - Page headings: `app/(app)/page.tsx:27` ("Earn"), `store/page.tsx:40` ("Store"), `quick/page.tsx:30` ("Quick").
   - `business/error.tsx:25-30`, `watch/[campaignId]/error.tsx:19-32`, and the merchant metadata at `(merchant)/merchant/page.tsx:9` and `devices/page.tsx:10`.
   - The public merchant meta description at `(public)/[locale]/m/[merchant]/page.tsx:46`.
   - JSON-LD strings at `features/public/public-jsonld.ts:111-112` ("Redeemed with … YourTal points", "YourTal Member"), which are emitted on `/id` pages too.
   - The heuristic count is at least 111 strings in 52 files.
6. **Replace the bilingual-stacked screens with the active locale plus a toggle.** These show both languages at once:
   - `features/onboarding/region-picker.tsx:37-45,65`;
   - `region-option.ts:29-36`;
   - `app/(app)/onboarding/error.tsx:20-25`;
   - `onboarding/[region]/not-found.tsx:9`;
   - `features/merchant/provisioning/device-provisioning-form.tsx:64-82`.
7. **Derive the merchant portal's `lang` from the device binding** (`features/merchant/merchant-data.ts:79` already carries `binding.locale`) instead of `(merchant)/layout.tsx:44`.
8. **Order the public locales AU-first, and add `x-default`.** Change `features/public/public-locale.ts:42,46` from `["id","au"]` to `["au","id"]`. `publicLanguageAlternates` (`:117-123`) should add `"x-default"`, which docs/11 §7 (line 235) requires. `sitemap.ts` and `robots.ts` inherit the order.
9. **Add a first-visit chooser.** docs/11 §7 (line 240) says the root `/` is a "crawlable geo/language chooser, not an IP-based 302". Today `/` is the private Earn board (`app/(app)/page.tsx`) and `robots.ts:28` disallows it. Options: a small `proxy.ts` that sets an AU default cookie from `Accept-Language` without redirecting crawlers, plus a public chooser page. The public surface must stay static.
10. **Add region and language switchers.**
    - `features/public/public-header.tsx:26` has only a sign-up link. The `header.logIn` key exists in the catalogues but is never used.
    - `features/me/me-language-section.tsx:10-24` is read-only by design.
    - `region-picker.tsx:41` tells users the region "can't be changed later". That is false in practice: it is only a cookie, so clearing cookies changes it.
    - Decide whether display language can differ from region. It is 1:1 today (`packages/contracts/src/region/region.ts:49-52`). Mobile users in AU who read Indonesian are a real case.
11. **Persist region on the account.** The API `registerSchema` has only `email` and `password` (`apps/api/src/modules/auth/dto/register.schema.ts`). The web app has no login or register route at all; onboarding is a client-side phone-OTP mock (`features/onboarding/otp-mock-service.ts`, `DEMO_OTP_CODE = "123456"`). So the region "chosen at registration" lives only in a browser cookie.
12. **Make AUD work end to end at the data layer.** Without this, "AUD by default" is display-only.
    - Finish YT-0513 part 2: the web does not compile (35 TS errors), and API consumers break the same way.
    - `services/voucher/db/query/issue.sql:58-142` and `internal/store/sqlcgen/issue.sql.go:99,268` still select `face_value_idr`/`remaining_value_idr`. Migration `packages/db/migrations/20260922030000_currency_tagged_money.sql:63-84` renames those columns, so the voucher service fails against a migrated database.
    - `services/voucher/internal/redeem/redeem.go:241` refuses every non-IDR redemption, so an AU voucher cannot be redeemed.
    - Other Indonesia defaults: `packages/drivers/src/boundaries/payments.ts:194` (`currency ?? "IDR"`), `receipt-ingest.ts:78` (the simulated receipt is always IDR, "Toko Berkah"), `apps/api/src/shared/authz/principal.service.ts:72` (`jurisdiction ?? "ID"`).
13. **Seed AU fixtures for the private app.** It still serves Indonesian-only content in both regions: `mockCampaigns`/`mockListings`, `features/checkpoint/checkpoint-question-fixtures.ts:50-75` (Indonesian prompts), `features/burn/burn-data.ts:55`, `features/merchant/merchant-voucher-fixtures.ts:45-127` ("Toko Berkah").
    - `features/player/get-watch-campaign.ts` knows only the ID fixtures and hash-synthesises anything else. An AU campaign id therefore gets a _different, invented_ campaign.
    - snap-app, the first merchant, appears in no fixture.
14. **Update the e2e specs.** They assert Indonesian copy in 15 places: `e2e/earn-journey.spec.ts:98,140,151,161`, `open-view-journey.spec.ts:52`, `redeem-journey.spec.ts:105,122,123,157,166,174`, `spend-journey.spec.ts:71,87,94,99-102`. They go red when the default flips. Either pin a region cookie per spec or run each journey in both locales.
15. **Remove the hardcoded reward magnitudes.** The founder decision is "no hardcoded magnitude". `region-option.ts:31,37` and `app/(app)/onboarding/[region]/done/page.tsx:22` still hardcode `1250` and `45_000`. `region-picker.tsx:66` also brands the AUD example through `asDisplayIdr`, a type-level mislabel.
16. **Consolidate the four i18n mechanisms into one next-intl setup** (catalogues for every namespace, including onboarding, merchant and console). Add a lint rule that bans JSX text literals outside the catalogues, so this does not regress.

### A.3 Catalogue parity (measured)

| Namespace  | en-AU   | id-ID   | Missing | Identical values              |
| ---------- | ------- | ------- | ------- | ----------------------------- |
| burn       | 33      | 33      | 0       | 0                             |
| campaign   | 24      | 24      | 0       | 0                             |
| checkpoint | 25      | 25      | 0       | 0                             |
| me         | 54      | 54      | 0       | 1 (Passkey)                   |
| nav        | 6       | 6       | 0       | 0                             |
| public     | 51      | 51      | 0       | 2 (Voucher, Merchant)         |
| quick      | 5       | 5       | 0       | 0                             |
| store      | 51      | 51      | 0       | 3                             |
| streak     | 11      | 11      | 0       | 1                             |
| wallet     | 38      | 38      | 0       | 1                             |
| **Total**  | **298** | **298** | **0**   | **8** (loanwords, acceptable) |

`messages/messages-parity.test.ts` guards this. The problem is coverage, not parity. There are no catalogues at all for onboarding (TS modules `onboarding-copy-en-au.ts`/`-id-id.ts`), merchant (`merchant-copy.ts`, `merchant-error-copy.ts`, `provisioning-copy.ts`), console or player. Unused keys: `public.header.logIn`, `public.breadcrumb.merchants`, `public.notFound.*`.

---

## Part B: public surface

**Routes.** There are 6 page routes, 4 OG image routes, `sitemap.xml` and `robots.txt`. Everything reads fixed mock catalogues from `@yourtal/contracts` (`features/public/public-campaign-data.ts:42-54`, `public-listing-data.ts:37-50`). Nothing reads the API. There is no ISR (`revalidate` appears nowhere), so a real business's campaign can never appear. All routes are SSG with `dynamicParams = false`, which is correct for SEO.

| Route                                           | Status                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/[locale]` home                                | **stub**                         | `app/(public)/[locale]/page.tsx:43-57` is an h1, one sentence and one link. It does not explain the product, lists no campaigns, has no OG image and no merchant or business entry point.                                                                                                                                                                                                                        |
| `/[locale]/rewards`                             | **broken at HEAD, fixture-only** | `features/public/public-catalogue-content.tsx:41` reads the removed `faceValueIdr`, so cards show "RpNaN" / "$NaN". The cards are text-only. There are no category or city hubs (docs/11 §2.3-2.4).                                                                                                                                                                                                              |
| `/[locale]/rewards/[merchant]/[offerId]`        | **broken at HEAD, fixture-only** | `public-reward-facts.ts:65` produces "Worth RpNaN" (failing test `public-reward-facts.test.ts:41`). JSON-LD `price` at `public-jsonld.ts:100` is "NaN" (failing test `public-jsonld.test.ts:36`).                                                                                                                                                                                                                |
| `/[locale]/m/[merchant]`                        | **broken at HEAD, fixture-only** | `public-merchant-content.tsx:79` reads `faceValueIdr`. The meta description at `m/[merchant]/page.tsx:46` is English on `/id`. No merchant index page exists.                                                                                                                                                                                                                                                    |
| `/[locale]/c/[campaignId]`                      | **partial, fixture-only**        | Renders the reward facts and a CTA. It lacks the docs/11 §1 row 19 requirements: transcript, ≤90 s preview, `VideoObject` (grep finds none). The CTA is a bare `/onboarding` link with no region hint and no `returnTo` (`public-campaign-content.tsx:134`, `public-offer-content.tsx:84`, `public-header.tsx:26`).                                                                                              |
| `/[locale]/c/[campaignId]/watch` (Open Viewing) | **broken on any deployed host**  | The manifest is `http://127.0.0.1:26900/yourtal-media/hls/attention-30s/index.m3u8` (`packages/contracts/src/campaign/campaign.mock.ts:48-49`). The sign-up return is `/watch/{id}` (`features/open-view/open-view-signup-href.ts`), and `features/player/get-watch-campaign.ts` knows only the ID fixtures, so an AU viewer is "brought right back" to a synthesised, different campaign. The live path throws. |
| OG images (c, m, offer, rewards)                | **exists and works, generic**    | `features/public/public-og-card.tsx` is a slate background with default sans-serif, no logo and no imagery. The home page has no OG image. The m and rewards cards lowercase catalogue headings for their counts.                                                                                                                                                                                                |
| `sitemap.xml`                                   | **partial**                      | `features/public/public-sitemap-entries.ts:33-63` is generated from the same catalogues (good). There is no `x-default`, and alternates appear only on home and rewards (by design). There is no per-type split or video sitemap (docs/11 §2.2, §8).                                                                                                                                                             |
| `robots.txt`                                    | **partial**                      | `app/robots.ts:25-29` has `Allow: /id` and `/au` as bare prefixes, so `/id` also matches `/idx…`; it should be `/id/` plus `/id$`. `Disallow: /` blocks the crawlable root chooser docs/11 §7 requires. The domain is hardcoded (`PUBLIC_SITE_URL = "https://yourtal.com"`, `public-locale.ts:92`), not configurable for Helios.                                                                                 |
| Public header and nav                           | **partial**                      | Only "YourTal" and "Sign up" (`public-header.tsx`). No log in, no language or region switch, no links to rewards, merchants or "for business".                                                                                                                                                                                                                                                                   |
| Public 404                                      | **missing**                      | There is no `not-found.tsx` under `(public)` and no root one (multiple root layouts), so `notFound()` renders Next's unstyled default. The `public.notFound.*` keys go unused.                                                                                                                                                                                                                                   |
| llms.txt, help/FAQ, how-it-works, for-business  | **missing**                      | docs/11 §6 and §9 checklist item 14 require them. None exist.                                                                                                                                                                                                                                                                                                                                                    |

**What a logged-out visitor can do today:**

- **On `/au` or `/id`:** read a three-element home page, browse a text-only voucher list (currently showing NaN prices), read campaign and merchant pages, and press "watch without signing up". That player cannot load video anywhere except on a developer machine that has MinIO running.
- **On `/`:** land in the full private consumer app. There is no session check anywhere in `app/(app)` (grep for `redirect(`/session/auth finds 0 hits), so they see the Earn board, Store, Wallet and even `/business` console on fixture data. It renders in Indonesian, with English headings mixed into Indonesian controls.
- **Sign-up:** the only way to sign up is a phone-OTP mock with code 123456. It does not create an account through the API's email+password endpoints.

**Design and data prerequisites for the redesign.** Neither the `Listing` nor the `Campaign` contract has any image, thumbnail, poster or logo field (grep finds nothing in `packages/contracts/src/listing/listing.ts` or `campaign/*.ts`). Every public and private card is therefore text-only by construction. That is a big part of the "AI slop" look, and it cannot be fixed in CSS alone.

---

## Recommendations (ordered)

1. Land YT-0513 part 2 first. Web and API compile, the voucher SQL uses `*_minor` plus `currency`, and `redeem.go:241` accepts AUD. Otherwise every public price is NaN and AU cannot redeem.
2. Treat the i18n work as one ticket: flip `DEFAULT_REGION` to AU, remove the 22 default parameters, fix the player locale, move every literal into next-intl catalogues (console and player included), add a no-JSX-literal lint rule, and update the e2e specs to be locale-explicit.
3. Replace `/` with a public, crawlable landing and chooser page (AU-first, `x-default`). Move the consumer Earn board behind a real session. Build email+password sign-in and registration pages that call the existing API and store region on the account.
4. Rebuild the public surface on real data: API-backed reads with ISR, a media URL taken from config or the storage driver (never a literal), image fields in the contracts, and snap-app as the seeded first merchant in both regions.
5. Then do the visual redesign of home, rewards, offer, merchant and campaign pages and the OG cards, with a brand system. Add VideoObject, transcript and preview, the missing hubs, a 404 page, and llms.txt.
