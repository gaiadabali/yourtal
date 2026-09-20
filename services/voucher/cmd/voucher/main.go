// Command voucher is the voucher lifecycle and redemption network service.
// docs/15 makes it one of the six Phase 1 deployables.
//
// # What it refuses to start without
//
// A database and a voucher-code master key. Both are fatal at boot rather
// than at first use, and that is the same rule `packages/drivers` applies to
// a `live` driver with no credential: a service that boots, serves traffic
// and fails one request at a time is indistinguishable from a vendor outage,
// and it is found by a customer at a till rather than by whoever deployed it.
//
// A missing key is the worse of the two. Without it the service could still
// answer health checks and even look up vouchers by hash — it would simply
// be unable to mint or reveal a code. Starting in that state means
// discovering the misconfiguration at the moment somebody tries to spend
// something.
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

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/idempotency"
	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/keyring"
	"github.com/yourtal/services/voucher/internal/merchantauth"
	"github.com/yourtal/services/voucher/internal/redeem"
)

const (
	defaultAddr     = "127.0.0.1:3011"
	requestTimeout  = 10 * time.Second
	shutdownTimeout = 15 * time.Second
	// How often abandoned holds are tidied. Frequent enough that a voucher
	// is not visibly stuck for long, and not load-bearing: every read
	// already filters on `expires_at`, so a sweeper that stops running
	// changes no decision. That is deliberate — a sweeper the correctness
	// depends on is a single point of failure with no alarm on it.
	sweepInterval = time.Minute
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	if err := run(logger); err != nil {
		logger.Error("voucher exited", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	url := os.Getenv("VOUCHER_DATABASE_URL")
	if url == "" {
		return errors.New(
			"no VOUCHER_DATABASE_URL. This service is the sole minter of vouchers and " +
				"cannot do anything useful without its own database credential")
	}

	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return fmt.Errorf("connecting: %w", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("the database is unreachable at boot: %w", err)
	}

	keys, err := loadKeys()
	if err != nil {
		return err
	}

	minter := issue.New(pool, keys)
	network := redeem.New(pool)

	router := chi.NewRouter()
	// docs/13a §7 fixes this order: RequestID -> RealIP -> Recoverer ->
	// Timeout -> auth -> idempotency -> module. otelhttp slots in later; the
	// sequence below is what matters, because idempotency must sit behind
	// authentication or an unauthenticated caller can write to the shared
	// idempotency table.
	router.Use(middleware.RequestID)
	router.Use(middleware.RealIP)
	router.Use(middleware.Recoverer)
	router.Use(middleware.Timeout(requestTimeout))

	router.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteJSON(w, logger, http.StatusOK, map[string]string{"status": "ok"})
	})

	// The redemption API (docs/09 §8.1). YT-0152's signature verification and
	// YT-0039's idempotency interceptor are the guards that make it safe to
	// expose: mounted in their own sub-router so the fixed order above still
	// holds — every request reaching `redeem.Routes` has already had its
	// merchant signature verified and its idempotency key resolved.
	verifier := merchantauth.New(pool, keys)
	interceptor := idempotency.New(pool)
	router.Route("/v1/vouchers", func(r chi.Router) {
		r.Use(verifier.Middleware(logger))
		r.Use(interceptor.Middleware(logger))
		r.Mount("/", redeem.Routes(logger, network))
	})

	go sweepHolds(ctx, logger, network)

	router.NotFound(func(w http.ResponseWriter, _ *http.Request) {
		httpx.WriteError(w, logger, http.StatusNotFound,
			"invalid_request_error", "not_found", "no such endpoint")
	})

	addr := os.Getenv("VOUCHER_ADDR")
	if addr == "" {
		addr = defaultAddr
	}

	server := &http.Server{
		Addr:              addr,
		Handler:           router,
		ReadHeaderTimeout: requestTimeout,
	}

	// Graceful shutdown from the first commit rather than retrofitted: this
	// service holds open transactions that move value, and killing it
	// mid-capture is the one thing it must never do.
	errs := make(chan error, 1)
	go func() {
		logger.Info("voucher listening", "addr", addr, "minter", minter != nil)
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

// loadKeys refuses to start without the voucher-code key.
func loadKeys() (*keyring.Keyring, error) {
	directory := os.Getenv(keyring.KeyDirEnvVar)
	if directory == "" {
		return nil, fmt.Errorf(
			"no %s. Voucher codes are envelope-encrypted from the first code ever minted "+
				"(docs/15 rule 7), so there is no mode in which this service runs without a key",
			keyring.KeyDirEnvVar)
	}

	keys, err := keyring.FromDirectory(directory)
	if err != nil {
		return nil, err
	}
	// Both purposes are required at boot, not just voucher_code: a key
	// directory missing the merchant-HMAC key would otherwise boot cleanly
	// and fail every redemption call at first use — the exact failure mode
	// this function exists to convert into a startup error.
	if err := keys.RequirePurposes(keyring.PurposeVoucherCode, keyring.PurposeMerchantHMAC); err != nil {
		return nil, err
	}
	return keys, nil
}

// sweepHolds expires abandoned authorizations.
//
// Errors are logged and the loop continues, for the reason the ledger's
// invariant checker does the same: a job that exits on its first transient
// error stops silently, and everyone keeps believing it is running.
func sweepHolds(ctx context.Context, logger *slog.Logger, network *redeem.Network) {
	ticker := time.NewTicker(sweepInterval)
	defer ticker.Stop()

	for {
		expired, err := network.SweepExpiredHolds(ctx)
		if err != nil {
			logger.Error("sweeping expired holds failed", "error", err)
		} else if expired > 0 {
			logger.Info("released abandoned holds", "count", expired)
		}

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
