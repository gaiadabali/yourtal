package idempotency

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// Split from idempotency.go so that file stays orchestration-only: what
// happens after a claim succeeds or is lost is the seam everything else in
// this package tests.

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// runAndRecord executes the wrapped handler against a buffer, durably
// records the result as this key's permanent answer, and only then releases
// it to the real client — in that order, so nothing is ever delivered that
// was not first written down as what this key means.
func (i *Interceptor) runAndRecord(
	logger *slog.Logger, next http.Handler, w http.ResponseWriter, r *http.Request, scope, key string,
) {
	rec := newRecorder()
	next.ServeHTTP(rec, r)

	body := rec.body.String()
	status := int16(rec.status)
	// Not r.Context(): a client that hangs up as the work commits must not
	// leave its key in_progress (D8).
	if err := i.queries.CompleteIdempotency(context.WithoutCancel(r.Context()), sqlcgen.CompleteIdempotencyParams{
		Scope: scope, Key: key, Status: &status, Body: &body,
	}); err != nil {
		// The caller's request already succeeded or failed for real — a
		// bookkeeping failure here must not turn that into a 500 the caller
		// did not earn, so the buffered response still ships. Logged loudly
		// because the row is left 'in_progress': every retry of this exact
		// key is refused as "in progress" until the row is pruned or fixed by
		// hand. Recorded as a known gap in the handback report.
		logger.Error("recording idempotency completion failed", "error", err, "scope", scope, "key", key)
	}

	rec.flush(w)
}

// replayOrRefuse handles every request that lost the claim race: a genuine
// retry (same fingerprint — replay the stored answer), a reused key carrying
// a different body (refused), or a request still being processed
// concurrently (refused). docs/13 section 5 is explicit that all three are
// different outcomes, not one generic conflict.
func (i *Interceptor) replayOrRefuse(
	ctx context.Context, w http.ResponseWriter, logger *slog.Logger, scope, key, fingerprint string,
) {
	existing, err := i.queries.GetIdempotency(ctx, sqlcgen.GetIdempotencyParams{Scope: scope, Key: key})
	if err != nil {
		// Lost the insert race a moment ago; the row it lost to should be
		// readable now. If it is not, this is an internal error, not a
		// client one — nothing in this service deletes idempotency rows.
		logger.Error("an idempotency key lost its claim race and then could not be read", "error", err)
		httpx.WriteError(w, logger, http.StatusInternalServerError,
			"api_error", "internal_error", "something went wrong")
		return
	}

	if existing.Fingerprint != fingerprint {
		httpx.WriteError(w, logger, http.StatusConflict,
			"idempotency_error", "idempotency_key_reused",
			"this idempotency key was already used with a different request")
		return
	}

	if existing.State != "completed" {
		httpx.WriteError(w, logger, http.StatusConflict,
			"idempotency_error", "idempotency_request_in_progress",
			"a request with this idempotency key is already being processed")
		return
	}

	if existing.Status == nil || existing.Body == nil {
		// Unreachable while `idempotency_completed_has_response` holds — see
		// the migration. Refused rather than a nil dereference: docs/13a §3
		// forbids a panic outside main, and a stale trust in a CHECK
		// constraint that later changed is exactly the kind of bug that rule
		// exists to survive.
		logger.Error("a completed idempotency row has no stored response", "scope", scope, "key", key)
		httpx.WriteError(w, logger, http.StatusInternalServerError,
			"api_error", "internal_error", "something went wrong")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set(ReplayHeader, "true")
	w.WriteHeader(int(*existing.Status))
	_, _ = w.Write([]byte(*existing.Body))
}
