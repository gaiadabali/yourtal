# YourTal — Technology Stack

**Date:** 2026-09-18
**Status:** Recommended. Supersedes the stack table in [`02-architecture.md`](02-architecture.md) §7.

---

## 0. A correction I need to make first

My earlier stack recommendation (Go + NestJS + Python, Kafka, ClickHouse, Kubernetes, ~25 microservices) was sized for a **classic ad network** — millions of ads, 100k+ requests/second, a 30 ms decisioning cascade with two-tower retrieval.

**That is not this product.** Now that the model is clear, the actual load is:

| | Classic ad network | **YourTal** |
|---|---|---|
| Candidate ads | Tens of millions | **Hundreds to low thousands** (direct-sold) |
| Decisions per user per day | 100–500 impressions | **2–10 watch sessions** |
| Peak decision rate at 1M DAU | 100,000+ rps | **~500 rps** |
| Decision complexity | Retrieval → pre-rank → rank | **Filter and sort a few hundred rows** |

At 100k DAU you are looking at roughly **6 requests per second average, maybe 50 at peak**. At 1M DAU, ~60 average and ~500 peak. A single well-tuned Postgres and one Node process handles that with room to spare.

**The heavy things are elsewhere:** video delivery (outsourced), watch-position telemetry (append-only, batched), and reporting (ClickHouse, eventually). None of them need Kafka or Kubernetes on day one.

So the recommendation below is deliberately **smaller and more boring** than what I first proposed, with explicit triggers for when to graduate. Building the big version first would cost months and buy nothing.

---

## 1. Principles

1. **One language until a second one earns its place.** TypeScript across web and API. The performance case for Go does not exist at 60 rps, and the frontend is now a first-class, demanding surface.
2. **Modular monolith, not microservices.** The domain map in [`02`](02-architecture.md) is the *logical* decomposition. It does not have to be the *physical* one. Gojek migrated off the monolith **during** growth, not before it.
3. **Boring where it must be correct.** Postgres for the ledger. No exotic datastore in the value path.
4. **Buy the hard parts.** Video encoding and delivery, bot defence, payments, courier logistics, digital-goods supply. Build only the reward loop, the economy and the redemption network — which have no vendor equivalent.
5. **Get country isolation and idempotency right on day one.** Both are brutal to retrofit. Everything else can be changed later.

---

## 2. The stack

### 2.1 Frontend — the surface that has to be excellent

| Concern | Choice | Notes |
|---|---|---|
| Framework | **Next.js (App Router) + React Server Components** | Ship HTML, not a framework that then fetches content. Server-render the feed, campaign cards and store |
| Styling | **Tailwind + Radix primitives** (shadcn-style) | Headless keeps the JS budget. No component kit that ships 300 KB to render a card |
| Video | **`hls.js`**, native HLS on Safari | Player bundle loaded **on intent** (tap), never in the shell |
| Client state | **TanStack Query** where server components are not enough | Do not reach for a global store by default |
| Forms/validation | **Zod** schemas shared with the backend | One contract, two consumers |
| i18n | **next-intl** | Bahasa Indonesia + English from day one |
| PWA | **Serwist** service worker | App shell, store catalogue, **offline voucher QR** (hard requirement) |
| Charts | Lightweight (uPlot / visx) for advertiser reporting | Not a 500 KB charting library |
| Testing | **Vitest** + **Playwright** | Playwright also drives the CWV budget checks |

**Three surfaces, one codebase:**

| Surface | Priority | |
|---|---|---|
| **User app** | Mobile-first | Bottom nav, full-bleed video, thumb-reachable |
| **Advertiser console** | Desktop-first | Campaign building, question authoring, upload, reporting |
| **Merchant portal** | Mobile-first, ruthlessly | A cashier's phone in a busy shop. Two taps, huge targets, works offline |

**Performance budgets, enforced in CI** (Lighthouse CI on every PR, plus RUM segmented by country and device class):
`LCP ≤ 2.0s · INP ≤ 200ms · CLS ≤ 0.1 · initial JS ≤ 170KB gz · first video frame ≤ 1.0s` — measured on **mid-tier Android over 4G**, not an iPhone on Wi-Fi.

### 2.2 Backend

| Concern | Choice | Notes |
|---|---|---|
| Runtime | **Node 22+ / TypeScript** | |
| Framework | **NestJS** | Opinionated structure and DI pay off with a mixed or partly-outsourced team — anyone can move between modules. *Alternative for a small senior team: Fastify or Hono with a hand-rolled module layout* |
| DB access | **Drizzle ORM** | Closer to SQL than Prisma, and in a financial system you want to see exactly what query runs. Better perf, no separate engine binary |
| Validation | **Zod**, shared with the frontend | |
| Background jobs | **pg-boss** (Postgres) or **BullMQ** (Redis) | Not Kafka. See §5 for when that changes |
| API style | **REST + OpenAPI**, typed client generated for the frontend | GraphQL adds ceremony this product does not need |
| Auth (identity provider) | **Zitadel** (or Keycloak) | We need to *be* an OIDC provider for the sister apps. Zitadel is far lighter to operate than Keycloak with the same capability; Keycloak if you have the ops appetite. **Avoid Auth0** — per-MAU pricing is hostile at consumer scale |
| Authorization | **Cerbos** | Policy-as-code, stateless decision point, auditable. OpenFGA only if relationship-based authz gets genuinely complex |
| Python service | **FastAPI**, phase 2 only | For ML scoring. Nothing in phase 1 needs Python |

### 2.3 Data

| Concern | Choice | Notes |
|---|---|---|
| Primary OLTP | **PostgreSQL 16+**, managed (Cloud SQL / RDS) | **Schema per domain, never shared tables.** One instance per region until it hurts |
| Ledger | **Postgres, same instance, own schema, own credentials** | Append-only, double-entry, generated hash column, `idempotency_key UNIQUE`, `CHECK` constraints on balanced transfers. *TigerBeetle only if you ever exceed ~5k transfers/sec — you will not for years* |
| Hot state | **Redis / Valkey** | Sessions, rate limits, checkpoint nonces, price locks, hold TTLs |
| Analytics | **ClickHouse Cloud** — *when reporting hurts* | Watch events, checkpoint answers, delivery logs. Start by querying Postgres replicas |
| Object storage | **Cloudflare R2** | **Zero egress fees** — this becomes strategically important, see §4 |
| Search | Postgres full-text | Meilisearch only when the store catalogue is genuinely large |

### 2.4 Video

| Concern | Choice |
|---|---|
| Ingest | **Cloudflare Stream direct creator uploads** (signed URLs) — video never touches our servers |
| Encode + package + deliver | **Cloudflare Stream** (phase 1) |
| Transcript for moderation | **Deepgram** or Whisper on a worker |
| Policy screen | **Claude Sonnet 5** over transcript + sampled frames + OCR, producing per-timestamp flags |
| Human review | Internal queue, reviewers see **flagged timestamps only**, never the whole 30 minutes |
| Player | `hls.js`, 360–480p default on cellular, capped at 720p |

### 2.5 AI

| Use | Phase | Model |
|---|---|---|
| Creative moderation & policy screening | 1 | **Claude Sonnet 5** — high volume, structured output |
| Question-bank review (PII smuggling, unanswerable questions) | 1 | **Claude Sonnet 5** |
| Advertiser copilot ("describe your campaign") | 2–3 | **Claude Opus 5** — low volume, high value |
| Fraud scoring | 1 rules → 2 ML | Rules and heuristics first; Python/FastAPI + gradient boosting in phase 2 |
| Ranking (pCTR) | 2 | Only once there is enough data for it to mean anything |
| Support triage | 3 | **Claude Haiku 4.5** |

> For **development and evaluation** — prompt iteration, offline moderation benchmarking, synthetic test data — the shared Ollama Cloud endpoint in your global config is a sensible cheap tier. Per your own note, keep it out of the production path: it is rate-limited and shared, and creative moderation is a compliance control that cannot depend on it.

### 2.6 Infrastructure

| Concern | Choice | Notes |
|---|---|---|
| Cloud | **GCP** (`asia-southeast2` Jakarta + `australia-southeast1` Sydney) | AWS `ap-southeast-3` / `ap-southeast-2` is equally fine — decide on team expertise. Slight lean to GCP for Cloud Run and the Gojek-proven Jakarta region |
| Compute | **Cloud Run** (or ECS Fargate / Fly.io) | **Not Kubernetes.** Scale-to-zero, no cluster to babysit |
| Edge | **Cloudflare** — CDN, Turnstile, R2, WAF, DNS | Doing a lot of heavy lifting; the cloud choice matters less because of it |
| IaC | **Terraform** | Two near-identical data planes from one module |
| CI/CD | **GitHub Actions** | Includes the CWV budget gate |
| Secrets | Cloud Secret Manager + **KMS envelope encryption** for voucher codes and PII | |
| Observability | **OpenTelemetry → Grafana Cloud** (Mimir/Loki/Tempo) | From the first service, not later |
| Error tracking | **Sentry** | |
| Payments | **Xendit** (ID — collection *and* disbursement in one integration), **Stripe** (AU) | Add Midtrans later only if GoPay conversion proves it matters |

### 2.7 Repository

**pnpm workspaces + Turborepo monorepo.**

```
yourtal/
├── apps/
│   ├── web/              Next.js — user app, advertiser console, merchant portal
│   └── api/              NestJS — modular monolith (see §3)
├── packages/
│   ├── contracts/        Zod schemas + generated OpenAPI types  ← the spine
│   ├── db/               Drizzle schema + migrations
│   ├── ui/               design system
│   ├── sdk-server/       @yourtal/earn — for sister apps
│   └── sdk-merchant/     redemption client for merchants
├── services/
│   └── media-worker/     transcript, moderation, encode callbacks
└── infra/                Terraform
```

The `contracts` package is the highest-leverage thing in the repo: one Zod schema is simultaneously API validation, the frontend's types, and the sister-app SDK's types.

---

## 3. Modular monolith → services

Start with **three deployables**: `web`, `api`, `media-worker`. Inside `api`, enforce module boundaries in code:

- one folder per domain, each with its **own Postgres schema**,
- cross-domain calls go through a **published interface**, never a direct table read,
- an ESLint boundary rule fails the build on a cross-module import.

Then a module extracts into its own service in an afternoon, because the seam already exists.

**The seams, in the order they will want to split:**

| # | Extract | Trigger |
|---|---|---|
| 1 | **Redemption Network** | Merchants integrate directly — different SLA, different security zone, different blast radius. Likely the first split |
| 2 | **Ledger + Pricing + Solvency** | When you want separate credentials, separate network zone, and a change-review gate on the value path |
| 3 | **Watch Session / checkpoints** | When position-reporting traffic dominates the API |
| 4 | **Media worker** | Already separate |
| 5 | **Decisioning** | Only at real scale, and only if profiling says so |

**Do not pre-split.** A twenty-service estate run by eight engineers is how a platform loses a year.

---

## 4. The only infrastructure cost that matters

I costed this out, and the result is stark: **video delivery is roughly 90% of your infrastructure bill. Everything else is a rounding error.**

Cloudflare Stream is **$1 per 1,000 delivered minutes** (encoding and storage included).

| Delivered minutes / month | Stream cost | All other infra | Video as % of infra |
|---|---|---|---|
| 1 M | $1,000 | ~$1,500 | 40% |
| 5 M | **$5,000** | ~$3,000 | 63% |
| 54 M (≈100k DAU × 18 min/day) | **$54,000** | ~$6,000 | **90%** |

**Two consequences that should shape the product:**

**(a) Every delivered minute must belong to a funded campaign.** Stream charges per minute delivered regardless of whether anyone paid for it. A free content feed, unfunded "discovery" video, or autoplay previews bleed money with no offsetting revenue. Attach a funder to every minute, or don't serve it.

**(b) There is a clear migration trigger at ~5 M delivered minutes/month.** Above that, move to **Cloudflare R2 + your own transcode + HLS packaging**. R2 has **zero egress fees**, which changes the arithmetic completely:

> 54 M minutes at 800 kbps ≈ **324 TB/month**. On Stream that is $54,000. On R2 (zero egress) plus ffmpeg transcoding on spot instances, it is **on the order of $3,000–5,000** — roughly a 10–15× saving, for perhaps three to four weeks of engineering.

So: **start on Stream for zero ops, design the media layer behind an interface, and plan the R2 migration as a known, scheduled project** rather than an emergency when the bill arrives. Keep uploads in R2 from day one so the source assets are already where they need to be.

At 100k DAU, non-video infrastructure lands around **$5–6k/month** (Postgres HA in two regions, Redis, Cloud Run, ClickHouse, observability, Cloudflare). The stack choice barely moves that number. **The video strategy is the entire infrastructure cost conversation.**

---

## 5. Deliberately not using — and when to revisit

| Not using | Why | Revisit when |
|---|---|---|
| **Kafka** | pg-boss/BullMQ covers phase 1 at a fraction of the ops cost | You need replay, or multiple independent consumers of the same stream, or >10k events/s |
| **Kubernetes** | Cloud Run scales to zero and has no cluster to run | Cloud Run's limits bite, or you have enough services and enough platform engineers |
| **Microservices from day one** | Twenty services, eight engineers, no product | Per the seam table in §3 |
| **Go** | No latency problem exists at 60 rps | Profiling names a specific service. Possibly never |
| **GraphQL** | REST + generated types is simpler and faster here | Third parties need flexible querying |
| **TigerBeetle** | Postgres handles ~30 ledger transfers/sec trivially | Sustained >5k transfers/sec |
| **Blockchain** | Slower, costlier, more regulatory surface | A consortium partner contractually requires a shared record. Keep voucher custody pluggable |
| **Custom CDN / transcoding** | Cloudflare does it better | The §4 trigger — then it is transcoding only, still not a custom CDN |
| **Service mesh** | Three deployables | Double-digit services |
| **Auth0** | Per-MAU pricing at consumer scale | Never |
| **Elasticsearch** | Postgres FTS is enough | Catalogue search genuinely underperforms |

---

## 6. Non-negotiables from day one

These are cheap now and brutal to retrofit:

1. **Two data planes, same Terraform module.** Jakarta and Sydney, isolated, from the first deploy. Never "we'll split the regions later."
2. **Idempotency middleware** — a shared table and decorator, mandatory on every value-moving endpoint.
3. **Ledger discipline** — append-only, double-entry enforced by DB constraints *and* a continuous invariant checker, not by convention.
4. **Module boundaries enforced by lint**, so the monolith stays splittable.
5. **OpenTelemetry in the first service**, not "once we have traffic."
6. **CWV budgets failing the build**, or they are a wish.
7. **The `contracts` package as the single source of truth** for every API shape.
8. **Voucher codes envelope-encrypted via KMS** from the first code ever minted.

---

## 7. The phase-1 stack, in one paragraph

**Next.js + Tailwind + hls.js on the front, NestJS + Drizzle + Zod on the back, one Postgres and one Redis per region, pg-boss for jobs, Cloudflare Stream for video and Cloudflare R2 for source assets, Zitadel for identity, Cerbos for authorization, Xendit for payments, Cloud Run for compute, Terraform for infrastructure, Grafana Cloud for observability, Claude Sonnet 5 for moderation.** Three deployables, one monorepo, two regions.

That is a stack four to six engineers can actually ship in a quarter, and it will carry the product well past the point where the business knows which parts deserve more.
