# YourTal — The Stack (locked)

**Date:** 2026-09-18 · **Status:** Decided. Changes require an ADR.

This is what we use. No options, no "either/or". Reasoning lives in [`10-tech-stack.md`](10-tech-stack.md); this page is the answer.

---

## Languages

| Language | Used for | Why |
|---|---|---|
| **Go** | Ledger · Pricing & Solvency · Voucher & Redemption Network · Watch Session & checkpoint verification | Predictable latency, no GC surprises, excellent concurrency, and — the real reason — a **separate codebase with stricter review discipline around anything that moves value**. Simple enough that a maintainer can read it cold. What Uber, Gojek, Cloudflare and Discord use for exactly these services. |
| **TypeScript** | Web (all three surfaces) · Campaign, Store, Merchant, Moderation-orchestration services · every SDK | One language across web and most of the API, shared Zod contracts, one hiring pool, strong ecosystem. |
| **Python** | ML scoring, from Phase 2 only | Non-negotiable ecosystem. Nothing in Phase 0–1 needs it. |
| **Rust** | **Not used.** | It would earn its place only in a CPU-bound hot loop we do not have. Revisit if own-transcode (YT-0312) or event ingestion ever becomes CPU-bound at a scale Go cannot hold. Choosing it now would shrink the hiring pool in Jakarta and Sydney for no measured gain. |

## Frontend

| Concern | Locked choice |
|---|---|
| Framework | **Next.js (App Router) + React Server Components** |
| Language | TypeScript, `strict` + `noUncheckedIndexedAccess` |
| Styling | **Tailwind CSS** + **Radix UI** primitives (shadcn-style, vendored into `packages/ui`) |
| Video | **hls.js**, lazy-loaded on tap; native HLS on Safari |
| Server state | **TanStack Query** (only where RSC is insufficient) |
| Forms | **React Hook Form** + Zod resolver |
| i18n | **next-intl** — `id-ID`, `en-AU` |
| PWA / offline | **Serwist** service worker |
| Charts | **visx** (advertiser reporting only) |
| Icons | **Lucide** |
| Testing | **Vitest** (unit) · **Playwright** (E2E + CWV budgets) · **Testing Library** |

## Backend

| Concern | Locked choice |
|---|---|
| Go services | Standard library + **chi** router · **pgx** · **sqlc** for typed queries |
| Go tooling | **golangci-lint** · **testcontainers-go** · **slog** |
| TypeScript services | **NestJS** (Fastify adapter) |
| ORM / DB access | **Drizzle ORM** (TS) · **sqlc** (Go) — both SQL-first, no query magic |
| Validation | **Zod** at every boundary, shared via `packages/contracts` |
| API style | **REST + OpenAPI 3.1**, generated from Zod. Stripe conventions: cursor pagination, dated versions, idempotency keys, typed error envelope |
| Jobs / queue | **pg-boss** (Postgres-backed) |
| Identity provider | **Zitadel**, self-hosted, one realm per country |
| Authorization | **Cerbos** — policy-as-code, stateless PDP |
| ML serving (P2) | **FastAPI** |

## Data

| Concern | Locked choice |
|---|---|
| OLTP | **PostgreSQL 16**, Cloud SQL, HA, PITR. **Schema per domain. Never a shared table.** |
| Ledger | Same Postgres, **own schema, own DB role**, append-only, integer minor units, DB-enforced balance constraint |
| Cache / hot state | **Redis (Valkey-compatible)** — sessions, rate limits, checkpoint nonces, price locks, hold TTLs |
| Analytics | **ClickHouse Cloud** — added when Postgres replicas stop coping, not before |
| Object storage | **Cloudflare R2** (zero egress — this matters later, see YT-0312) |
| Search | Postgres full-text |
| Migrations | **Atlas** (declarative, with a CI safety check) |

## Media

| Concern | Locked choice |
|---|---|
| Ingest | **Cloudflare Stream** direct creator uploads (signed URLs) — video never touches our servers |
| Encode / deliver | **Cloudflare Stream**, ladder capped at 720p, AV1/H.265 where supported |
| Source-of-truth copy | **R2**, from day one, so YT-0312 is a migration and not a rescue |
| Transcript | **Deepgram** |
| Policy screen | **Claude Sonnet 5** over transcript + sampled frames + OCR |

## AI

| Use | Model |
|---|---|
| Creative + question moderation | **Claude Sonnet 5** |
| Advertiser copilot (P2–3) | **Claude Opus 5** |
| Support triage (P3) | **Claude Haiku 4.5** |
| Fraud scoring | Rules in P1 → gradient boosting in Python, P2 |

Dev-time prompt iteration and offline evaluation may use the shared Ollama Cloud endpoint. It is **never** in a production path — it is rate-limited and shared, and moderation is a compliance control.

## Infrastructure

| Concern | Locked choice |
|---|---|
| Cloud | **GCP** — `asia-southeast2` (Jakarta) + `australia-southeast1` (Sydney), isolated data planes |
| Compute | **Cloud Run** — not Kubernetes |
| Edge / CDN / WAF / bots | **Cloudflare** — CDN, WAF, Turnstile, R2, Stream, DNS |
| IaC | **Terraform** — one region module, instantiated twice |
| CI/CD | **GitHub Actions** |
| Secrets | **GCP Secret Manager** + **Cloud KMS** envelope encryption for voucher codes and PII |
| Observability | **OpenTelemetry → Grafana Cloud** (Mimir / Loki / Tempo) |
| Errors | **Sentry** |
| Payments | **Xendit** (Indonesia — collection *and* disbursement) · **Stripe** (Australia) |
| Email / SMS OTP | Provider with genuine Indonesian delivery — evaluate in YT-0033 |

## Repository

**pnpm workspaces + Turborepo**, single monorepo.

```
yourtal/
├── apps/
│   ├── web/                 Next.js — user app, advertiser console, merchant portal
│   └── api/                 NestJS — campaign, store, merchant, moderation
├── services/
│   ├── ledger/              Go — ledger, pricing, solvency
│   ├── voucher/             Go — voucher lifecycle + redemption network
│   ├── watch/               Go — watch sessions + checkpoint verification
│   └── media-worker/        TS — transcript, moderation, encode callbacks
├── packages/
│   ├── contracts/           Zod → OpenAPI → TS + Go types      ← the spine
│   ├── db/                  Drizzle schema + Atlas migrations
│   ├── ui/                  design system
│   ├── sdk-earn/            @yourtal/earn — for sister apps
│   └── sdk-merchant/        redemption client for merchants
├── docs/                    plan, standards, task files
├── scripts/                 tasks.mjs and friends
└── infra/                   Terraform
```

**Six deployables at Phase 1:** `web`, `api`, `ledger`, `voucher`, `watch`, `media-worker`. Everything else is a module inside one of those, behind a lint-enforced boundary, ready to split along a seam already drawn.

## Explicitly not used

| Not using | Revisit when |
|---|---|
| **Kafka** | Replay needed, or multiple independent consumers of one stream, or >10k events/s |
| **Kubernetes** | Cloud Run's limits bite and we have platform engineers to spare |
| **Rust** | A measured CPU-bound bottleneck Go cannot hold |
| **GraphQL** | Third parties need flexible querying |
| **TigerBeetle** | Sustained >5k ledger transfers/sec |
| **Blockchain** | A consortium partner contractually requires a shared record |
| **Auth0** | Never — per-MAU pricing is hostile at consumer scale |
| **Prisma** | Never — we want the SQL visible in a value-handling system |
| **Barrel files** | Never — they wreck tree-shaking and bundle size |
| **Custom CDN** | Never |
| **Service mesh** | Double-digit deployables |

## The rules that outlive the stack

1. **Two data planes from the first deploy.** Never "we'll split regions later."
2. **Idempotency on every value-moving endpoint**, enforced by a shared middleware and a test.
3. **Ledger correctness in database constraints**, not in convention.
4. **Module boundaries enforced by lint**, so the monolith stays splittable.
5. **`packages/contracts` is the only source of API truth.** Drift fails CI.
6. **Every file under 300 lines**, enforced in CI. See [`13-engineering-standards.md`](13-engineering-standards.md).
7. **Voucher codes KMS-encrypted** from the first code ever minted.
