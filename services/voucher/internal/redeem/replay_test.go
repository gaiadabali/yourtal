package redeem_test

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/idempotency"
	"github.com/yourtal/services/voucher/internal/merchantauth"
)

// 4.6.d: engine-voucher.md D8 and D9, over real signed HTTP.

// captureOverHTTP authorizes and captures 30,000 of a 50,000 voucher.
func (f *fixture) captureOverHTTP(t *testing.T, handler http.Handler, cred credential) (uuid.UUID, string) {
	t.Helper()
	voucherID, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)
	rec := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/authorize", mustJSON(t, map[string]any{
		"code": plaintext, "amount": 30_000, "currency": "IDR", "merchant_order_ref": orderRef(),
	}), cred, uuid.NewString())
	var held struct {
		AuthorizationID string `json:"authorization_id"`
	}
	decodeBody(t, rec, &held)
	rec = signedRequest(t, handler, http.MethodPost, "/v1/vouchers/capture", mustJSON(t, map[string]any{
		"authorization_id": held.AuthorizationID, "final_amount": 30_000,
	}), cred, uuid.NewString())
	var captured struct {
		ReceiptID string `json:"receipt_id"`
	}
	decodeBody(t, rec, &captured)
	if captured.ReceiptID == "" {
		t.Fatalf("capture failed: %s", rec.Body.String())
	}
	return voucherID, captured.ReceiptID
}

// send posts body with an explicit signature header and idempotency key.
func send(handler http.Handler, path, signature, key string, body []byte) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	req.Header.Set(merchantauth.SignatureHeader, signature)
	req.Header.Set(idempotency.HeaderKey, key)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

// D9: a signed refund captured from a log was replayed within the window
// with a fresh Idempotency-Key, and a second refund applied.
func TestAReplayedSignedRequestIsRefused(t *testing.T) {
	f := newFixture(t)
	handler, cred := f.httpFixture(t)
	voucherID, receipt := f.captureOverHTTP(t, handler, cred)

	path := "/v1/vouchers/refund"
	body := mustJSON(t, map[string]any{"receipt_id": receipt, "amount": 5_000, "reason": "probe", "refund_ref": uuid.NewString()})
	key := "key-1-" + uuid.NewString()
	signature := signFor(cred, http.MethodPost, path, key, body, time.Now().UTC())

	if rec := send(handler, path, signature, key, body); rec.Code != http.StatusOK {
		t.Fatalf("refund: %d %s", rec.Code, rec.Body.String())
	}
	if rec := send(handler, path, signature, "key-2-"+uuid.NewString(), body); rec.Code != http.StatusUnauthorized {
		t.Fatalf("the replayed signature with a new key answered %d, want 401", rec.Code)
	}
	if got := f.remainingOf(t, voucherID); got != 25_000 {
		t.Errorf("remaining = %d after one 5,000 refund, want 25000", got)
	}
}

// D8: a refund whose completion was never recorded could be retried under a
// new key and applied twice. Its business reference makes it happen once.
func TestARefundRefIsAppliedOnce(t *testing.T) {
	f := newFixture(t)
	handler, cred := f.httpFixture(t)
	voucherID, receipt := f.captureOverHTTP(t, handler, cred)

	body := mustJSON(t, map[string]any{"receipt_id": receipt, "amount": 5_000, "reason": "probe", "refund_ref": "till-7-refund-1"})
	for i := range 2 {
		rec := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/refund", body, cred, uuid.NewString())
		if rec.Code != http.StatusOK {
			t.Fatalf("refund attempt %d: %d %s", i, rec.Code, rec.Body.String())
		}
	}
	if got := f.remainingOf(t, voucherID); got != 25_000 {
		t.Errorf("remaining = %d after the same refund twice, want 25000", got)
	}
}
