# YourTal — Go Standards

**Date:** 2026-09-18 · **Status:** Binding. Companion to [`13-engineering-standards.md`](13-engineering-standards.md); stack locked in [`15-stack-locked.md`](15-stack-locked.md).
**Scope:** the three Go deployables — `services/ledger` (ledger, pricing, solvency), `services/voucher` (voucher lifecycle + redemption network), `services/watch` (watch sessions + checkpoint verification). Go exists here for one reason: **a separate codebase with stricter review discipline around anything that moves value.** The 300-line rule applies unchanged.

**Locked toolchain:** standard library + **chi** · **pgx** (v5, pool) · **sqlc** for typed queries · **slog** for logging · **golangci-lint** · **testcontainers-go** · **Atlas** for migrations · OpenTelemetry.

## 1. Layout

[`golang-standards/project-layout`](https://github.com/golang-standards/project-layout) is **not** a standard — Go's then-tech-lead Russ Cox opened [issue #117, "this is not a standard Go project layout"](https://github.com/golang-standards/project-layout/issues/117), noting most of the ecosystem does not use `pkg/`. We follow the [official module layout guidance](https://go.dev/doc/modules/layout).

```
services/
├── go.mod                    ONE module for all Go services: module github.com/yourtal/services
├── go.work                   absent — one module needs no workspace
├── ledger/
│   ├── cmd/ledgerd/main.go   wiring only: config, deps, chi router, signals, Run(ctx) error
│   ├── internal/{ledger,pricing,solvency}/     domain modules, one Postgres schema each
│   └── internal/store/       sqlc-generated queries + hand-written query files
├── voucher/  watch/          same shape
└── platform/                 shared, importable by all three: pgxdb, otel, httpx, idem, money, safego
```

- **No `pkg/`.** Nothing here is imported by an external module; if that changes, the package moves to its own repo.
- **One Go module, not three.** One dependency set, one lint config, one `go test ./...`. Cross-service imports are blocked by `depguard`, not by module walls, because the walls would cost more than they buy at six deployables.
- `main.go` stays **under 120 lines** and holds no business logic. `revive:deep-exit` keeps `os.Exit`/`log.Fatal` inside it.
- **Package names:** short, lowercase, singular, no underscores, never `util`/`common`/`helpers`/`base`. The name is part of every call site — `ledger.Post`, not `ledgerutils.DoLedgerPost` ([Go style guide](https://google.github.io/styleguide/go/decisions#package-names)).
- The four value-zone services **vendor** their dependencies ([`14`](14-security-engineering.md) §7); `-mod=readonly` everywhere.

## 2. Errors

Follow [the Go 1.13 error model](https://go.dev/blog/go1.13-errors). No `github.com/pkg/errors`.

| Situation | Rule |
|---|---|
| Passing up | `fmt.Errorf("charge account %s: %w", id, err)` — wrap with `%w`, add *context the caller lacks*, never the function's own name |
| Caller must branch | **Sentinel:** `var ErrInsufficientFunds = errors.New("ledger: insufficient funds")`, matched with `errors.Is` |
| Caller needs data | **Typed:** `type ValidationError struct{ Field, Code string }` with `Error() string`, matched with `errors.As` |
| Message text | Lowercase, no trailing punctuation, no "failed to" — the `err` already means failure |
| Ignoring | Never implicitly: `_ = f.Close()` with a comment, or handle it. `errcheck` is on |
| Comparing | `errors.Is`/`errors.As` only. `err == ErrX` and string matching fail review (`errorlint`) |
| Crossing the HTTP edge | One mapper per service turns a sentinel or typed error into the `code` of the standard error envelope ([`13`](13-engineering-standards.md) §5). A `pgx` error never reaches a client |

Sentinels are **the public API of a module**: they live in the module's root file, are documented, and changing one is a breaking change.

## 3. Panics

**No `panic` outside `main()` startup wiring.** Every chi router mounts recover middleware that logs with the correlation ID, emits a metric and returns `500` with the standard envelope. Every goroutine launches through `platform/safego.Go(ctx, fn)`, which recovers — an unrecovered goroutine panic kills the process, and in the ledger that is a half-written transaction. A `panic` anywhere in `ledger`, `pricing`, `solvency` or `redemption` blocks the PR, no exceptions.

## 4. Context

- `ctx context.Context` is the **first parameter** of every function that does I/O or can block, and is never stored in a struct (`revive:context-as-argument`, `containedctx`).
- Never `context.Background()` below `main` or a test — pass it down (`contextcheck`).
- Deadlines are set at the **edge** (chi middleware, pg-boss job runner) and inherited. Individual `pgx` calls do not invent their own timeouts; the database enforces its own `statement_timeout` per role.
- `context.WithValue` carries request-scoped metadata only — trace ID, actor, jurisdiction, idempotency key — behind unexported key types. Never dependencies.

## 5. Structs and constructors

- `func NewLedger(db *pgxpool.Pool, q *store.Queries, clock Clock) (*Ledger, error)`: required deps as explicit parameters, optional as [functional options](https://dave.cheney.net/2014/10/17/functional-options-for-friendly-apis). No `Init()`, no setters, no partially-constructed objects.
- Exported fields only on DTOs; domain types keep state unexported behind methods.
- **Money and points are `int64` minor units plus an explicit currency** (`platform/money.Minor`). A `float64` anywhere in a value-path struct fails review, and `forbidigo` blocks `float` in `ledger`, `pricing` and `voucher`.
- Rounding is a named function with a stated direction, tested against a table. Never an inline `/` on money.
- Embed only to satisfy an interface deliberately, never for code reuse.

## 6. Interfaces and the published module interface

**Accept interfaces, return structs.** The interface is declared in the **consuming** package, sized to what that consumer uses ([Go Code Review Comments](https://go.dev/wiki/CodeReviewComments#interfaces)); producers export concrete types. One- and two-method interfaces are the target — a nine-method `LedgerInterface` mirroring a struct is a mocking artifact, not a design.

```go
// voucher/internal/redemption/redeemer.go — the consumer declares only what it needs
type Ledger interface{ Post(ctx context.Context, t ledger.Transfer) (ledger.Receipt, error) }
```

A module's **published interface** is one file at its root, under 150 lines, holding only the interface, its DTOs and its sentinels. It leaks no `pgx` rows, no sqlc types, no `pgx.Tx`. The signature is identical before and after the module becomes a network service — that is the point of the seam.

```go
// ledger/internal/ledger/ledger.go — the entire public surface of the ledger module
var ErrInsufficientFunds = errors.New("ledger: insufficient funds")
var ErrIdempotencyConflict = errors.New("ledger: idempotency key reused with different payload")
type Transfer struct{ From, To AccountID; Amount money.Minor; Currency money.Currency; IdempotencyKey, ReasonCode string }
type Receipt struct{ EntryID string; PostedAt time.Time; BalanceAfter money.Minor }
type Service interface {
    Post(ctx context.Context, t Transfer) (Receipt, error)
    Balance(ctx context.Context, a AccountID) (money.Minor, error)
}
```

## 7. HTTP, database, logging

| Concern | Rule |
|---|---|
| Router | **chi.** One `routes.go` per module returning `chi.Router`, mounted by `main`. Handlers are thin: decode → authorize → call the module → encode. Never business logic in a handler |
| Middleware order | `RequestID → RealIP → otelhttp → recover → timeout → auth → Cerbos → idempotency → module` |
| Handlers | `func (h *Handler) post(w http.ResponseWriter, r *http.Request)` — decode with a generated contract type, never `map[string]any`. Encoding goes through one `httpx.WriteJSON` / `httpx.WriteError` pair so the envelope shape cannot drift |
| Queries | **`sqlc`-generated only.** Hand-built SQL strings and `pgx.Exec` with concatenation are banned outside one allowlisted, reviewed file ([`14`](14-security-engineering.md) §5) |
| Transactions | Opened in the module, never in a handler or a store method. `pgx.BeginFunc` with an explicit isolation level — `Serializable` for ledger writes — and a documented retry on `40001` |
| Migrations | **Atlas**, run by a `migrate` role that the application roles do not share. Expand → migrate → contract; never a destructive change in the same release as the code that stops using the column |
| Logging | **`slog`**, structured, JSON in prod. `slog.Default()` never used below `main`; loggers are injected. Every log line in a value path carries `trace_id`, `actor`, `idempotency_key`. **Never log a voucher code, a token, a PAN or a full phone number** |
| Metrics/traces | OpenTelemetry from the first commit of each service. One span per module call, not per function |

## 8. Testing

Table-driven with named subtests (`for name, tc := range map[string]testCase { t.Run(name, ...) }`, [TableDrivenTests](https://go.dev/wiki/TableDrivenTests)) and `t.Parallel()` wherever it is legal.

| Rule | Detail |
|---|---|
| Assertions | **`testify/require` only. `testify/assert` is banned** — continuing past a failed assertion produces cascading noise. Struct diffs use [`google/go-cmp`](https://github.com/google/go-cmp) |
| Database | [`testcontainers-go`](https://golang.testcontainers.org/) with real Postgres 16 and real Atlas migrations, one container per package, `t.Cleanup` teardown. **No sqlmock, no in-memory fake, ever, in the value path** |
| Roles | Integration tests connect as the service's real restricted role, so a missing grant fails in CI rather than in production |
| Concurrency | Every value-path invariant has a test that runs it from `N` goroutines against one container and asserts the invariant still holds. `-race -shuffle=on` always |
| Time | Inject a `Clock` interface. No `time.Now()` in domain code |
| Fixtures | Builder funcs (`newTestAccount(t, withBalance(500))`), never shared mutable globals. Goldens in `testdata/` behind a `-update` flag |
| Coverage | 90% line / 100% of invariant branches on `ledger`, `pricing`, `voucher`, `idem` — gated. Elsewhere reported only ([`13`](13-engineering-standards.md) §4) |

## 9. golangci-lint

`services/.golangci.yml`, v2 schema, shared and versioned; per-file disables need a task ID. `gofumpt` formats (stricter superset of `gofmt`), `gci` orders imports std / external / `github.com/yourtal`.

```yaml
version: "2"
linters:
  enable: [errcheck, govet, staticcheck, ineffassign, unused, revive, errorlint, bodyclose,
           contextcheck, containedctx, noctx, nilerr, rowserrcheck, sqlclosecheck, exhaustive,
           gosec, funlen, gocognit, copyloopvar, testifylint, forbidigo, depguard, gocritic]
  settings:
    gocognit: { min-complexity: 20 }
    funlen: { lines: 80, statements: 50 }
    forbidigo:
      forbid:
        - pattern: "^float(32|64)$"   # money is int64 minor units
        - pattern: "^fmt\\.Print.*$"  # use slog
    depguard:
      rules:
        ledger:  { files: ["**/ledger/**"],  deny: [{ pkg: "github.com/yourtal/services/voucher", desc: "cross-service import — use the published interface" }] }
        voucher: { files: ["**/voucher/**"], deny: [{ pkg: "github.com/yourtal/services/ledger/internal", desc: "internals are not a contract" }] }
    revive:
      rules:
        - name: file-length-limit
          arguments: [{ max: 300, skip-comments: false, skip-blank-lines: false }]
        - { name: exported }            # doc comments on exported identifiers
        - { name: context-as-argument }
        - { name: deep-exit }
        - { name: unhandled-error }
        - { name: confusing-naming }
```

`gosec` findings are fixed, not suppressed; a `#nosec` needs a task ID and a second reviewer.
