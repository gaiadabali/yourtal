// Command ledger is the ledger service. docs/15 makes it one of the six
// Phase 1 deployables and the sole writer of every point and cash balance.
//
// # What is live and what is not
//
// internal/ledger, internal/reward and internal/pricing are real,
// Postgres-backed implementations, proved by their own tests against a live
// database. What was missing until now was an HTTP caller — see
// internal/api. Two of its four routes are live (a balance read and a price
// quote: neither writes a row or moves a balance). The other two
// (transfers, reward grants) return an honest 501, because docs/13a section
// 7's middleware order puts auth and Cerbos in front of anything that
// mutates state, and neither exists yet for this service. See
// internal/api's notYetExposed for the reasoning, which mirrors the
// pattern services/voucher/cmd/voucher/main.go already set.
//
// The shape below is docs/13a section 7's: chi, one httpx pair for every
// response, slog injected rather than global, and the middleware order
// `RequestID -> RealIP -> ... -> recover -> timeout -> auth -> Cerbos ->
// idempotency -> module`. The last three are not here yet; auth and Cerbos
// arrive with the service's first authenticated route, and idempotency has
// a shared table waiting for it (platform.idempotency).
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
)

const (
	// How often the invariant checker runs. Frequent enough that an
	// imbalance is caught within an hour, cheap enough that it is two
	// aggregate queries — docs/13 section 4 calls for a CONTINUOUS checker,
	// and a nightly one leaves a whole day in which the ledger is wrong and
	// nobody knows.
	checkInterval = 15 * time.Minute

	defaultAddr     = "127.0.0.1:3010"
	requestTimeout  = 10 * time.Second
	shutdownTimeout = 15 * time.Second
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
	router.Use(middleware.RealIP)
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

		checker := proof.New(pool, proof.LoggingAlerter{Logger: logger})
		go runChecker(ctx, logger, checker)
	} else {
		logger.Warn("no LEDGER_DATABASE_URL: the invariant checker is NOT running " +
			"and /v1 routes will report the database as unconfigured")
	}

	router.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteJSON(w, logger, http.StatusOK, map[string]string{"status": "ok"})
	})

	if pool != nil {
		module := api.New(logger, ledger.New(pool), pricing.New(pool))
		router.Mount("/v1", module.Routes())
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
func runChecker(ctx context.Context, logger *slog.Logger, checker *proof.Checker) {
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	for {
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
