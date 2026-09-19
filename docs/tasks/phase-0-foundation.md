# Phase 0 · Legal, infrastructure, platform

Nothing user-visible ships except a login. **Gate:** a sister app can log a user in via YourtalID, call the Reward Engine, and have points appear as balanced ledger entries that survive a replay and a reconciliation run — with legal sign-off on the currency model in writing.

---

## Legal

### YT-0010 · Legal positions register
`todo` · P0 · legal · 4d · dep: —
- [ ] Every legal position the product relies on stated explicitly in `docs/24-legal-positions.md`
- [ ] Each position traced to a primary or official source, with a confidence rating
- [ ] Residual risk named per position; unsourced positions marked as guesses, not hidden
- [ ] Re-verification date set for each; register reviewed at every phase gate

### YT-0011 · Red-line register and enforcement
`todo` · P0 · legal · 2d · dep: YT-0010
- [ ] The ten absolute prohibitions published where product and sales will actually read them
- [ ] Each red line mapped to the feature flag or code path that enforces it
- [ ] Jurisdiction policy service defaults set so a red line cannot be crossed by configuration alone
- [ ] Sales training covers the breakage-claim prohibition specifically (Scoopon precedent)

### YT-0012 · Counsel-substitution risk acceptance
`todo` · P0 · legal · 1d · dep: YT-0010
- [ ] Founder signs off, in writing, on proceeding without advisory counsel
- [ ] The concentration of exposure in ID-1/ID-2 (points as e-money) explicitly acknowledged
- [ ] Triggers that force engaging counsel regardless of budget agreed and recorded
- [ ] Budget line reserved for one narrow opinion on the e-money question in Indonesia

### YT-0013 · Entity formation via notaris and corporate services
`todo` · P0 · legal · 10d · dep: YT-0012
- [ ] **Notaris engaged** — PT/PT PMA formation is a notarial act and has no research substitute
- [ ] Local corporate services provider engaged for OSS, NIB and domicile
- [ ] PT PMA (Indonesia) and Pty Ltd (Australia) structure confirmed, with the ≥15% local ownership path
- [ ] Formation instructed

### YT-0014 · PSE registration (Indonesia)
`todo` · P0 · legal · 5d · dep: YT-0013
- [ ] Registered with Komdigi via OSS as a private-scope ESO
- [ ] Registration number recorded and displayed as required

### YT-0015 · Consumer-facing legal copy
`todo` · P0 · legal · 8d · dep: YT-0010
- [ ] T&Cs, privacy policy and points terms drafted per jurisdiction, in Bahasa and English
- [ ] Drafted against the positions register and published regulator guidance, not from a generic template
- [ ] Consent text versioned and wired to the consent service schema
- [ ] Points expiry, transfer and forfeiture rules stated plainly, in language a user actually understands

### YT-0016 · Tax position on marketplace withholding
`todo` · P0 · legal · 3d · dep: YT-0010
- [ ] Indonesian marketplace withholding obligations on seller income confirmed with a tax consultant
- [ ] This is the one position the register rates Low confidence and it is financial, not theoretical
- [ ] Settled before the first merchandise order, not after

## Infrastructure

### YT-0020 · GCP organisation, projects, billing, IAM baseline
`todo` · P0 · infra · 3d · dep: —
- [ ] Separate projects per environment and per region; least-privilege IAM; no owner-role humans
- [ ] Budget alerts configured

### YT-0021 · Terraform skeleton and two data planes
`todo` · P0 · infra · 5d · dep: YT-0020
- [ ] One module instantiated twice: `asia-southeast2` (Jakarta) and `australia-southeast1` (Sydney)
- [ ] No resource can be created outside a region module
- [ ] `terraform plan` clean in CI

### YT-0022 · PostgreSQL provisioned per region
`todo` · P0 · infra · 3d · dep: YT-0021
- [ ] HA managed instance per region, PITR enabled, restore tested once
- [ ] Separate database roles per domain schema; ledger role isolated

### YT-0023 · Redis provisioned per region
`todo` · P0 · infra · 1d · dep: YT-0021
- [ ] Managed instance per region, TLS, auth enabled

### YT-0024 · Cloud Run, Artifact Registry, deploy pipeline
`todo` · P0 · infra · 4d · dep: YT-0021
- [ ] Container build + deploy from CI to staging on merge, prod on tag
- [ ] Rollback is one command and is tested

### YT-0025 · Cloudflare: domains, CDN, R2, Stream, Turnstile
`todo` · P0 · infra · 3d · dep: —
- [ ] Domains and DNS under Cloudflare; WAF baseline on
- [ ] R2 buckets per region-role; Stream account with signed uploads
- [ ] Turnstile site keys issued per environment

### YT-0026 · Secret Manager and KMS keyrings
`todo` · P0 · infra · 2d · dep: YT-0020
- [ ] Keyring per region; separate keys for voucher codes, PII, signing
- [ ] No secret in any env file in the repo; secret scanning in CI

### YT-0027 · Observability: OpenTelemetry, Grafana Cloud, Sentry
`todo` · P0 · infra · 4d · dep: YT-0024
- [ ] Traces, metrics and logs from the first service, tagged by region
- [ ] Four golden signals dashboard; on-call alert routes defined

### YT-0028 · CI pipeline with all gates
`todo` · P0 · infra · 4d · dep: YT-0030
- [ ] Gates: lint, types, unit, integration, file-length, bundle size, Lighthouse CWV, migration safety, secret scan, SBOM
- [ ] `node scripts/tasks.mjs --check` runs and fails on a stale dashboard

## Platform

### YT-0030 · Monorepo skeleton
`todo` · P0 · platform · 3d · dep: —
- [ ] pnpm workspaces + Turborepo; `apps/web`, `apps/api`, `services/*`, `packages/*`
- [ ] Module-boundary lint rule fails the build on a cross-module import

### YT-0031 · Contracts package and codegen
`todo` · P0 · platform · 4d · dep: YT-0030
- [ ] Zod schemas are the single source of truth; OpenAPI and TS client generated from them
- [ ] Go types generated from the same OpenAPI document
- [ ] Drift between schema and generated output fails CI

### YT-0032 · Zitadel deployed, realm per country
`todo` · P0 · platform · 5d · dep: YT-0024
- [ ] Self-hosted per region, backed by its own Postgres schema
- [ ] Realms isolated; no cross-region user lookup is possible

### YT-0033 · Phone OTP login flow
`todo` · P0 · platform · 5d · dep: YT-0032
- [ ] OTP via an Indonesian-capable provider; rate-limited per number, per IP, per device
- [ ] Enumeration-safe responses; SIM-swap risk documented
- [ ] One number maps to one account per region

### YT-0034 · OIDC client for the first sister app
`todo` · P0 · platform · 3d · dep: YT-0033
- [ ] Authorization Code + PKCE, refresh-token rotation with reuse detection
- [ ] Scoped consent screen naming the requesting app and the data it gets
- [ ] End-to-end login proven from the sister app

### YT-0035 · Cerbos policies and decision point
`todo` · P0 · platform · 4d · dep: YT-0030
- [ ] Roles: user, business admin/member, merchant staff, charity admin, support, finance, ops, admin
- [ ] Policies are version-controlled and unit-tested
- [ ] Every API route resolves authz through the PDP, never ad hoc

### YT-0036 · Consent service v1
`todo` · P0 · platform · 5d · dep: YT-0031
- [ ] Purpose-scoped, versioned consent records per jurisdiction
- [ ] Other services query "may I use this signal for X?" rather than reading a flag
- [ ] Withdrawal and DSAR/deletion orchestration stubbed with owners named

### YT-0037 · Jurisdiction policy service
`todo` · P0 · platform · 3d · dep: YT-0031
- [ ] Single source of truth for cash-out on/off, draws on/off, min age, residency, KYC tier
- [ ] Every regulated feature reads its switch from here, never from config

### YT-0038 · Hash-chained audit log
`todo` · P0 · platform · 4d · dep: YT-0022
- [ ] Append-only, per-record hash chain, verifiable offline
- [ ] Covers bulk issuance, ledger adjustment, campaign approval, refunds, role changes
- [ ] No service can delete or update a record

### YT-0039 · Idempotency middleware (Go and TypeScript)
`todo` · P0 · platform · 3d · dep: YT-0031
- [ ] Shared table; key + request fingerprint; replay returns the original response
- [ ] Mandatory on every value-moving endpoint, enforced by a lint/test check

### YT-0040 · Job queue and worker skeleton
`todo` · P0 · platform · 3d · dep: YT-0022
- [ ] pg-boss with retries, backoff, dead-letter and visibility in Grafana
- [ ] Every consumer is idempotent by construction
