# YourTal — Research Summary

**Date:** 2026-09-18
**Scope:** How market leaders build the eight systems YourTal needs, and what the regulators in AU + ID actually require.

---

## 1. Ad serving & decisioning (Google / Meta / Moloco / Kevel)

**Latency is the architecture.** DSP/ad-decision responses target **20–30 ms**; teams model a budget of roughly 50 ms each for network, processing and serialisation. Payloads are kept flat and **≤10 KB**, HTTP/2 with persistent connections, async SDKs. Routing to the nearest region alone cuts 30–50 ms of median latency.

**The cascade.** Nobody scores every ad. The industry-standard shape is:

```
retrieval (10s of thousands)  ->  pre-ranking (hundreds)  ->  ranking (final few)
  two-tower embeddings           cheap pCTR MLP              heavy DLRM / MMoE
  ANN index, precomputed         eCPM = 1000 x bid x pCTR    calibrated pCTR/pCVR
```

Meta's _Andromeda_ retrieval narrows tens of millions of ads to a few thousand before the expensive models run. Ranking models are multi-task (separate heads for eCPM, pCTR, pBid); TikTok's fine-ranking uses **MMoE** to trade off competing objectives (watch time vs. like vs. share) — directly relevant to us, because we must trade off _advertiser value_ vs. _user reward satisfaction_ vs. _platform margin_.

**Budget pacing is a correctness problem, not an optimisation.** Overspend is irreversible. The standard technique is a **participation probability** per campaign, recomputed continuously against a delivery schedule derived from forecasted supply; lower the probability when ahead of pace. Note Google itself allows **2x daily budget** on a given day and only balances at the month level — a deliberate design choice we should copy or reject consciously.

**Build vs. buy.** There is **no production-grade open-source ad server** for this shape of product. Retail-media operators in 2026 pick API-first infrastructure (Kevel, Topsort, Koddi) or closed ecosystems (Criteo, Amazon). Building from scratch costs "years and hundreds of thousands" in engineering. Also worth internalising: _self-serve grows advertiser count, managed service grows account value — every network that scaled did both._

## 2. Rewarded video specifically

- Flow: mediation SDK requests → winning bidder serves 15–30 s creative → user completes → **client-side callback** fires → app grants reward.
- **The client callback is not trustworthy.** Every serious network offers **server-side verification (SSV)**: a signed server-to-server callback to a publisher endpoint before credit is granted. For anything with real economic value, credit only on SSV.
- SSAI (server-side ad insertion) is explicitly called out as a _fraud vector_ — the stitching layer makes verification harder. Relevant if we ever stitch ads into long-form content.
- Completion rates >95% for rewarded vs 60–70% non-rewarded; engagement ~3.5x. The format works; the only question is what it pays.

## 3. Video delivery (Netflix / YouTube)

Netflix's pipeline: **ingest → chunked parallel encode across hundreds of workers (VMAF-scored) → Open Connect CDN**, with per-title/per-shot encoding ladders cutting bandwidth up to ~40%, and two-tier appliances (IXP storage + ISP-embedded edge).

**Assessment for us:** the Netflix problem is a _petabyte catalogue of long-form_ content. Ours is _thousands of 15–30 s creatives, heavily repeated, extremely cacheable_. We need Netflix's **outcomes** (instant start, no rebuffer, ABR) but almost none of its **machinery**. Per-title encoding, chunked distributed transcode and a custom CDN are phase-3+ optimisations at best. Prefetching the next 2–3 creatives onto the device while the current one plays buys most of "instant" for near-zero cost.

**Managed video cost (2026):** Cloudflare Stream ≈ $5 / 1,000 min stored + $1 / 1,000 min delivered, encoding included. Mux ≈ $0.07/min encode + $0.025/min deliver (5–8x Cloudflare, better live + analytics). AWS MediaConvert + CloudFront is "rarely the right choice in 2026" due to egress.

## 4. Recommendation / personalisation (TikTok Monolith)

TikTok's **Monolith**: TensorFlow worker–parameter-server architecture, **collisionless embedding tables** (Cuckoo hash) so new users/items get clean embeddings, and **online (real-time) training** so the feedback loop closes in minutes rather than a nightly batch. Designed explicitly around feature sparsity, concept drift, scalability and fault tolerance.

Takeaway: the "glue users like TikTok" property comes from _fast feedback loops on implicit signals_, not from model size. A modest model retrained hourly beats a large model retrained weekly.

## 5. Points ledger & loyalty accounting

- Under **ASC 606** (and equivalents), issued points are a **deferred-revenue liability**, not revenue. They become revenue on redemption or on provable **breakage**. Starbucks recognised **$200.4 M** of breakage revenue in FY2025 — breakage is a material line item and estimating it is a board-level policy decision.
- Capillary (a large loyalty vendor) rebuilt on **double-entry**: an append-only, immutable event log of `OPENING BALANCE / CREDIT / DEBIT`. Their stated motivation is exactly our risk: _"corrupted, duplicate, or missing data entries"_ caused by _"multiple access points in the code"_ and divergent business logic across services.
- The liability must be revalued monthly/quarterly as points are issued and redeemed.

**Takeaway:** one service owns the ledger; no other service writes balances; the ledger is append-only and every mutation is balanced. This must exist before anything that issues points.

## 6. Voucher / gift-card security

Consensus best practice:

- **High-entropy codes**: ≥16 random alphanumerics, CSPRNG, no counters, no merchant prefixes that aid enumeration, optional checksum (Luhn-style) for typo detection.
- **Store encrypted / hashed**; per-card audit log of every state change.
- **Rate-limit + CAPTCHA the balance-check and redemption endpoints** — repeated failed lookups are the canonical enumeration signal.
- **2FA for staff** with issuance or adjustment rights; role-scoped permissions; alerts on high-value voids and duplicate issuance.
- Offline/POS redemption: sign the payload (**Ed25519 + CBOR + compression** fits inside a QR), **30 s – 5 min validity**, scheduled key rotation — this defeats screenshot-sharing without needing a POS integration.

**Secondary-market warning.** The gift-card resale sector is a graveyard: **Cardpool shut down (2021, fraud from stolen cards)**; Raise is widely reported for fraudulent cards, chargebacks and revoked balances. Root cause: **the seller still knows the code after selling it**, and the card schemes have **no gift-card dispute category**, so the merchant loses chargebacks without delivery evidence. Any YourTal voucher bidding market must be built so that a transfer _invalidates the old code and mints a new one_ — not merely moves a database row.

## 7. Auctions / bidding marketplace

- **Per-auction serialisation** is the core correctness requirement: either an atomic Lua script on Redis/Valkey (single-threaded → serialisation for free) or a per-auction Kafka partition. Optimistic concurrency with expected-price CAS works at lower scale.
- **Anti-sniping**: a bid within the last _N_ minutes extends the auction by _N_, capped at a max number of extensions (eBay Live, Catawiki).
- **Settlement must be effectively-once**: after retries, exactly one committed winner and exactly one captured charge. Plan for failed capture → second-chance offer.
- Read and write paths are asymmetric — separate them; WebSocket fan-out for live bid broadcast.

## 8. Identity for a family of apps

- **Keycloak** — single binary, realms + (since v26) first-class **Organizations**, admin UI, themes, no per-MAU fee, widest DB support; cost is staying on top of a steady CVE cadence.
- **Ory** — API-only Go services (Kratos / Hydra / Keto / Oathkeeper), no built-in login UI (you build it), Zanzibar-style authz, proven at very large scale. Needs frontend capacity.
- **Auth0** — fastest to stand up; Organizations needs a paid B2B plan (from ~$150/mo, July 2026) with org-count limits below Enterprise; per-MAU economics are hostile to a consumer platform aiming at millions of users.

All three speak OAuth2 / OIDC / SAML — so "Google-style login for sister apps" is a standard **OIDC provider + one client per app + consent screen**, not a custom protocol.

## 9. Fraud & abuse (the existential risk for reward platforms)

The 2026 threat model for reward apps is **mobile bots, emulators, device farms, fake installs and account takeover executing inside the app runtime**. Emulators are attractive precisely because synthetic devices can be created, driven and destroyed by bots at scale — used for account creation, **referral fraud**, **reward abuse** and payment testing.

Defences that work:

- **Device fingerprinting** (200+ signals) catches emulator/VM artefacts — hardware model strings, missing sensor data, virtualised GPU renderers — _before_ registration.
- **Behavioural / post-event analysis**: impossible timing, identical flows across "users", repeated device reuse, D1-retention and session-duration distributions by acquisition source.
- **Server-side validation before crediting anything of value** — repeatedly named as the place most abuse is actually caught.
- IAB Tech Lab has added **device attestation to the Open Measurement SDK** specifically to combat device spoofing.
- MRC **GIVT/SIVT** filtration is the measurement-side baseline any serious advertiser will ask us for.

## 10. Survey monetisation

- Offerwalls are the native home of surveys, and **surveys carry the highest incentives** of any offer category. Android offerwall eCPMs for games average ~**$400**, up to ~$1,500 in the best genres — orders of magnitude above video.
- Quality infrastructure is table stakes: unique user IDs, device–carrier validation, **trap questions**, and alignment with **ESOMAR 28/37** disclosure plus ISO certification. Buyers of sample literally _ask for your ESOMAR 37 answers_.
- Publisher-side control matters: enable/disable providers by performance, price floors, minimum conversion filters.

## 11. Ad economics — the numbers that decide the product

| Format                                  | eCPM (2026)                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------ |
| Rewarded video, tier-1 (US/UK/JP)       | $15–$40                                                                                    |
| Rewarded video, **Australia (Android)** | **$18.87** — top globally                                                                  |
| Rewarded video, global average          | high single to low double digits                                                           |
| **Offerwall (Android, games)**          | **~$400 avg, up to $1,500**                                                                |
| Indonesia                               | no clean public rewarded figure; ID is a tier-3 CPM market, growing (App Open +30% in Dec) |

Rewarded video is ~40% of in-game ad revenue. **The spread between $18 video and $400 offerwall is the single most important fact in this document** — see `01-strategy-and-economics.md`.

## 12. Payments

**Indonesia** — Midtrans (GoTo group; native GoPay, fast settlement, ID-language docs, **collection only**) vs **Xendit** (modern API, good docs, and critically **disbursement** — programmatic payouts to bank accounts). Marketplaces typically run **Xendit for payouts + whichever collector fits the UX**. **QRIS MDR is fixed by BI at 0.7%**, so pricing is not a differentiator — developer experience and features are. Both support BI-FAST disbursement.

**Australia** — NPP connects 100+ institutions for real-time payments with central-bank finality; **PayTo** gives consented pull-from-bank (good for advertiser billing and subscriptions). Marketplace split payments and payouts → Stripe Connect or equivalent, with identity checks built in.

## 13. Blockchain — honest assessment

Real production exists (UniVoucher, GiftUp on TRON, Rehive/Stellar tokenised vouchers, CoinsBee cross-border) but the consensus is blunt: **centralised ledgers are faster, simpler and cheaper**; blockchain adds value narrowly — cross-border settlement, trustless secondary-market transfer, and multi-party consortium governance — and costs a great deal in development, ops and (for us) regulatory surface. Verdict: _a pragmatic niche, not a superior general solution_.

## 14. Super-app engineering lessons (Gojek / Grab)

- All of them **migrated off the monolith during growth** — but all of them also **started with one high-frequency service**, earned daily habitual use, and only then expanded.
- Gojek: GCP, PostgreSQL, **Kafka** message bus, edge proxies; services partitioned **"by frequency of access rather than by function."**
- The recurring advice: build the **Platform Foundation as an internal PaaS first** — Identity, Wallet, Event Bus — _before_ the headline feature. For a platform like ours, that foundation **is** the product.

---

## Sources

**Ad serving & decisioning:** [Aerospike AdTech DSP reference architecture](https://aerospike.com/files/white-papers/adtech-reference-architecture-whitepaper.pdf) · [Moloco ad-serving E2E latency](https://mcm-docs.moloco.com/docs/ad-serving-e2e-latency) · [Redpanda DSP reference architecture](https://www.redpanda.com/blog/reference-architecture-demand-side-platform-adtech) · [Meta Andromeda retrieval engine](https://engineering.fb.com/2024/12/02/production-engineering/meta-andromeda-advantage-automation-next-gen-personalized-ads-retrieval-engine/) · [Bidding-aware retrieval (arXiv 2508.05206)](https://arxiv.org/html/2508.05206) · [COPR consistency-oriented pre-ranking (arXiv 2306.03516)](https://arxiv.org/pdf/2306.03516) · [Two-tower retrieval, Google Cloud](https://docs.cloud.google.com/architecture/implement-two-tower-retrieval-large-scale-candidate-generation)

**Budget pacing:** [A Practical Guide to Budget Pacing Algorithms (arXiv 2503.06942)](https://arxiv.org/pdf/2503.06942) · [Smooth budget delivery (arXiv 1305.3011)](https://arxiv.org/pdf/1305.3011) · [Percentile risk-constrained pacing (arXiv 2312.06174)](https://arxiv.org/html/2312.06174) · [Ad pacing in Google Ads](https://www.stackmatix.com/blog/ad-pacing-google-ads)

**Rewarded video & measurement:** [Google AdMob rewarded ads SSV](https://developers.google.com/admob/android/rewarded) · [Google Ad Manager rewarded](https://support.google.com/admanager/answer/7386053) · [AdExchanger on SSAI](https://www.adexchanger.com/adexplainer/adexplainer-what-is-server-side-ad-insertion-ssai/) · [smartclip on OM SDK viewability](https://smartclip.tv/resources/adtech-insights/implement-iab-open-measurement-sdk-improve-viewability/) · [IAB MRC IVT guidelines addendum](https://www.iab.com/guidelines/mrc-invalid-traffic-ivt-detection-and-filtration-guidelines-addendum/) · [IAB/MRC Retail Media Measurement Guidelines](https://www.iab.com/wp-content/uploads/2024/01/IAB_Retail_Media_Measurement_Guidelines_January2024.pdf) · [IAB Tech Lab device attestation in OM SDK](https://aijourn.com/iab-tech-lab-launches-device-attestation-support-in-open-measurement-sdk-to-combat-device-spoofing/)

**Video:** [Netflix video processing pipeline](https://singhajit.com/netflix-video-processing-pipeline/) · [Netflix tech stack & Open Connect](https://www.vdocipher.com/blog/netflix-tech-stack-and-architecture/) · [Video streaming pricing comparison 2026](https://www.buildmvpfast.com/api-costs/video) · [Mux vs Cloudflare Stream vs CloudFront](https://leanopstech.com/blog/mux-vs-cloudflare-stream-vs-cloudfront-2026/)

**Recommendation:** [Monolith: real-time recommendation with collisionless embedding tables (arXiv 2209.07663)](https://arxiv.org/pdf/2209.07663) · [Monolith paper review](https://haneulkim.medium.com/paper-review-monolith-tiktoks-real-time-recommender-system-72b90bece653)

**Ledger & loyalty accounting:** [Loyalty points are a liability, not revenue — ASC 606](https://beancount.io/blog/2026/07/19/loyalty-points-liability-not-revenue-asc-606-guide) · [Capillary: double accounting in Loyalty+](https://medium.com/capillary-tech/double-accounting-system-in-loyalty-enhanced-reliability-f4fa3753dc62) · [Building a double-entry ledger](https://medium.com/@altuntasfatih42/how-to-build-a-double-entry-ledger-f69edcea825d)

**Vouchers:** [Voucherify fraud prevention](https://support.voucherify.io/article/516-fraud-prevention) · [Fraud.com on gift card fraud](https://www.fraud.com/post/gift-card-fraud) · [Wrapped: gift card fraud prevention](https://wrappedgiftcards.com/guides/gift-card-fraud-prevention) · [Secure QR codes via EdDSA + CBOR (arXiv 2607.08383)](https://arxiv.org/html/2607.08383v1) · [Voucherify: QR coupons that don't get screenshot-abused](https://www.voucherify.io/blog/use-qr-codes-to-integrate-promotions-in-your-mobile-app) · [Gift card chargebacks](https://www.chargeflow.io/blog/gift-card-chargeback) · [Cardpool shutdown](https://flip.gift/cardpool-alternative) · [Raise.com](https://en.wikipedia.org/wiki/Raise.com)

**Auctions:** [Online auction system design — 50K bids/s, anti-sniping, effectively-once settlement](https://crackingwalnuts.com/post/online-auction-system-design) · [Design online auction (eBay)](https://www.systemdesignhandbook.com/guides/design-online-auction/)

**Identity:** [Keycloak vs Ory vs Zitadel 2026](https://tech-insider.org/keycloak-vs-ory-vs-zitadel-2026/) · [Auth0 B2B Connect vs Keycloak Organizations](https://skycloak.io/blog/auth0-b2b-connect-vs-keycloak-organizations/) · [Ory Kratos vs Auth0 vs Keycloak 2026](https://apiscout.dev/guides/ory-kratos-vs-auth0-vs-keycloak-2026)

**Fraud:** [Appdome: what is mobile app fraud, 2026 trends](https://www.appdome.com/dev-sec-blog/what-is-mobile-app-fraud/) · [SEON: detecting device farms and emulator rings](https://seon.io/resources/device-farm-emulator-ring-detection/) · [DataVisor: device emulators](https://www.datavisor.com/wiki/device-emulators) · [AppSamurai: fraud in rewarded UA](https://appsamurai.com/blog/fraud-in-rewarded-ua-how-to-detect-it-early-and-stop-it-at-scale/) · [Fingerprint: device fingerprinting](https://fingerprint.com/blog/device-fingerprinting/)

**Surveys:** [Pollfish survey offerwalls](https://www.pollfish.com/blog/app-monetization/lets-talk-about-survey-offerwalls/) · [Pollfish quality & fraud prevention](https://www.pollfish.com/resources/blog/pollfish-school/how-pollfish-prevents-fraudulent-responses/) · [ESOMAR 37](https://www.surveymonkey.com/mp/legal/esomar-37/)

**Economics:** [App ad revenue benchmarks 2026 by format/region](https://revenueflex.com/blog/app-ad-revenue-benchmarks-2026/) · [Rewarded video ads 2026 eCPMs](https://coinis.com/glossary/rewarded-video) · [Business of Apps: rewarded video](https://www.businessofapps.com/ads/rewarded-video/) · [Mistplay: mobile ads eCPM](https://business.mistplay.com/resources/mobile-ads-ecpm)

**Payments:** [Midtrans vs Xendit for Indonesian marketplaces](https://dev.to/hem_081a27fed379/integrating-payments-in-indonesia-midtrans-vs-xendit-and-when-to-pick-which-5eb6) · [Xendit QRIS](https://www.xendit.co/en/payment-channel/qris/) · [Indonesia payments operator guide](https://paymentbrief.com/articles/indonesia-payments-operator-guide/) · [Stripe: PayTo guide](https://stripe.com/resources/more/payto-an-in-depth-guide) · [Stripe: NPP in Australia](https://stripe.com/resources/more/new-payments-platform-in-australia)

**Build vs buy:** [Kevel: retail media build vs buy](https://www.kevel.com/blog/retail-media-build-vs-buy) · [Retail media ad tech infrastructure stack](https://www.osmos.ai/blog/ad-tech-infrastructure-building-the-engine-behind-retail-media) · [Retail media ad servers compared 2026](https://kontrolmedia.com/comparison-of-retail-media-ad-servers/)

**Blockchain:** [Why tokenize vouchers on Stellar (Rehive)](https://medium.com/rehive-blog/why-tokenize-vouchers-and-gift-cards-on-stellar-9b407d873fe9) · [TokenD voucher tokenisation](https://tokend.io/vouchers/) · [Why a centralised database beats blockchain](https://psqr.eu/publications-resources/centralized-database-vs-blockchain/)

**Super-app engineering:** [Gojek microservices + Kafka](https://wildangbudhi.medium.com/microservices-clean-architecture-and-kafka-in-gojek-c5fbe60dea9c) · [How Go-Jek scales with cloud](https://www.computerweekly.com/news/252446425/How-Indonesias-Go-Jek-scales-the-heights-with-cloud) · [Super app architecture](https://appscrip.com/blog/super-app-architecture/)

**Gamification:** [Shopee gamification & SEA e-commerce innovation](https://seasia.co/2025/05/12/shopee-gamification-and-ai-southeast-asias-e-commerce-innovation-in-the-global-spotlight) · [Gamification affordance & customer engagement (JISEBI)](https://e-journal.unair.ac.id/JISEBI/article/download/62172/33431)
