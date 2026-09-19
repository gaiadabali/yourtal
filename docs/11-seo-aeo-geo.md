> **Revision note (2026-09-19):** **Open Viewing** was adopted after this doc was written — anonymous visitors can now watch the **full** campaign video, unrewarded. Campaign pages therefore become real public content rather than preview stubs, which satisfies Google's "video is the main content" requirement and makes every campaign a genuine organic landing page. This supersedes the preview-only recommendation in §7; the gate moved from the video to the reward. See [`17-surfaces-and-roles.md`](17-surfaces-and-roles.md) §4.

# YourTal — SEO, AEO, GEO & Structured Data

**Date:** 2026-09-18
**Decision:** The public web surface (catalogue, merchant pages, campaign landing pages, help centre, marketing) is **statically rendered, indexable and AI-crawlable**. The reward loop (video playback, questions, points, wallet) is **gated and `noindex`**. We optimise for classical search *and* for citation by answer engines, because Google's own position is that these are the same discipline — ["AEO and GEO are not separate from SEO"](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide).

---

## 1. Surface map — what is public, and why

This resolves the SEO-vs-reward-economy tension before anything else, because every other decision depends on it.

| Surface | Render | Index | Rationale |
|---|---|---|---|
| Voucher/offer pages (`/id/rewards/[merchant]/[offer]`) | **SSG + ISR** | ✅ | The commercial long tail. Thousands of pages, high purchase intent, the reason organic exists. |
| Merchant pages (`/id/m/[merchant]`) | **SSG + ISR** | ✅ | Ranks for "brand + voucher/promo". Feeds `LocalBusiness` + outlet list. |
| Catalogue & category hubs | **SSG + ISR** | ✅ | Internal-link distribution layer. |
| Campaign landing page (`/id/c/[campaign]`) | **SSG** | ✅ | Public: title, merchant, duration, reward, **full transcript**, ≤90 s preview clip, `VideoObject`. |
| **Campaign video + questions + points** | Dynamic, authed | ❌ `noindex` | Gating is the product. Do not leak the question bank — see [`06`](06-longform-video-and-attention.md). |
| Help centre | **SSG** | ✅ | The single highest-yield AEO asset we own (see §3). |
| Marketing, legal, merchant-acquisition | **SSG** | ✅ | |
| App shell: feed, watch, wallet, profile, advertiser console, merchant portal | Dynamic | ❌ `noindex`, `Disallow` | Zero SEO value, real crawl cost. |

**The tension is not real at the page level, only at the asset level.** A campaign page can be fully public — transcript, metadata, preview — while the 25-minute video and the reward stay behind login. Crawlers get the *text*, which is what they index and cite anyway; the *economy* stays gated. Mark the gate honestly with paywall structured data (§8) rather than cloaking a watch page, which is a spam violation with nil payoff.

## 2. SEO — Next.js App Router specifics

### 2.1 Rendering rules

- **Every public page's primary content must be in the initial HTML.** RSC by default; `'use client'` only for the voucher redeem button, filters and the player. Google renders JS but [treats it as added complexity](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), and the non-Google answer engines' crawlers are materially worse at it. A client-fetched catalogue is invisible to Perplexity.
- **ISR over SSR** for catalogue pages: `export const revalidate = 3600`, plus on-demand `revalidateTag('offer:<id>')` when a merchant changes stock. Keeps TTFB at CDN latency, which matters because [INP was confirmed in March 2026 as a primary ranking signal with weight equal to LCP and CLS](https://www.corewebvitals.io/core-web-vitals) — our budgets in [`08`](08-web-app-and-performance.md) §3.1 already clear this; do not regress them.
- CWV is a **tiebreaker, not a lever**. Hitting "good" is worth it; going from good to excellent buys nothing in ranking (it buys conversion).

### 2.2 Metadata, canonicals, sitemaps, robots

| Concern | Next.js primitive | Rule |
|---|---|---|
| Titles/descriptions | `generateMetadata` in each `page.tsx` | Per-locale, from DB fields. Never a shared template that produces 4,000 identical descriptions. |
| Canonical | `alternates.canonical` | **Absolute URL, on every public page.** Set `metadataBase` once in the root layout. The most common Next.js SEO failure is omitting this. |
| hreflang | `alternates.languages` | §7. |
| Sitemaps | `app/[type]/sitemap.ts` + `generateSitemaps()` | One sitemap *set per content type per locale*: offers, merchants, campaigns, help. 50,000 URLs per file ([Next.js docs](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap)); Next emits the index automatically at `/rewards/sitemap/[id].xml`. Real `lastModified` from `updated_at` — a fabricated `lastmod` gets the whole file discounted. Skip `priority`/`changefreq`; Google ignores them. |
| Video sitemap | `videos[]` in the sitemap entry | Only for campaign pages with a public preview. |
| robots.txt | `app/robots.ts` | §6. |
| Per-page indexing | `robots: { index: false }` in `generateMetadata` | Applied by route group, not sprinkled per page. |
| OG/Twitter images | `opengraph-image.tsx` | Dynamic per offer. Drives social and AI-answer thumbnails. |

### 2.3 Internal linking for a large catalogue

Crawl reaches what is linked. Design the graph deliberately:

- **Hub → spoke → hub.** Locale home → category hub (`/id/rewards/kopi`) → city hub (`/id/rewards/kopi/jakarta`) → offer page → back to merchant page and 6–10 sibling offers. Every offer links to its merchant; every merchant lists its live offers. Target ≤3 clicks from home to any offer.
- **Expired offers 301 to the merchant page** — never 404, never soft-404 to the catalogue root.
- Paginated hubs: real `<a href>` links (not a JS "load more"), self-referencing canonical on each page. **Never canonicalise page 2 to page 1** — that orphans everything on it.

### 2.4 Faceting without duplicate content

Three tiers, no exceptions:

| Tier | Example | Treatment |
|---|---|---|
| **Indexable facet** (has real search demand) | category, city, merchant | Clean path segment, own `<h1>`, own copy, in sitemap, linked in nav. |
| **Crawlable but not indexable** | `?sort=`, `?page=` beyond 5 | `noindex, follow` + self-canonical. |
| **Blocked** | multi-select filters, `?ref=`, session params, price sliders | **`Disallow` in robots.txt and never emit an `<a>` to them** — use `POST`/client-state. [Google's own faceted-nav guidance prefers robots blocking over `noindex`, because `noindex` still costs crawl budget](https://searchengineland.com/guide/faceted-navigation). |

Facet combinatorics are how a 5,000-offer catalogue becomes 40 million URLs and gets its crawl rate throttled. Decide the indexable facet list up front and keep it under ~200 URLs per locale.

## 3. AEO — what actually works, and what is snake oil

Google's May 2026 guide is blunt: **there are no special optimisations for AI Overviews or AI Mode**; a page must simply be indexed and snippet-eligible, and quality is the dominant long-run factor ([Google](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide), [SEJ](https://www.searchenginejournal.com/googles-new-ai-search-guide-calls-aeo-and-geo-still-seo/575026/)). Treat everything beyond that as probabilistic.

**Supported by reasonable evidence:**

| Practice | Evidence |
|---|---|
| Rank in the classical top 10 | [~38% of AI Overview citations come from the organic top 10](https://ahrefs.com/blog/ai-overview-citations-top-10/) — it is the single cheapest AEO tactic and it is just SEO. |
| Answer the question in the **first 30% of the page** | [44.2% of LLM citations are extracted from the first 30% of a document](https://www.digitalapplied.com/blog/ai-search-citation-ranking-factors-2026-data-study). Lead with a 40–60 word direct answer, then elaborate. |
| Lists and tables for extractable facts | [25–35% structured elements → 43% higher extraction accuracy](https://arxiv.org/html/2603.29979v1). Voucher terms, redemption steps and eligibility belong in tables, not prose. |
| Brand mentions off-site | [Correlate ~3× more strongly with AI visibility than backlinks](https://www.digitalapplied.com/blog/ai-search-citation-ranking-factors-2026-data-study). Correlational, not causal — but PR and merchant co-marketing are cheap for us anyway. |
| Being crawlable by the *search* AI bots | Mechanically necessary. §6. |
| Semantic completeness (one page fully answers one question) | Strongest single reported correlate; consistent with the structural work. |

**Unevidenced or actively bad:**

| Claim | Verdict |
|---|---|
| "`llms.txt` gets you into AI answers" | False. §6. |
| "Add FAQ schema to win AI Overviews" | No. Google [deprecated FAQ rich results on 7 May 2026](https://www.getpassionfruit.com/blog/what-changed-with-google-drops-faq-rich-results-and-what-to-do-now). Keep the markup (harmless, machine-readable), expect nothing from it. |
| "Write pages per query variant to catch fanout" | Google explicitly calls this **scaled content abuse**. Do not. |
| "Longer = cited more" (2,500+ words) | Reported correlation, almost certainly confounded by topic depth and authority. Do not pad. |
| "AI-citation optimisation services / GEO agencies" | See §4. No vendor can demonstrate durable cross-platform lift. |
| "Conversational/question-shaped headings unlock citation" | Plausible, unproven in isolation. Free to do; do not build strategy on it. |

**Our AEO play, concretely:** the help centre is the asset. Queries like *"berapa lama poin YourTal berlaku"* / *"how do I redeem a YourTal voucher"* are exactly what answer engines resolve, and we are the authoritative source on our own mechanics. One page per real question, direct answer in the opening paragraph, terms in a table, last-updated date shown, `Organization` markup present. That is the whole programme; anything more elaborate is speculation.

## 4. GEO — what the research actually says

The [original GEO paper (Aggarwal et al., 2023)](https://arxiv.org/abs/2311.09735) reported up to 40% visibility gains from adding citations, quotations and statistics to source text. That result is real but narrow: it measures **re-ranking of a source already present in a fixed context window**. It says nothing about getting retrieved in the first place.

The [2026 critical survey of 45 GEO studies](https://arxiv.org/abs/2607.14035) is the honest summary:

- Only **topical relevance and position in context** are reproducible levers.
- **No technique shows a stable, longitudinal, cross-platform causal effect on organic discoverability.**
- Source overlap between engines is low and run-to-run variance is high — the same prompt yields different citations.
- **Citation-oriented rewrites can impair retrieval.** Optimising prose for quotability can cost you the classical ranking that got you retrieved.
- Gains erode as competitors adopt the same tactics.

Reported effects elsewhere are modest and plausible: [+17.3% citation from structural editing (Cohen's d = 0.64)](https://arxiv.org/html/2603.29979v1). Note this is a *relative* lift on an already-retrieved corpus.

**Position:** spend on GEO only where it overlaps SEO and content quality — structure, tables, named sources, direct answers, real data. Budget **zero** for GEO-specific tooling or agencies in 2026. Revisit if per-engine attribution becomes measurable.

## 5. Structured data

Ship as JSON-LD in a `<script type="application/ld+json">` rendered server-side. [65% of pages cited by AI Mode carry structured data](https://www.digitalapplied.com/blog/ai-search-citation-ranking-factors-2026-data-study) — correlational, but it is cheap and it is the only machine-readable contract we control.

| Type | Where | Worth it? |
|---|---|---|
| `Organization` + `WebSite` | Root layout, both locales | ✅ Knowledge-panel and entity resolution. Include `sameAs` to socials. |
| `BreadcrumbList` | Every catalogue page | ✅ Still a live rich result; cheap. |
| `Product` + `Offer` | Voucher pages | ✅ — with the caveat below. |
| `LocalBusiness` (or subtype) | Merchant pages with physical outlets | ✅ Our strongest differentiator vs a generic voucher aggregator. |
| `ItemList` | Category hubs | ✅ Helps carousel eligibility and list extraction. |
| `VideoObject` | Campaign pages | ✅ §8. |
| `FAQPage` | Help centre | ⚠️ No rich result since May 2026. Keep for machine readability only. |
| `Review` / `AggregateRating` | — | ❌ **Do not emit until we have genuine, verifiable user ratings.** Fabricated ratings are a manual-action risk and the ratings are worthless anyway at launch. |
| `HowTo` | — | ❌ Dead. |

**The points-pricing trap.** A voucher costs *points*, not money. Do not invent a monetary `price` to chase merchant-listing rich results — that is misleading markup. Mark the voucher's genuine **face value** as the `Offer.price`, and express the points cost as a loyalty `priceSpecification`. Google's loyalty-programme markup exists, but I am *not confident* a points-only redemption qualifies for member-price rich results; emit it because it is truthful and machine-readable, and do not plan around eligibility.

### 5.1 Voucher/offer page

```jsonc
{
  "@context": "https://schema.org",
  "@type": "Product",
  "@id": "https://yourtal.com/id/rewards/kopi-kenangan/voucher-50rb#product",
  "name": "Voucher Kopi Kenangan Rp50.000",
  "description": "Tukar 5.000 YourTal Points dengan voucher Rp50.000 di seluruh gerai Kopi Kenangan.",
  "image": ["https://cdn.yourtal.com/offers/kk-50rb-1x1.jpg"],
  "brand": { "@type": "Brand", "name": "Kopi Kenangan" },
  "offers": {
    "@type": "Offer",
    "url": "https://yourtal.com/id/rewards/kopi-kenangan/voucher-50rb",
    "priceCurrency": "IDR", "price": "50000",     // genuine face value, not a points fiction
    "priceValidUntil": "2026-12-31",
    "availability": "https://schema.org/InStock",
    "eligibleRegion": { "@type": "Country", "name": "ID" },
    "seller": { "@id": "https://yourtal.com/#organization" },
    "offeredBy": { "@id": "https://yourtal.com/id/m/kopi-kenangan#business" },
    "priceSpecification": {
      "@type": "UnitPriceSpecification", "priceCurrency": "IDR", "price": "0",
      "description": "Ditukar dengan 5.000 YourTal Points",
      "validForMemberTier": { "@type": "MemberProgramTier", "name": "YourTal Member" }
    }
  }
}
```

### 5.2 Merchant page

```jsonc
{
  "@context": "https://schema.org",
  "@type": "CafeOrCoffeeShop",
  "@id": "https://yourtal.com/id/m/kopi-kenangan#business",
  "name": "Kopi Kenangan",
  "url": "https://yourtal.com/id/m/kopi-kenangan",
  "sameAs": ["https://kopikenangan.com", "https://www.instagram.com/kopikenangan"],
  "areaServed": { "@type": "Country", "name": "ID" },
  "location": [{                                   // one Place per outlet
    "@type": "Place", "name": "Kopi Kenangan Grand Indonesia",
    "address": {
      "@type": "PostalAddress", "streetAddress": "Jl. M.H. Thamrin No.1",
      "addressLocality": "Jakarta Pusat", "addressRegion": "DKI Jakarta",
      "postalCode": "10310", "addressCountry": "ID"
    }
  }],
  "makesOffer": [{ "@id": "https://yourtal.com/id/rewards/kopi-kenangan/voucher-50rb#product" }]
}
```

Use stable `@id` URIs so offer, merchant and organisation nodes link into one graph rather than three orphan blobs. Validate in CI with `schema-dts` types plus a Rich Results Test call on a sample of routes per deploy.

## 6. `llms.txt` and AI crawler policy

**`llms.txt` is a curated Markdown index of your site for LLMs.** Adoption is wide, consumption is near-zero: [~10% of 300k domains publish one, yet of 500M AI-bot visits over 90 days only 408 fetched it, and 97% of published files received no requests at all](https://www.wix.com/studio/ai-search-lab/llms-txt-myths). No major lab has committed to reading it in production, and Google states you [do not need it for any generative feature](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide). The one genuine consumer is **coding and commerce agents** reading developer docs.

**Decision: publish a minimal `/llms.txt` (one static route, ~30 lines, links to the locale catalogues, help centre and merchant API docs) and invest nothing further.** It costs an afternoon and hedges a cheap option; anyone budgeting real money against it is selling something.

### Crawler policy

We **want** citation, so blanket-blocking is straightforwardly wrong for us. We are not a publisher with ad revenue to defend — our content is merchant marketing that merchants are paying us to distribute. Wider exposure is the product.

| Crawler class | Examples | YourTal policy |
|---|---|---|
| Classical search | Googlebot, Bingbot | **Allow everywhere public.** |
| AI **search/answer** bots | `OAI-SearchBot`, `PerplexityBot`, `Claude-SearchBot`, `Google-Extended` | **Allow everywhere public.** These are the ones that cite and link back; [publishers now overwhelmingly allow them while blocking training bots](https://technologychecker.io/blog/robots-txt-ai-crawlers-blocking-report). |
| AI **training** bots | `GPTBot`, `CCBot`, `Meta-ExternalAgent`, `anthropic-ai` | **Allow on marketing, help centre and category hubs; disallow on the offer/merchant detail corpus.** Brand presence in model weights is free distribution; bulk-scraped merchant inventory is a competitor's dataset. Low-confidence call, cheap to reverse. |
| Agentic browsers | ChatGPT Agent, browser-use bots | **Allow.** An agent redeeming a voucher for a user is a future revenue path, not a threat. |
| Everything, on private routes | — | `Disallow: /app/`, `/wallet/`, `/api/`, `/advertiser/`, `/merchant/`, `/*?token=` |

**Cloudflare caveat:** since [15 September 2026 Cloudflare blocks Training and Agent crawlers by default on ad-bearing pages for new domains and free-tier sites](https://blog.cloudflare.com/content-independence-day-ai-options/). We serve no ads so we should be unaffected, but **explicitly set the Bot Management AI categories rather than inheriting defaults** — a silent block would be invisible and would cost exactly the citations we are chasing. Skip Pay-Per-Crawl; we are paying for distribution, not selling it.

Use `max-snippet:-1, max-image-preview:large` on public pages. Never `nosnippet` — no snippet means no citation.

## 7. Internationalisation

**URL strategy: one gTLD, locale subdirectories.** `yourtal.com/id/...` and `yourtal.com/au/...`, with `yourtal.id` and `yourtal.com.au` registered defensively and 301'd to the matching subdirectory.

| Option | Verdict |
|---|---|
| **Subdirectory** | ✅ One domain's authority, one CDN/WAF config, one Search Console property with child views, trivial in Next.js middleware + `next-intl` (already the stack choice in [`10`](10-tech-stack.md)). |
| Subdomain | ❌ Authority splits, doubles the infrastructure surface for no gain. |
| ccTLD | ❌ Strongest geo-signal and a genuine local-trust benefit in Indonesia, but two sites to rank from zero with a one-market POC. Redirect, don't split. |

Content is **genuinely different per country** — different merchants, different offers, different legal copy — so these are not translations and must not be canonicalised to each other. Each locale's pages are independent originals with reciprocal `hreflang`.

```ts
// generateMetadata
alternates: {
  canonical: 'https://yourtal.com/id/rewards/kopi-kenangan/voucher-50rb',
  languages: {
    'id-ID': 'https://yourtal.com/id/rewards/kopi-kenangan/voucher-50rb',
    'en-AU': 'https://yourtal.com/au/rewards/...',   // omit the key entirely when no AU equivalent exists
    'x-default': 'https://yourtal.com/',
  },
}
```

Rules: hreflang must be **reciprocal and self-referencing**, and **never point to a near-equivalent** — an Indonesian voucher with no Australian counterpart simply has no `en-AU` alternate. Mirror the alternates in `sitemap.ts`. The root `/` is a crawlable geo/language chooser, **not** an IP-based 302 — IP redirects break crawling from US-based bots, which is all of them. Currency, legal copy (OJK-adjacent framing in ID, ACCC gift-card rules in AU) and merchant sets are partitioned at the data layer, not the view layer.

## 8. Video SEO

Google now requires the video to be **the main content of the page** for video indexing, with a stable, non-obscured thumbnail and `name` + `thumbnailUrl` + `uploadDate` at minimum ([Google video best practices](https://developers.google.com/search/docs/appearance/video)).

Our campaign page satisfies this **only if we publish a real preview**. Therefore:

| Element | Public? | Why |
|---|---|---|
| Title, merchant, duration, category, reward summary | ✅ | |
| **Full transcript** (auto-generated, human-checked) | ✅ | The indexable asset — text is what gets retrieved and cited. |
| **Preview clip ≤90 s**, stable CDN URL + poster image | ✅ | Satisfies "video is the main content"; also converts. |
| Full 1–30 min video, questions, points accrual | ❌ gated | The product. |

Mark the gate truthfully with `isAccessibleForFree: false` + `hasPart` on the gated region, which is [Google's supported pattern for registration-walled content](https://www.playwire.com/blog/google-paywalled-content-structured-data-guidelines-implementation-guide) — it keeps indexing clean without cloaking. Add `SeekToAction` only if we expose chapter deep-links. Emit `videos[]` entries in the campaign sitemap.

**How much to invest: modestly.** Campaign videos are merchant advertising with a shelf life of weeks and will not outrank YouTube on generic terms; durable organic value sits in the voucher and merchant corpus. Publish transcripts because they turn campaign pages into substantive text pages carrying merchant brand terms — an hour per campaign, not a programme. Push merchants with evergreen creative to also post it on **YouTube**, [the strongest single correlate of AI Overview presence](https://www.digitalapplied.com/blog/ai-search-citation-ranking-factors-2026-data-study), at zero cost to us.

## 9. Implementation checklist

| # | Item | Primitive | Phase |
|---|---|---|---|
| 1 | `metadataBase`, root `Organization` + `WebSite` JSON-LD | `app/layout.tsx` | 0 |
| 2 | `generateMetadata` with absolute canonical on every public route | per `page.tsx` | 0 |
| 3 | Route groups `(public)` / `(app)`; `(app)` gets `robots: { index:false, follow:false }` | layout config | 0 |
| 4 | `app/robots.ts` implementing §6 | `MetadataRoute.Robots` | 0 |
| 5 | Locale middleware + `next-intl`, `/id` and `/au` prefixes, crawlable root chooser | middleware | 0 |
| 6 | `hreflang` via `alternates.languages`, reciprocal, no phantom alternates | `generateMetadata` | 0 |
| 7 | Sitemaps per type per locale via `generateSitemaps()`, real `lastModified` | `sitemap.ts` | 1 |
| 8 | `Product`/`Offer`, `LocalBusiness`, `BreadcrumbList`, `ItemList` JSON-LD with linked `@id`s | server component | 1 |
| 9 | ISR + `revalidateTag` on offer/merchant mutation | cache tags | 1 |
| 10 | Indexable-facet allowlist; everything else `Disallow` + no `<a>` emitted | route design | 1 |
| 11 | Expired offer → 301 to merchant page | route handler | 1 |
| 12 | `opengraph-image.tsx` per offer and merchant | ImageResponse | 1 |
| 13 | Campaign page: transcript + preview + `VideoObject` + paywall markup | `page.tsx` | 2 |
| 14 | `/llms.txt` static route | `app/llms.txt/route.ts` | 2 |
| 15 | Help centre: one page per real question, answer in first 60 words, tables | content | 2 |
| 16 | CI: schema validation, canonical/hreflang reciprocity test, sitemap 50k assertion, Lighthouse budgets | CI | 1 |

## 10. Measurement

| What | Tool | Note |
|---|---|---|
| Classical search | Search Console, one property, child views per `/id` and `/au` | The only source of truth for queries and clicks. |
| AI surfaces | **GSC generative-AI performance reports** (global since Aug 2026) | Impressions by page/country/date for AI Overviews + AI Mode — [**no click data, no queries, no position**](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports). Directional only. |
| AI referral traffic | Server-side analytics on referrer (`chatgpt.com`, `perplexity.ai`, `gemini.google.com`, `claude.ai`) | Small volumes, high intent. Segment it from day one — you cannot backfill. |
| AI crawler behaviour | Cloudflare logs, bot-class breakdown | Verifies §6 is actually in effect. The cheapest check we have. |
| Prompt-set citation tracking | **Defer.** If needed, a mid-market tool (Ahrefs Brand Radar / Peec-class, ~$100–130/mo), not enterprise GEO suites | [High run-to-run variance](https://arxiv.org/abs/2607.14035) makes small-sample tracking mostly noise. |
| Rank tracking | Any server-side tracker, ID + AU, mobile, localised | Local-pack and mobile SERPs differ enough that desktop tracking lies. |
| CWV | RUM segmented by country/device (already in [`08`](08-web-app-and-performance.md)) | Field data, not lab. |

**Success criteria at 12 months:** offer + merchant pages are the majority of non-brand organic entries; help-centre pages appear in GSC's generative-AI report for our own mechanics queries. Do not set a target for "AI citations" — it is not reliably measurable, and a target on an unmeasurable metric invites theatre.

## Sources

- **Google:** [generative-AI optimization guide (May 2026)](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) · [SEJ coverage](https://www.searchenginejournal.com/googles-new-ai-search-guide-calls-aeo-and-geo-still-seo/575026/) · [GSC generative-AI reports](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports) · [video best practices](https://developers.google.com/search/docs/appearance/video)
- **Research:** [Critical survey of GEO 2023–2026 (arXiv 2607.14035)](https://arxiv.org/abs/2607.14035) · [original GEO paper (arXiv 2311.09735)](https://arxiv.org/abs/2311.09735) · [Structural Feature Engineering for GEO (arXiv 2603.29979)](https://arxiv.org/html/2603.29979v1)
- **Citation data:** [Ahrefs — 38% of AI Overview citations from top 10](https://ahrefs.com/blog/ai-overview-citations-top-10/) · [DigitalApplied — 2026 citation-factor study](https://www.digitalapplied.com/blog/ai-search-citation-ranking-factors-2026-data-study)
- **Crawlers:** [Wix — debunking llms.txt myths](https://www.wix.com/studio/ai-search-lab/llms-txt-myths) · [Cloudflare — new AI traffic options](https://blog.cloudflare.com/content-independence-day-ai-options/) · [robots.txt across Cloudflare's network, Sept 2026](https://technologychecker.io/blog/robots-txt-ai-crawlers-blocking-report)
- **Technical:** [Next.js sitemap convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap) · [faceted navigation guide](https://searchengineland.com/guide/faceted-navigation) · [CWV/INP 2026](https://www.corewebvitals.io/core-web-vitals) · [FAQ rich results deprecated](https://www.getpassionfruit.com/blog/what-changed-with-google-drops-faq-rich-results-and-what-to-do-now) · [paywalled-content markup](https://www.playwire.com/blog/google-paywalled-content-structured-data-guidelines-implementation-guide)
