# UI design audit (key: ui-design), 2026-09-25

Scope: packages/ui (tokens, theme, 11 primitives), apps/web/app/globals.css, the shell, and 23 live routes on https://yourtal.gaiada.com, captured at 390 px and 1280 px, light and dark, plus the invite dialog opened (not submitted). Screenshots are in `scratchpad/audit/shots/`. The throwaway scripts are `shoot.cjs`, `crop.cjs`, `dialog.cjs`, `au.cjs` and `missing-classes.cjs` in the same folder. Nothing in the repo was changed.

## 1. Verdict

The founder calls it "AI slop". The usual signs of that are absent: there are **0 gradients, 0 glassmorphism, 0 emoji in the UI, and 0 raw Tailwind palette colours** across 235 non-test tsx files. What makes the site look cheap is four other problems, and each has evidence:

1. **The design system is only half compiled.** `apps/web/app/globals.css:1-6` imports Tailwind but never adds `@source` for `packages/ui`. Tailwind v4 therefore never scans the primitives, and every class that appears only in `packages/ui` is missing from the shipped CSS. The live chunk `/_next/static/chunks/1ae2xu_5fak0f.css` has the same hash as the local `apps/web/.next/static/chunks/1ae2xu_5fak0f.css` built 2026-09-22. Measured: **57 of about 329 real class tokens in packages/ui are absent** (script `missing-classes.cjs`). Results:
   - **Dialog is broken.** `dialog.tsx:37` loses `left-1/2 top-1/2 -translate-*` and `w-[calc(100%-2rem)]`, and the overlay (`dialog.tsx:20`) loses `bg-fg/50`. Clicking "Invite member" on /business/team produces a dialog at `position:fixed; top:1596px` on an 800 px viewport, with no shadow and a transparent overlay (`rgba(0,0,0,0)`). The dialog cannot be seen, and the invisible overlay still blocks the page. This affects all 7 Dialog uses: team invite, change role, remove and transfer; the question bank; and the player's resume prompt.
   - **Sheet is broken** (`sheet.tsx:22,29,33-34`: no overlay tint, no shadow, no `max-h-[80vh]`). The player's quality selector uses it.
   - **Badge has no padding and the wrong text colour.** `badge.tsx:7` loses `px-2.5 py-0.5`, and `badge.tsx:12-16` loses `text-success-fg`, `text-warning-fg`, `text-danger-fg` and `text-reward-fg`, plus `bg-success`. On screen: every points pill is black text on #8a5b00, **3.58:1**, and "Sold out", "Rejected" and "Kedaluwarsa" are black on #b3261e, **3.21:1**. Both fail WCAG AA, while `contrast.test.ts` (76 tests, all passing) certifies the intended white-on-colour pairs at 5.87 or better. "Live" and "Verified" render with no badge background at all.
   - **Destructive buttons render black text on red** (`button.tsx:20`, `text-danger-fg` missing). There are 7 uses: "Remove", "Hapus akun saya", "Revoke access" and transfer ownership.
   - **Tabs show no active state** (`tabs.tsx:38`). This is the merchant cashier's Scan/Manual switch.
   - **Select and Toast lose their shadow, min-width, max-height and item padding** (`select.tsx:48-92`, `toast.tsx:21,30`). `select.tsx:48` also uses Tailwind v3 syntax (`max-h-[--radix-…]`), which is invalid in v4 even when scanned.

   The old board marks YT-0400 and YT-0401 as "done, verified". It verified that the directories exist and that the token file passes contrast (`docs/tasks/phase-u-ui.md:13-40`). Nothing ever checked what the browser actually renders.

2. **There are no base styles.** Nothing sets `body { color; background }` or `color-scheme`. The shipped CSS contains only `.text-fg{color:var(--color-fg)}` and no body rule. In dark mode, any text without an explicit class falls back to black on #0b0c0f, **1.07:1**. "Verified", "Active" and table cells on /business/team are invisible in dark mode (`vp_business_team__390__dark.png`).

3. **The token values produce a wireframe look.**
   - Light `--color-surface-raised` is #ffffff, identical to `--color-bg` (`tokens.css:20-22`), so every "raised" element is invisible in light mode. That covers 36 `bg-surface-raised` plus 6 `hover:` uses, including the console active-tab pill (`console-zone-nav.tsx:41-42`), ghost-button hover, the Progress track (`progress.tsx:26`) and the Skeleton (`skeleton.tsx:20`). As a result, `/wallet/loading.tsx:7-9` renders a **blank white page** while loading.
   - `--color-border` is #888e94 (`tokens.css:30`), chosen so that every border passes the 3:1 contrast required for controls (`contrast.test.ts:196-203`). Every card, including purely decorative ones, therefore gets a heavy mid-grey outline (3.01:1 on surface). Cards are grey #f3f4f6 with that border on white. On public pages the page itself is also `bg-surface` (`(public)/[locale]/layout.tsx:64`), so the cards are grey on grey with only an outline separating them.
   - The brand colour is a stock indigo #3548c4 (`tokens.css:34`).
   - The type scale stops at 30 px (`tokens.css:79-92`). 351 of 447 size uses are `text-sm` or `text-xs`, and weights are only medium or semibold.
   - The app uses one font, Plus Jakarta Sans (`root-document.tsx:46`). There is no display face and no mono face for codes or serials.

4. **There is no product design layer on top of the primitives.**
   - **No imagery anywhere:** 1 `<img>`, 0 `next/image`, 0 video posters, no merchant logos. The Quick feed is a title floating in about 1,000 px of white space (`vp_quick__390.png`), and campaign and store cards are text-only.
   - **No brand:** "YourTal" is plain text (`public-header.tsx:23-25`), `/favicon.ico` returns 404, there is no manifest and no logo asset.
   - **The public landing page is three elements:** h1, one sentence and a link (`(public)/[locale]/page.tsx:48-55`).
   - **The advertiser console sits inside the consumer's mobile tab shell.** The consumer tabs "Dapatkan / Cepat / Toko / Dompet / Saya" appear beside an English console, although `docs/08:133` says the console is desktop-first. The console has no navigation of its own beyond a wrapped link row with a doubled rule, and its H1 is the business name at 24 px, wrapping to 4 lines on mobile.
   - **The UI copy talks about itself:**
     - Reports renders "(docs/23-critique.md §1.0)", "campaignSchema (@yourtal/contracts/campaign)", "Cloudflare Stream exposes no per-session…" and "device farm" (`reports-provenance-legend.tsx:20-22`, `reports-unavailable-metrics.ts:29-43`).
     - Placeholders render "not built yet — see YT-0441" (`business/inventory/page.tsx:24`).
     - Help text cites "(docs/06 §4.3)" (`question-editor.tsx:73`).
     - /me says "Prototipe: …", "(demo)" and "apa adanya, tidak dilebih-lebihkan".
     - The merchant portal and onboarding print every string twice, EN and then ID ("Provisioning code / Kode pemasangan"), in `vp_merchant__390.png` and `vp_onboarding__390.png`.

     This hedging, self-referential tone is what most reads as AI-written.

## 2. Language on screen

This is not my key, but it shows on every screenshot.

- Region defaults to ID (`features/region/get-region.ts:11`), so an anonymous visitor to `/` sees an Indonesian Earn board under an English heading. "Earn" and "Store" are hard-coded at `app/(app)/page.tsx:27` and `store/page.tsx:40`.
- **With the AU cookie set**, the Earn filters still say "Semua / Video panjang / Cepat / Urutkan / Nilai terbaik", which are hard-coded in `campaign-filter.ts:32-34` and `campaign-sort.ts:17`. Store filters still say "Semua harga / Semua lokasi", and **IDR face values are formatted as AUD**: "Worth $232,000.00" for a coffee voucher. The cause is `store-format.ts:45`, which formats `faceValueIdr` in the viewer's currency (`au_cookie_store__390.png`).
- The merchant layout hard-codes `lang="id-ID"` (`(merchant)/layout.tsx:44`).
- Features with 0 files using i18n: console (47 tsx), merchant (14), onboarding (9) and player (10).

## 3. Inventory: packages/ui

| Primitive              | Uses in apps/web    | Status                | Evidence                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| tokens.css / theme.css | global              | partial               | Tokens exist and pass the file-level contrast test. surface-raised == bg in light mode; one border colour for every purpose; no semantic tiers (subtle/solid/fg); no motion, z-index or layout tokens; `@theme inline` maps each var to itself (`theme.css:93-140`), which works only because tokens.css is unlayered |
| Base layer             | none                | missing               | globals.css:1-6; no body colour or bg, no color-scheme                                                                                                                                                                                                                                                                |
| Button                 | 99                  | partial               | default, outline and ghost work; destructive text missing; h-10 = 40 px is under the 44 px touch target; 33 `size="sm"` (36 px)                                                                                                                                                                                       |
| Input                  | 25                  | complete (functional) | all classes compile; restyle only                                                                                                                                                                                                                                                                                     |
| Select (Radix)         | 0                   | stub                  | unused; 16 native `<select>` elements are hand-styled instead (4 identical 150-char class strings)                                                                                                                                                                                                                    |
| Card                   | 44 (+23 CardHeader) | partial               | compiles except CardContent `pt-0`; grey card with heavy border                                                                                                                                                                                                                                                       |
| Badge                  | 40                  | broken                | padding and fg colours not compiled                                                                                                                                                                                                                                                                                   |
| Dialog                 | 7                   | broken                | off-screen, verified by measurement                                                                                                                                                                                                                                                                                   |
| Sheet                  | 1                   | broken                | no overlay, shadow or max-h                                                                                                                                                                                                                                                                                           |
| Toast                  | 0                   | stub                  | exists, never used                                                                                                                                                                                                                                                                                                    |
| Tabs                   | 1                   | broken                | no active state                                                                                                                                                                                                                                                                                                       |
| Skeleton               | 77                  | partial               | invisible on a white page in light mode                                                                                                                                                                                                                                                                               |
| Progress               | 2                   | partial               | track invisible in light mode                                                                                                                                                                                                                                                                                         |

**Missing primitives, with the ad-hoc duplication each would remove:**

- **Heading and Text.** The string `"text-sm font-sans text-fg-muted"` appears 58 times verbatim. There are 7 distinct h1 styles across 36 h1s, from text-lg to text-2xl, and 8 distinct h2 styles.
- **PageContainer and PageHeader.** There are 20 distinct `mx-auto … max-w-*` wrapper strings using 8 different max-widths.
- **DataTable.** There are 6 raw `<table>` elements in console reports and team, and the team table clips at 390 px.
- **EmptyState and ErrorState.** There are 15 error and not-found files: 2 use shared panels and 11 are bespoke.
- **Switch** (hand-built at `me-consent-toggle.tsx:39`) and **SegmentedControl** (`campaign-board-controls.tsx:54` and `campaign-editor-section-nav.tsx:52`, which hand-builds a tablist while the Tabs primitive exists).
- **Chip, ChoiceCard and InterestTile.** The interest tile is built twice (`me-interests-section.tsx:49`, `interest-picker.tsx:93`), and its `aspect-square` makes 240 px empty squares on desktop.
- **ChapterTrack.** It is duplicated (`player/chapter-track.tsx:61` and `open-view/open-view-chapter-track.tsx:60`), both using `text-[10px]`, and so are the players (`player/video-player.tsx:41`, `open-view/open-view-player.tsx:61`).
- **PointsAmount.** Points are coloured `text-price` (green) on store cards (`store-listing-card.tsx:65`) but `text-reward` (amber) on Earn and Wallet, so the product's own currency has no single visual identity. **MoneyAmount** is missing too.
- **KeyValue** (9 ad-hoc `<dl>`), **MediaThumb**, **MerchantLogo** and **Notice**.
- **Sub-scale text:** 6 uses of `text-[10px]` or `text-[11px]`, below the 12 px minimum.

## 4. Screens

These are live screenshots. "Partial" means the screen renders and works on fixtures but is visually unfinished.

- **Consumer shell:** partial. No logo, no persistent points balance, and the active state is text colour only on mobile.
- **Earn:** partial. Broken pills, a cramped 7-day streak ladder, no thumbnails.
- **Campaign, Watch and Checkpoint:** partial. Black box instead of a poster; "Reward if you finish 0 poin" shows English and Indonesian mixed; chapter chips wrap into 4 lines.
- **Quick:** fixture-only look, with no media.
- **Store:** partial. The price is truncated to "2.3…" whenever a status badge shares its row (`store-listing-card.tsx:64-72`); this is the most important number on the card.
- **Wallet:** partial. Unbounded history list; "akan kedaluwarsa … (17 jam yang lalu)" shows a past date under "will expire".
- **Me:** partial. Black-on-red delete button, huge empty tiles, disclaimer copy.
- **Onboarding:** partial, with bilingual stacked copy.
- **Console shell:** broken information architecture.
- **Console campaigns and team:** partial, and team's actions are unusable because the dialogs are broken.
- **Reports:** partial, with meta copy.
- **Inventory, Billing and Redemption:** stubs. Redemption tells an Owner "your role doesn't include Redemption" when the real gate is the business relationship (`console-zone-access.ts:75-76,104`).
- **Merchant:** partial. Bilingual stacked copy, black-on-red "Revoke access".
- **Public landing:** stub.
- **Public catalogue, offer, merchant and campaign:** partial and text-only. The "Sold out" badge wraps onto 2 lines and fails contrast.

## 5. Redesign approach for medium-effort agents

### Phase D0: fix the pipeline (half a day, one agent, before any redesign)

1. Add `@source "../../../packages/ui/src";` after `@import "tailwindcss"` in globals.css.
2. Add a base layer: `html{color-scheme:light dark}`, `:root[data-theme=dark]{color-scheme:dark}`, and `body{background:var(--color-bg);color:var(--color-fg);font-family:var(--font-sans)}`.
3. Fix `select.tsx:48` to the v4 form `max-h-(--radix-select-content-available-height)`.
4. Add a **rendered** gate, because the token-file test measured the wrong thing:
   - A Playwright spec that opens a Dialog and asserts its bounding box is inside the viewport.
   - axe-core with `color-contrast` on 6 routes in both themes.
   - A CI script, based on `missing-classes.cjs`, that fails if any `packages/ui` class is absent from the built CSS.
5. Re-screenshot the site. This phase alone fixes badges, dialogs, destructive buttons, tabs and dark-mode text.

### Phase D1: tokens v2, after the founder picks a direction (1 agent, 1-2 days)

Use three tiers: raw palette, then semantic, then component. All names below are fixed, so agents only fill in values from the chosen direction.

- **Surfaces:** `canvas`, `surface`, `surface-sunken`, `overlay`, where light `surface` must differ from `canvas`.
- **Text:** `fg`, `fg-muted`, `fg-subtle`, `fg-on-accent`.
- **Borders:** `border-subtle` (decorative, about 1.3:1, the default for cards), `border-control` (3:1, inputs only), `border-strong`.
- **Accent:** `accent`, `accent-hover`, `accent-subtle`.
- **Points:** `points` and `points-subtle`. This is the one and only colour for points.
- **Status:** `success`, `warning`, `danger` and `info`, each with `-solid`, `-subtle` and `-on-subtle`.
- **Focus:** `focus`.
- **Type roles:**

  | Role       | Size / line-height | Face              |
  | ---------- | ------------------ | ----------------- |
  | display-lg | 56/60              | display, balances |
  | display    | 40/44              | display           |
  | headline   | 28/34              | display           |
  | title      | 20/28              | body              |
  | body       | 16/24              | body              |
  | body-sm    | 14/20              | body              |
  | label      | 14/20, 600         | body              |
  | caption    | 12/16 (minimum)    | body              |
  | numeric    | tabular            | display           |
  | code       | —                  | mono              |

- **Layout:** `page-narrow` 640, `page` 960, `page-wide` 1200; gutter 16/24/32.
- **Controls:** 44 default, 36 compact (console only), 56 for the merchant counter.
- **Radii:** control, card, sheet, pill.
- **Elevation:** 3 levels.
- **Motion:** 120/200/320 ms with `standard` and `emphasized` easing, plus a reduced-motion reset.
- **Z-index:** nav 40, overlay 50, toast 60.
- **Enforcement:** keep contrast.test.ts but rewrite the pairs against the new semantics, and ban `text-[Npx]` and raw hex with lint rules.

### Phase D2: primitives (2-3 agents in parallel, one file each, 3-4 days)

- **Rework:** Button (primary, secondary, ghost, danger, link; sm, md, lg, counter; loading; icon), Input, Textarea, NativeSelect (replacing all 16 native selects), Card (plain, interactive with stretched link, inset), StatusBadge, Dialog, BottomSheet, Toast (wire a provider), Tabs, Skeleton, Progress.
- **New:** Heading, Text, PageContainer, PageHeader, Section, PointsAmount, MoneyAmount (currency always comes from the data, never the viewer), KeyValue, DataTable (collapses to a card list below md), EmptyState, ErrorState, Notice, Switch, Chip, SegmentedControl, ChoiceCard, MediaThumb (16:9, duration, chapter ticks, branded placeholder), MerchantLogo (initials fallback), QRPanel, Stepper, FilterBar, ListRow, ConsumerTopBar (logo and balance), ConsoleShell (desktop sidebar), CounterShell (merchant).
- **Brand assets:** logo mark and wordmark SVG, favicon, maskable icons, manifest.
- **Gallery and baseline:** add a `/dev/ui` gallery route. Its Playwright `toHaveScreenshot` baselines at 390 and 1280, light and dark, count as done evidence for each primitive.
- **Lint rules for features/\*\*:** ban raw `<button>`, `<select>`, `<table>` and `<input>`; ban `font-sans` (it becomes the base).

### Phase D3: reskin, in this order, one screen group per agent

1. The three shells: consumer (top bar with balance, bottom and side nav), console (move `/business` out of the `(app)` AppShell into its own layout), merchant counter. Add public header and footer.
2. Earn board, campaign card and streak.
3. Campaign entry, watch, chapter track, checkpoint, and the points-credit moment.
4. Store browse, listing detail and redeem.
5. Wallet and voucher detail with QR (works offline).
6. Merchant portal: provision, identify, review, outcome, today log, devices.
7. Onboarding: region, email and password auth, consent, interests, done.
8. Me.
9. Quick.
10. Console: overview, campaigns list and builder, question bank, team and its dialogs, reports.
11. Public: a real landing page per region, catalogue, offer, merchant, campaign, open-view, OG card.
12. Loading, error and not-found states.

**Every screen ticket includes a copy pass:**

- Delete doc references, ticket IDs and "prototype" or "demo" disclaimers.
- Use one language per screen, and move strings to messages.
- Write copy for the user in the product's voice, not the system's.
- Done means: 4 screenshots attached, axe clean, no banned elements.

## 6. Three visual directions for the founder to choose from

None of them uses the three current AI defaults: cream with a serif and terracotta, near-black with acid green, or broadsheet hairlines.

### A. "Polymer" (recommended)

Based on Australian polymer banknotes, because YourTal is "the central bank of a points economy".

- **Palette:** Ink #0F1B2D, Mineral #F3F5F7 (canvas), White #FFFFFF (cards), Polymer Teal #0A7C86 (actions), Holo Violet #6A3DE8 (points only), Signal Amber #E09A00 (streak and expiry), Danger #C4372C.
- **Type:** Archivo, expanded width 112-125, weights 700-800, for balances and headlines. Hanken Grotesk 400-600 for body. IBM Plex Mono for voucher codes and ledger serials.
- **Shape:** 14 px cards with no outline (white on mineral with a 1-level shadow); 10 px controls; pill chips; vouchers drawn as notes with a perforated stub and a clear "window" for the QR.
- **Signature:** the balance note, a card with a faint violet guilloche microline pattern, the balance in Archivo Expanded 48 px and the journal-entry serial in mono. It is the only ornament in the product. There is one motion moment: the count-up when points credit.
- **References:** Up Bank, Wise, Apple Wallet passes, RBA notes.
- **Why:** it fits AU-first, trust around money, the ledger and proof story, and the console.

### B. "Coin Drop"

Energetic and gamified; strongest for consumer engagement and the Indonesia proving ground.

- **Palette:** Chalk #FBFAFF, Night Grape #1B1340, Grape #5B2EFF (actions), Coin #FFC53D (points), Sherbet #FF7A59 (streaks and urgency), Mint #16B890 (success).
- **Type:** Bricolage Grotesque 700-800 for display, Figtree for body, tabular figures for numbers.
- **Shape:** 20 px cards; 48 px pill buttons; every points amount is a coin chip; a 16:9 poster is required on every campaign.
- **Signature:** coins drop into the Wallet tab when points credit.
- **References:** Duolingo, Shopee Coins, Cash App.
- **Risk:** the console needs a desaturated sub-theme using the same tokens.

### C. "Eucalypt & Wattle"

Calm Australian retail, with accessibility first.

- **Palette:** Canvas #F6F8F7, Ink #13201A, Eucalypt #1E6B52 (actions), Wattle #F2B705 (points), Harbour #1B6FA8 (links and info), Danger #C23B2E.
- **Type:** Schibsted Grotesk 700 for display. Atkinson Hyperlegible Next for body and Atkinson Hyperlegible Mono for codes, chosen for readability at a busy counter.
- **Shape:** 8 px radius; dense lists; square photography for merchants; 56 px counter buttons.
- **Signature:** a green-and-gold points chip, and a till-receipt redemption confirmation.
- **References:** Woolworths Everyday Rewards, the GOV.AU design system, Canva.
- **Risk:** it can read as a supermarket for the Indonesian market.

Whichever direction is chosen changes only D1 values and D2 details. The D0 fix, the D1 token names, the D2 primitive list and the D3 order stay the same, so the medium-effort agents make no taste decisions.
