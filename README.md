# YourTal

Businesses upload **1–30 minute** campaign videos, author questions that gate the reward, and pre-purchase **YourTal Points** to pay viewers. Users watch, answer, and earn points. All business inventory — vouchers and merchandise — is pooled into **one store priced in points**, at an exchange rate that varies by business. A redeemed voucher is then spendable at that business's own checkout, by whoever holds it.

That makes YourTal three things at once: a long-form video ad platform, the **central bank of a two-sided token economy**, and a **settlement network** between merchants. Sister apps (snap-apps, freetaxreturns, uniqueweightloss, humanspedia) feed points in and share one login.

Ships as a **web app (PWA)** — mobile-first, excellent on tablet and desktop, fast on a mid-tier Android phone over 4G.

**Status:** building toward a staging review on Helios — see [TASKS.md](TASKS.md).

## Documents

| Doc                                                                                      | What it answers                                                                                                                 |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [docs/00-research-summary.md](docs/00-research-summary.md)                               | How Google, Meta, YouTube, TikTok, Shopee and the loyalty/voucher industry actually build this, with sources                    |
| [docs/01-strategy-and-economics.md](docs/01-strategy-and-economics.md)                   | The currency model, unit economics, and what the numbers say the product must be                                                |
| [docs/02-architecture.md](docs/02-architecture.md)                                       | Domain map, watch/reward hot path, ledger design, tech choices, deployment topology                                             |
| [docs/03-regulatory-and-risk.md](docs/03-regulatory-and-risk.md)                         | Indonesian and Australian regulatory map, and the 28-item risk register                                                         |
| [docs/04-roadmap.md](docs/04-roadmap.md)                                                 | Phases with gates, team shape, buy-vs-build                                                                                     |
| [docs/05-open-questions.md](docs/05-open-questions.md)                                   | What we need from you to make this executable                                                                                   |
| [docs/06-longform-video-and-attention.md](docs/06-longform-video-and-attention.md)       | 1–30 min video: cost, completion design, the question mechanic, ingest & moderation                                             |
| [docs/07-coalition-clearing-and-commerce.md](docs/07-coalition-clearing-and-commerce.md) | Partner funding, inter-business clearing & settlement, the merchandise leg                                                      |
| [docs/08-web-app-and-performance.md](docs/08-web-app-and-performance.md)                 | Web/PWA decision, the fraud consequence, performance budgets                                                                    |
| **[docs/09-points-economy-and-redemption.md](docs/09-points-economy-and-redemption.md)** | **The inner economy: pricing, solvency, faucets and sinks, voucher transfer, and the merchant redemption protocol**             |
| **[docs/10-tech-stack.md](docs/10-tech-stack.md)**                                       | **The stack, right-sized — and why video delivery is ~90% of the infrastructure bill**                                          |
| [docs/11-seo-aeo-geo.md](docs/11-seo-aeo-geo.md)                                         | SEO, answer-engine and generative-engine optimisation; AI crawler policy; i18n routing                                          |
| [docs/12-patterns-from-the-giants.md](docs/12-patterns-from-the-giants.md)               | What to copy from Stripe, Square, YouTube, Shopify, Google, Cloudflare and Netflix — and what to improve                        |
| [docs/13-engineering-standards.md](docs/13-engineering-standards.md)                     | The 300-line rule and its refactor vocabulary, component architecture, module boundaries, testing, API conventions, CI gates    |
| [docs/13a-go-standards.md](docs/13a-go-standards.md)                                     | Go: layout, errors, context, interfaces, chi/pgx/sqlc conventions, `.golangci.yml`                                              |
| [docs/13b-typescript-standards.md](docs/13b-typescript-standards.md)                     | TypeScript: tsconfig, no-`any`, Zod boundaries, `neverthrow`, barrel ban, server/client boundary                                |
| [docs/14-security-engineering.md](docs/14-security-engineering.md)                       | Threat model, key management, API security, supply chain, incident response                                                     |
| **[docs/15-stack-locked.md](docs/15-stack-locked.md)**                                   | **The stack we use. Decided, no options.**                                                                                      |
| **[docs/16-decisions.md](docs/16-decisions.md)**                                         | **Every open question answered, with the precedent it follows.**                                                                |
| **[docs/17-surfaces-and-roles.md](docs/17-surfaces-and-roles.md)**                       | **What the product looks like, the business/user/staff dashboards, role model, and the logged-out experience**                  |
| **[docs/18-engines.md](docs/18-engines.md)**                                             | **All fourteen engines, what each covers, and how smart each one actually is**                                                  |
| **[docs/19-cold-start-and-data-strategy.md](docs/19-cold-start-and-data-strategy.md)**   | **Breaking the two-sided cold start, momentum mechanics, and the data thesis — with what it does and does not license legally** |
| **[docs/20-interest-and-preference.md](docs/20-interest-and-preference.md)**             | **How we learn what people want — signals, scoring, consent partitions, and when ML actually earns its place**                  |
| **[docs/21-failed-analogues.md](docs/21-failed-analogues.md)**                           | **Who tried this before and what happened — Plenti, Groupon merchant data, and the survivor rule**                              |
| [docs/21a-case-studies.md](docs/21a-case-studies.md)                                     | Company-by-company evidence: Viggle, Perk, Swagbucks/Prodege, Mistplay, BAT, Indonesian precedents                              |
| [docs/22-assumption-audit.md](docs/22-assumption-audit.md)                               | Technical claims in this plan, verified or debunked                                                                             |
| **[docs/23-critique.md](docs/23-critique.md)**                                           | **What is wrong with this plan — read this before the investor conversation**                                                   |
| **[docs/24-legal-positions.md](docs/24-legal-positions.md)**                             | **Every legal position, sourced and risk-rated — the artefact that replaces counsel, and the red lines that cannot be crossed** |

## Tracker

**[TASKS.md](TASKS.md)** is the plan and the single source of truth for status: fourteen phases to a staging build on Helios, with every task and subtask as a checkbox that sessions tick as they go. `pnpm progress` rebuilds its progress table. The audit it was written from is in [`docs/audit/2026-09-25/`](docs/audit/2026-09-25/); the previous generated board is archived in [`docs/tasks/`](docs/tasks/README.md).

## The six things to know before reading anything else

1. **We are not selling impressions — we are selling CAC.** A completed 25-minute view with a verified recall score, plus a voucher that requires a store visit, is not a CPM unit. A business funding a IDR 50,000 voucher (IDR 15,000 real cost) plus a IDR 10,000 platform fee pays **IDR 25,000 per engaged, verified prospect**, against Indonesian Meta/Google CAC of IDR 50,000–200,000. That comparison is the entire sales pitch.

2. **The economy works because of a margin gap, not magic.** A 70%-margin merchant gives up IDR 50,000 of retail value at a real cost of IDR 15,000. The user genuinely receives IDR 50,000. Nobody is deceived, and yet ~IDR 35,000 of perceived value per voucher comes out of margin structure alone. **Everything in [`09`](docs/09-points-economy-and-redemption.md) exists to stop that gap being arbitraged, inflated or stolen.**

3. **Suppliers declare a settlement value; YourTal computes the points price.** If businesses set point prices directly, any one of them can underprice and drain the platform — that is the default outcome, not a hypothetical. `points_price = (S / B) × demand_multiplier` gives you the per-business exchange rate you want, as a consequence of how deeply each business subsidises, while keeping the margin structurally constant.

4. **The solvency invariant is the most important rule in the platform.** `Reserve / (points outstanding × B) ≥ 1.0`. Every point issued without a business paying for it — promos, referrals, sister-app rewards — must be backed by a real cash transfer into the reserve at the moment of issuance. Otherwise the platform is printing money, and the failure is silent until the store empties.

5. **Web costs us the strongest fraud control that exists.** No Play Integrity, no App Attest — at exactly the moment rewards became voucher-scale. Compensate with mandatory phone OTP (strong in Indonesia, where SIMs are NIK-bound), WebAuthn passkeys, per-checkpoint tokens, a **CDN segment-log cross-check** that needs no client cooperation, a 72-hour holdback, and trust tiering. Keep a Capacitor wrap as the escape hatch.

6. **Run the pilot before writing any code.** The model rests on two untested assumptions: that people will watch 15–30 minutes for a voucher, and that a business will pay per completed view. A landing page, one merchant's video, a Google Form and 200 manually-issued vouchers tests both in a fortnight. See [Phase −1](docs/04-roadmap.md).
