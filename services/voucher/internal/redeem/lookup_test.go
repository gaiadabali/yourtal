package redeem_test

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/keyring"
	"github.com/yourtal/services/voucher/internal/redeem"
)

// 2.8 T3: the merchant's order lookup, against the real database. The
// domain layer (LookupOrder) and the HTTP route are both exercised, because
// the route's job is to not undo what the domain layer proves.

type lookupAnswer struct {
	AuthorizationID  string `json:"authorization_id"`
	State            string `json:"state"`
	AmountAuthorized int64  `json:"amount_authorized"`
	ExpiresAt        string `json:"expires_at"`
	ReceiptID        string `json:"receipt_id"`
	AmountCaptured   *int64 `json:"amount_captured"`
}

// lookupOverHTTP is one lookup under a FRESH idempotency key, which is what
// a real caller must do: a replayed key returns the stored answer.
func lookupOverHTTP(t *testing.T, handler http.Handler, cred credential, ref string) (int, lookupAnswer, string) {
	t.Helper()
	rec := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/lookup",
		mustJSON(t, map[string]string{"merchant_order_ref": ref}), cred, uuid.NewString())
	var answer lookupAnswer
	if rec.Code == http.StatusOK {
		decodeBody(t, rec, &answer)
	}
	return rec.Code, answer, rec.Body.String()
}

// holdOrder places a 10,000 hold on a fresh voucher and returns its order.
func (f *fixture) holdOrder(t *testing.T) (redeem.Authorization, string) {
	t.Helper()
	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)
	order := orderRef()
	authorization, err := f.network.Authorize(context.Background(), redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000, Currency: "IDR", OrderRef: order,
	})
	if err != nil {
		t.Fatalf("Authorize: %v", err)
	}
	return authorization, order
}

func (f *fixture) ageHold(t *testing.T, id uuid.UUID) {
	t.Helper()
	// Both timestamps move: see TestAnExpiredHoldCannotBeCaptured.
	if _, err := f.pool.Exec(context.Background(),
		`UPDATE voucher.authorization
		    SET created_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes'
		  WHERE id = $1`, id); err != nil {
		t.Fatalf("ageing the hold: %v", err)
	}
}

func TestLookupReadsAHeldOrder(t *testing.T) {
	f := newFixture(t)
	handler, cred := f.httpFixture(t)
	authorization, order := f.holdOrder(t)

	status, answer, body := lookupOverHTTP(t, handler, cred, order)
	if status != http.StatusOK {
		t.Fatalf("status = %d: %s", status, body)
	}
	if answer.AuthorizationID != authorization.ID.String() || answer.State != "held" || answer.AmountAuthorized != 10_000 {
		t.Errorf("answer = %+v, want a held 10,000 hold %s", answer, authorization.ID)
	}
	if answer.ReceiptID != "" || answer.AmountCaptured != nil {
		t.Errorf("a held order carries capture fields: %+v", answer)
	}
	expires, err := time.Parse(time.RFC3339, answer.ExpiresAt)
	if err != nil || !expires.Equal(authorization.ExpiresAt.UTC().Truncate(time.Second)) {
		t.Errorf("expires_at = %q (%v), want %s", answer.ExpiresAt, err, authorization.ExpiresAt)
	}
}

func TestLookupReadsACapturedOrderWithItsReceipt(t *testing.T) {
	f := newFixture(t)
	handler, cred := f.httpFixture(t)
	authorization, order := f.holdOrder(t)

	// A partial capture: the answer carries what was captured, not what was held.
	capture, err := f.network.Capture(context.Background(), authorization.ID, f.merchantID, 7_000, "rcpt_lookup_"+uuid.NewString())
	if err != nil {
		t.Fatalf("Capture: %v", err)
	}

	status, answer, body := lookupOverHTTP(t, handler, cred, order)
	if status != http.StatusOK {
		t.Fatalf("status = %d: %s", status, body)
	}
	if answer.State != "captured" || answer.AmountAuthorized != 10_000 {
		t.Errorf("answer = %+v, want captured, authorized 10,000", answer)
	}
	if answer.ReceiptID != capture.ReceiptID {
		t.Errorf("receipt_id = %q, want %q", answer.ReceiptID, capture.ReceiptID)
	}
	if answer.AmountCaptured == nil || *answer.AmountCaptured != 7_000 {
		t.Errorf("amount_captured = %v, want 7000", answer.AmountCaptured)
	}
}

func TestLookupReadsAVoidedOrder(t *testing.T) {
	f := newFixture(t)
	handler, cred := f.httpFixture(t)
	authorization, order := f.holdOrder(t)
	if err := f.network.Void(context.Background(), authorization.ID, f.merchantID); err != nil {
		t.Fatalf("Void: %v", err)
	}

	status, answer, body := lookupOverHTTP(t, handler, cred, order)
	if status != http.StatusOK || answer.State != "voided" || answer.ReceiptID != "" {
		t.Fatalf("status = %d, answer = %+v (%s), want a voided order with no receipt", status, answer, body)
	}
}

// A hold past its expires_at reads as expired while its row still says held,
// and again once the sweeper has caught up.
func TestLookupReadsAnExpiredHoldBeforeAndAfterTheSweep(t *testing.T) {
	f := newFixture(t)
	handler, cred := f.httpFixture(t)
	ctx := context.Background()
	authorization, order := f.holdOrder(t)
	f.ageHold(t, authorization.ID)

	var rowState string
	if err := f.pool.QueryRow(ctx, `SELECT state FROM voucher.authorization WHERE id = $1`, authorization.ID).Scan(&rowState); err != nil || rowState != "held" {
		t.Fatalf("precondition: row state = %q (%v), want held until swept", rowState, err)
	}
	if status, answer, body := lookupOverHTTP(t, handler, cred, order); status != http.StatusOK || answer.State != "expired" {
		t.Fatalf("unswept: status = %d, answer = %+v (%s), want expired", status, answer, body)
	}

	if _, err := f.network.SweepExpiredHolds(ctx); err != nil {
		t.Fatalf("SweepExpiredHolds: %v", err)
	}
	if status, answer, body := lookupOverHTTP(t, handler, cred, order); status != http.StatusOK || answer.State != "expired" {
		t.Fatalf("swept: status = %d, answer = %+v (%s), want expired", status, answer, body)
	}
}

func TestLookupRefusesABlankReference(t *testing.T) {
	f := newFixture(t)
	handler, cred := f.httpFixture(t)

	for name, body := range map[string][]byte{
		"empty":      mustJSON(t, map[string]string{"merchant_order_ref": ""}),
		"whitespace": mustJSON(t, map[string]string{"merchant_order_ref": "   "}),
		"missing":    []byte(`{}`),
	} {
		rec := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/lookup", body, cred, uuid.NewString())
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400: %s", name, rec.Code, rec.Body.String())
		}
	}
	if _, err := f.network.LookupOrder(context.Background(), f.merchantID, " "); !errors.Is(err, redeem.ErrOrderRefRequired) {
		t.Errorf("LookupOrder(blank) = %v, want ErrOrderRefRequired", err)
	}
}

// A lookup is a read: any number of misses add no failed-attempt row, so
// they never feed the 20-in-5-minutes throttle, and no authorization moves.
func TestLookupIsNeverCountedAsAFailedAttemptAndChangesNothing(t *testing.T) {
	f := newFixture(t)
	handler, cred := f.httpFixture(t)
	ctx := context.Background()
	authorization, order := f.holdOrder(t)

	count := func(query string, args ...any) int {
		var n int
		if err := f.pool.QueryRow(ctx, query, args...).Scan(&n); err != nil {
			t.Fatalf("counting: %v", err)
		}
		return n
	}
	attempts := func() int {
		return count(`SELECT count(*) FROM voucher.redemption_attempt WHERE merchant_id = $1`, f.merchantID)
	}
	snapshot := func() string {
		var s string
		if err := f.pool.QueryRow(ctx,
			`SELECT a.state || '|' || coalesce(a.resolved_at::text, '') || '|' || v.state || '|' || v.remaining_value_minor
			   FROM voucher.authorization a JOIN voucher.vouchers v ON v.id = a.voucher_id WHERE a.id = $1`,
			authorization.ID).Scan(&s); err != nil {
			t.Fatalf("snapshot: %v", err)
		}
		return s
	}
	captures := func() int {
		return count(`SELECT count(*) FROM voucher.capture WHERE authorization_id = $1`, authorization.ID)
	}

	attemptsBefore, stateBefore, capturesBefore := attempts(), snapshot(), captures()

	// More misses than redeem.FailureThreshold, plus hits.
	for i := 0; i < redeem.FailureThreshold+5; i++ {
		if status, _, _ := lookupOverHTTP(t, handler, cred, "never-placed-"+uuid.NewString()); status != http.StatusNotFound {
			t.Fatalf("miss %d: status = %d, want 404", i, status)
		}
	}
	for i := 0; i < 3; i++ {
		if status, _, body := lookupOverHTTP(t, handler, cred, order); status != http.StatusOK {
			t.Fatalf("hit %d: status = %d: %s", i, status, body)
		}
	}

	if got := attempts(); got != attemptsBefore {
		t.Errorf("redemption_attempt rows: %d before, %d after the lookups; a lookup must write none", attemptsBefore, got)
	}
	if got := snapshot(); got != stateBefore {
		t.Errorf("state changed under lookups: %q -> %q", stateBefore, got)
	}
	if got := captures(); got != capturesBefore {
		t.Errorf("capture rows: %d -> %d", capturesBefore, got)
	}

	// And the merchant is not throttled: a real authorize still goes through.
	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)
	if _, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 1_000, Currency: "IDR", OrderRef: orderRef(),
	}); err != nil {
		t.Fatalf("Authorize after %d lookup misses: %v", redeem.FailureThreshold+5, err)
	}
}

// 4.5.c refuses a device principal on void and refund because they move
// value back. A lookup moves nothing, so a device credential may call it.
func TestADeviceCredentialMayLookUpAnOrder(t *testing.T) {
	f := newFixture(t)
	handler, _ := f.httpFixture(t)
	_, order := f.holdOrder(t)

	keys, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeMerchantHMAC: {1: make([]byte, 32)},
	})
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}
	device := f.issueDeviceCredential(t, context.Background(), keys, f.merchantID, "device-lookup")

	status, answer, body := lookupOverHTTP(t, handler, device, order)
	if status != http.StatusOK || answer.State != "held" {
		t.Fatalf("a device credential's lookup = %d, %+v (%s), want 200 held", status, answer, body)
	}
}
