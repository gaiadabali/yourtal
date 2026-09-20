// Package idempotency is the Go-side interceptor against the shared
// platform.idempotency table. YT-0039.
//
// docs/13 section 5: "Idempotency is mandatory on every POST that moves
// value... an Idempotency-Key header holding a client-generated UUIDv7. The
// server stores key + request-body hash + status + response for 24 hours.
// Replay with the same body returns the original response plus
// Idempotent-Replay: true; the same key with a different body returns 409
// idempotency_error; a concurrent in-flight request on the same key returns
// 409; a missing header on a value endpoint returns 400." docs/14 §T scopes
// the key `(merchant, key)` rather than leaving it global — see below.
//
// # Why this sits BEHIND authentication, not in front of it
//
// The scope half of the primary key is the caller's own identity. An
// interceptor mounted before authentication would have to scope on
// something the caller supplies unchecked, which hands an attacker the
// choice of scope: pick the same key a real merchant is about to use, and a
// collision either poisons their request or reads back a cached response
// that was never meant for you. cmd/voucher's middleware order — auth, then
// idempotency — is what makes `(merchant, key)` an actual boundary rather
// than a suggestion.
//
// # This package does not talk to the TypeScript idempotency package
//
// packages/idempotency is a separate track's code against the same table.
// This is the Go side only, for services/voucher; nothing here is shared
// code, and nothing there is imported here.
package idempotency

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/merchantauth"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// HeaderKey is the client-supplied idempotency key. A header rather than a
// body field: docs/13's shared middleware spec and Stripe/Amazon (docs/12)
// both put it there, so a generic retry layer can attach it without parsing
// the request it is retrying.
//
// ⚠️ docs/09 §8.1 shows `idempotency_key` as a BODY field on every
// redemption call. That is the one contradiction found while building this
// — see the handback report. The header is what this interceptor reads;
// a value present only in the body is not consulted.
const HeaderKey = "Idempotency-Key"

// ReplayHeader marks a response that was served from a stored answer rather
// than recomputed.
const ReplayHeader = "Idempotent-Replay"

// TTL is how long a key is honoured. docs/13 section 5's number.
const TTL = 24 * time.Hour

const maxKeyLength = 255

// Interceptor is the middleware. A struct with a constructor, for the same
// reason as merchantauth.Verifier: the clock is a seam (docs/13a §8).
type Interceptor struct {
	queries *sqlcgen.Queries
	now     func() time.Time
}

// New wires an Interceptor to the pool holding platform.idempotency.
func New(pool *pgxpool.Pool) *Interceptor {
	return &Interceptor{
		queries: sqlcgen.New(pool),
		now:     func() time.Time { return time.Now().UTC() },
	}
}

// WithClock replaces the clock. Test seam only.
func (i *Interceptor) WithClock(now func() time.Time) *Interceptor {
	i.now = now
	return i
}

// Middleware enforces the idempotency contract described in the package
// comment. It must be mounted BEHIND merchantauth.Verifier.Middleware — see
// the package comment for why, and cmd/voucher for where that is enforced.
func (i *Interceptor) Middleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			i.serve(logger, next, w, r)
		})
	}
}

func (i *Interceptor) serve(logger *slog.Logger, next http.Handler, w http.ResponseWriter, r *http.Request) {
	key := r.Header.Get(HeaderKey)
	if key == "" {
		httpx.WriteError(w, logger, http.StatusBadRequest,
			"invalid_request_error", "idempotency_key_required",
			"this endpoint moves value and requires an Idempotency-Key header")
		return
	}
	if len(key) > maxKeyLength {
		httpx.WriteError(w, logger, http.StatusBadRequest,
			"invalid_request_error", "idempotency_key_too_long",
			"the idempotency key must be at most 255 characters")
		return
	}

	// docs/13a §7's fixed ordering means this should never fire in a real
	// deployment — it is not a client-facing failure mode. Treated as an
	// internal error rather than falling back to an unscoped key, which is
	// exactly the collision `(scope, key)` exists to prevent.
	merchantID, ok := merchantauth.MerchantID(r.Context())
	if !ok {
		logger.Error("idempotency middleware ran with no merchant in context; check middleware order")
		httpx.WriteError(w, logger, http.StatusInternalServerError,
			"api_error", "internal_error", "something went wrong")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		httpx.WriteError(w, logger, http.StatusBadRequest,
			"invalid_request_error", "unreadable_body", "the request body could not be read")
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))

	digest := sha256.Sum256(body)
	scope, fingerprint := merchantID.String(), hex.EncodeToString(digest[:])

	_, err = i.queries.ClaimIdempotencyKey(r.Context(), sqlcgen.ClaimIdempotencyKeyParams{
		Scope: scope, Key: key, Fingerprint: fingerprint,
		ExpiresAt: pgtype.Timestamptz{Time: i.now().Add(TTL), Valid: true},
	})
	switch {
	case err == nil:
		i.runAndRecord(logger, next, w, r, scope, key)
	case isNoRows(err):
		i.replayOrRefuse(r.Context(), w, logger, scope, key, fingerprint)
	default:
		logger.Error("claiming an idempotency key failed", "error", err)
		httpx.WriteError(w, logger, http.StatusInternalServerError,
			"api_error", "internal_error", "something went wrong")
	}
}
