// Command ledger is the service skeleton for YT-0517.
//
// It is a SKELETON, deliberately: routing, the response envelope, structured
// logging and graceful shutdown, and nothing about double-entry. The ledger's
// actual invariants already exist and are already enforced — in Postgres, by
// the YT-0518 migration, proved by packages/db's tests. Writing a Go
// implementation of them before YT-0506 settles the money unit would be
// writing code against a number whose meaning is still open.
//
// What this does establish is the shape docs/13a section 7 fixes, so the
// first real handler has somewhere to land: chi, one httpx pair for every
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

	"github.com/yourtal/services/ledger/internal/httpx"
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

	// The invariant checker, if a database is configured. Without one the
	// service still serves — but it says so, rather than running with no
	// checker and looking identical to one that is healthy.
	if url := os.Getenv("DATABASE_URL"); url != "" {
		pool, err := pgxpool.New(ctx, url)
		if err != nil {
			return fmt.Errorf("connecting for the invariant checker: %w", err)
		}
		defer pool.Close()

		checker := proof.New(pool, proof.LoggingAlerter{Logger: logger})
		go runChecker(ctx, logger, checker)
	} else {
		logger.Warn("no DATABASE_URL: the ledger invariant checker is NOT running")
	}

	router.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteJSON(w, logger, http.StatusOK, map[string]string{"status": "ok"})
	})

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
