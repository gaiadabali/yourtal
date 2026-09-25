package idempotency_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/idempotency"
	"github.com/yourtal/services/voucher/internal/merchantauth"
)

// D8: completion was recorded on the request's context, so a client that
// disconnected as the refund committed left its key in_progress forever,
// and the retry under a new key refunded again.
func TestCompletionIsRecordedAfterTheClientHangsUp(t *testing.T) {
	h := newHarness(t)
	ctx, hangUp := context.WithCancel(context.Background())
	handler := h.interceptor.Middleware(discardLogger())(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hangUp() // the client goes away while the work commits
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"refunded":true}`))
	}))

	merchant, key, body := uuid.New(), uuid.NewString(), []byte(`{"amount":1}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/vouchers/refund", bytes.NewReader(body)).WithContext(
		merchantauth.WithMerchantID(ctx, merchant))
	req.Header.Set(idempotency.HeaderKey, key)
	handler.ServeHTTP(httptest.NewRecorder(), req)

	// The retry with the same key must replay, not be told "in progress".
	rec := h.request(h.wrap(http.StatusOK, `{"refunded":true}`), merchant, key, body)
	if rec.Header().Get(idempotency.ReplayHeader) != "true" {
		t.Fatalf("the retry got %d %s; the first completion was never recorded", rec.Code, rec.Body.String())
	}
}
