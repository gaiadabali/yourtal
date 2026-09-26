// Command ledger is the ledger service. docs/15 makes it one of the six
// Phase 1 deployables and the sole writer of every point and cash balance.
//
// # What is live
//
// internal/api serves packages/contracts' ledger-internal contract on /v1,
// behind internal/serviceauth: only apps/api and apps/worker, signing with
// LEDGER_SERVICE_SECRET, can call it. The operations whose tasks are still
// open (escrow, statements, payouts, economyDaily, and the settings apps/api
// serves itself) answer 501.
//
// The shape below is docs/13a section 7's: chi, one httpx pair for every
// response, slog injected rather than global, and the middleware order
// `RequestID -> ClientIP -> ... -> recover -> timeout -> auth -> Cerbos ->
// idempotency -> module`. Auth is internal/serviceauth on /v1: only apps/api
// and apps/worker, signing with LEDGER_SERVICE_SECRET, may call it.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/api"
	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/proof"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/serviceauth"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

const (
	// How often the invariant checker runs. Frequent enough that an
	// imbalance is caught within an hour, cheap enough that it is two
	// aggregate queries — docs/13 section 4 calls for a CONTINUOUS checker,
	// and a nightly one leaves a whole day in which the ledger is wrong and
	// nobody knows.
	checkInterval = 15 * time.Minute
	// A newly effective rate reprices listings within a minute (4.9.a).
	repriceInterval = time.Minute

	defaultAddr     = "127.0.0.1:3010"
	requestTimeout  = 10 * time.Second
	shutdownTimeout = 15 * time.Second

	// readinessPingTimeout bounds /readyz's own database round trip. Short
	// on purpose: a healthcheck that can hang as long as the outer
	// middleware Timeout allows is a healthcheck that reports "unhealthy"
	// ten seconds late, and docker's healthcheck interval below is 5s.
	readinessPingTimeout = 2 * time.Second
)

func main() {
	// JSON in production, per docs/13a section 7. slog.Default() is never
	// used below main; every package takes a logger.
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	if err := run(logger); err != nil {
		logger.Error("ledger exited", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	router := chi.NewRouter()

	// docs/13a section 7 fixes this order. otelhttp, auth, Cerbos and
	// idempotency slot in here as they arrive; the sequence is what matters,
	// because idempotency must sit behind auth or an unauthenticated caller
	// can write to the idempotency table.
	router.Use(middleware.RequestID)
	// Not RealIP: it trusts X-Forwarded-For / X-Real-IP from any caller
	// (GHSA-3fxj-6jh8-hvhx). These services have no proxy in front.
	router.Use(middleware.ClientIPFromRemoteAddr)
	router.Use(middleware.Recoverer)
	router.Use(middleware.Timeout(requestTimeout))

	// The pool, the invariant checker and the module routes all share one
	// connection: LEDGER_DATABASE_URL, the yourtal_ledger credential. This
	// must never be the generic DATABASE_URL (yourtal_app) or the owner URL
	// (yourtal, superuser) — yourtal_app has no grant on the ledger schema
	// AT ALL by design (infra/postgres/init/01-schemas.sql), and connecting
	// as the owner would be YT-0554's bug one layer down. Without one the
	// service still serves health checks — but it says so, rather than
	// running with no checker and no live routes and looking identical to a
	// deployment that has both.
	var pool *pgxpool.Pool
	if url := os.Getenv("LEDGER_DATABASE_URL"); url != "" {
		var err error
		pool, err = pgxpool.New(ctx, url)
		if err != nil {
			return fmt.Errorf("connecting as yourtal_ledger: %w", err)
		}
		defer pool.Close()

		if err := pool.Ping(ctx); err != nil {
			return fmt.Errorf("the database is unreachable at boot: %w", err)
		}

		// Every platform account a posting rule names must exist before the
		// first transfer in a region (a capture debits voucher_liability).
		book := ledger.New(pool)
		for _, region := range []ledger.Region{ledger.RegionAU, ledger.RegionID} {
			if err := reward.New(pool, book, reward.AlwaysAllow{}, region).EnsureChart(ctx); err != nil {
				return fmt.Errorf("ensuring the %s platform chart: %w", region, err)
			}
		}

		checker := proof.New(pool, proof.LoggingAlerter{Logger: logger})
		go runChecker(ctx, logger, checker, sqlcgen.New(pool), proof.LoggingAlerter{Logger: logger})
		go runRepricer(ctx, logger, pricing.New(pool))
	} else {
		logger.Warn("no LEDGER_DATABASE_URL: the invariant checker is NOT running " +
			"and /v1 routes will report the database as unconfigured")
	}

	// /healthz is pure liveness: it never touches the database, and answers
	// 200 as long as the process is scheduling goroutines at all. That is
	// deliberate and it is NOT what a container orchestrator's readiness
	// probe should point at — a service that answers "ok" while it cannot
	// reach Postgres is exactly the false "can serve" this docker-compose.yml
	// healthcheck was found reporting: pausing Postgres left /healthz at 200
	// throughout, so a check wired to it goes green on a service that cannot
	// actually do anything.
	router.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteJSON(w, logger, http.StatusOK, map[string]string{"status": "ok"})
	})

	// /readyz is what docker-compose.yml's healthcheck now points at: can
	// this instance actually serve a request that touches the database. A
	// missing pool is unready by construction (there is nothing to be ready
	// WITH); a configured pool that fails to answer a Ping within budget is
	// unready for the same reason a request against it would fail.
	router.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if pool == nil {
			httpx.WriteError(w, logger, http.StatusServiceUnavailable,
				"api_error", "database_not_configured",
				"LEDGER_DATABASE_URL is not set, so this instance cannot serve a database-backed request")
			return
		}

		pingCtx, cancel := context.WithTimeout(r.Context(), readinessPingTimeout)
		defer cancel()
		if err := pool.Ping(pingCtx); err != nil {
			logger.Error("readiness ping failed", "error", err)
			httpx.WriteError(w, logger, http.StatusServiceUnavailable,
				"api_error", "database_unreachable", "the database did not answer a ping in time")
			return
		}

		httpx.WriteJSON(w, logger, http.StatusOK, map[string]string{"status": "ready"})
	})

	// Every /v1 route is behind service auth. No secret, or a short one, means
	// /v1 refuses everything: fail closed, never open.
	auth, authErr := serviceauth.New([]byte(os.Getenv("LEDGER_SERVICE_SECRET")))
	if authErr != nil {
		logger.Warn("LEDGER_SERVICE_SECRET is missing or too short: /v1 refuses every call", "error", authErr)
	}

	if pool != nil && auth != nil {
		// REWARD_ATTESTATION_SECRET: apps/api signs completions with it (4.4.c).
		module := api.New(logger, pool, []byte(os.Getenv("REWARD_ATTESTATION_SECRET")))
		// /dev/* (2.3.f's /dev/clock): read once at boot, same as
		// LEDGER_SERVICE_SECRET above. Unset APP_ENV — the production default
		// — disables it, the same fail-closed default docs/13a asks for
		// everywhere else in this file.
		appEnv := os.Getenv("APP_ENV")
		module.EnableDevRoutes(appEnv == "dev" || appEnv == "staging")
		router.Route("/v1", func(r chi.Router) {
			r.Use(auth.Middleware(logger))
			r.Mount("/", module.Routes())
		})
	} else if pool != nil {
		router.Route("/v1", func(r chi.Router) {
			r.HandleFunc("/*", func(w http.ResponseWriter, _ *http.Request) {
				httpx.WriteError(w, logger, http.StatusServiceUnavailable,
					"api_error", "service_auth_not_configured",
					"LEDGER_SERVICE_SECRET is not set, so no caller can be authenticated")
			})
		})
	} else {
		router.Route("/v1", func(r chi.Router) {
			r.HandleFunc("/*", func(w http.ResponseWriter, _ *http.Request) {
				httpx.WriteError(w, logger, http.StatusServiceUnavailable,
					"api_error", "database_not_configured",
					"LEDGER_DATABASE_URL is not set, so the ledger module has nothing to read or write from")
			})
		})
	}

	router.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteError(w, logger, http.StatusNotFound,
			"invalid_request_error", "not_found", "no such endpoint")
	})

	addr := os.Getenv("LEDGER_ADDR")
	if addr == "" {
		addr = defaultAddr
	}

	server := &http.Server{
		Addr:              addr,
		Handler:           router,
		ReadHeaderTimeout: requestTimeout,
	}

	// Graceful shutdown from the first commit rather than retrofitted: this
	// service will eventually hold open transactions, and killing it
	// mid-transfer is the one thing a ledger must never do.
	errs := make(chan error, 1)
	go func() {
		logger.Info("ledger listening", "addr", addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errs <- err
			return
		}
		errs <- nil
	}()

	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
		logger.Info("shutdown requested, draining")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
		defer cancel()
		return server.Shutdown(shutdownCtx)
	}
}

// runChecker is the continuous job. YT-0044.
//
// Errors are logged and the loop continues: a checker that exits on its
// first transient database error is a checker that silently stops watching,
// which is worse than one that never existed because everyone believes it is
// still there.
//
// The same loop releases allocation holds past their TTL (4.4.e), so an
// abandoned reward session's points return to the campaign.
//
// And it is the solvency monitor (4.9.c): per region, coverage below 1.2
// pages. Below 1.1 marketing-funded grants already stop, checked live inside
// each grant, so the monitor is the warning and never the control.
func runChecker(
	ctx context.Context, logger *slog.Logger, checker *proof.Checker, queries *sqlcgen.Queries, alerter proof.Alerter,
) {
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	for {
		for _, region := range []ledger.Region{ledger.RegionAU, ledger.RegionID} {
			coverage, err := pricing.CoverageNow(ctx, queries, region)
			switch {
			case err != nil:
				logger.Error("measuring coverage failed", "region", region, "error", err)
			case coverage.ShouldAlert():
				if err := alerter.Page(ctx, "coverage below 1.2 in "+string(region),
					fmt.Sprintf("coverage %d bps: reserve %d against liability %d (points %d, vouchers %d, payable %d)",
						coverage.RatioBps, coverage.ReserveMinor, coverage.LiabilityMinor, coverage.PointsOutstanding,
						coverage.VoucherLiabilityMinor, coverage.MerchantPayableMinor)); err != nil {
					logger.Error("paging on coverage failed", "region", region, "error", err)
				}
			default:
				logger.Info("coverage", "region", region, "bps", coverage.RatioBps, "nothing_owed", coverage.NoPointsOutstanding)
			}
		}

		if released, err := queries.ReleaseExpiredHolds(ctx); err != nil {
			logger.Error("releasing expired allocation holds failed", "error", err)
		} else if released > 0 {
			logger.Info("released expired allocation holds", "count", released)
		}

		findings, err := checker.Run(ctx)
		if err != nil {
			logger.Error("invariant check failed to complete", "error", err)
		} else if len(findings) == 0 {
			logger.Info("ledger invariants hold", "checked_at", time.Now().UTC())
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// runRepricer reprices every listing whose rate was superseded (4.9.a).
// Errors are logged and the loop continues, as runChecker does.
func runRepricer(ctx context.Context, logger *slog.Logger, engine *pricing.Engine) {
	ticker := time.NewTicker(repriceInterval)
	defer ticker.Stop()
	for {
		if n, err := engine.RepriceListings(ctx); err != nil {
			logger.Error("repricing listings failed", "error", err)
		} else if n > 0 {
			logger.Info("repriced listings at the rate in force", "count", n)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
