package redeem_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/keyring"
)

// Split from http_test.go to keep each file under docs/13a §9's 300-line
// limit. Both tests here are about a SECOND merchant — the enumeration
// defence for an unknown voucher, and the ownership check for a known
// authorization id.

// TestWrongMerchantAndUnknownCodeAreIdenticalOverHTTP re-proves
// adversarial_test.go's enumeration invariant at the HTTP boundary, where a
// mapping mistake (a distinct status code, a wrapped error message) could
// reopen the oracle even though the domain layer never leaked it.
func TestWrongMerchantAndUnknownCodeAreIdenticalOverHTTP(t *testing.T) {
	f := newFixture(t)
	handler, _ := f.httpFixture(t)

	ctx := context.Background()
	keys, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeMerchantHMAC: {1: make([]byte, 32)},
	})
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}
	stranger := f.issueCredential(t, ctx, keys, uuid.New())

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	wrongMerchant := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/authorize", mustJSON(t, map[string]any{
		"code": plaintext, "amount": 10_000, "currency": "IDR", "merchant_order_ref": orderRef(),
	}), stranger, uuid.NewString())

	unknownCode := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/authorize", mustJSON(t, map[string]any{
		"code": mintedButUnknownCode(t), "amount": 10_000, "currency": "IDR", "merchant_order_ref": orderRef(),
	}), stranger, uuid.NewString())

	if wrongMerchant.Code != unknownCode.Code {
		t.Errorf("status differs: wrong-merchant %d vs unknown-code %d", wrongMerchant.Code, unknownCode.Code)
	}
	if wrongMerchant.Body.String() != unknownCode.Body.String() {
		t.Errorf("bodies differ over HTTP, which is the oracle docs/09 §10 exists to remove:\n  wrong merchant: %s\n  unknown code:   %s",
			wrongMerchant.Body.String(), unknownCode.Body.String())
	}
}

// TestAnotherMerchantCannotCaptureYourAuthorization: settle.go's
// ResolveAuthorization matches an authorization by id alone, with no
// merchant check of its own (see ownership.go's package comment) — this
// proves the HTTP-layer check added there actually stops a second
// merchant's signed, otherwise-valid capture call from resolving somebody
// else's hold.
func TestAnotherMerchantCannotCaptureYourAuthorization(t *testing.T) {
	f := newFixture(t)
	handler, owner := f.httpFixture(t)

	ctx := context.Background()
	keys, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeMerchantHMAC: {1: make([]byte, 32)},
	})
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}
	stranger := f.issueCredential(t, ctx, keys, uuid.New())

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	authorize := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/authorize", mustJSON(t, map[string]any{
		"code": plaintext, "amount": 10_000, "currency": "IDR", "merchant_order_ref": orderRef(),
	}), owner, uuid.NewString())
	if authorize.Code != http.StatusOK {
		t.Fatalf("the owning merchant's authorize failed: %d %s", authorize.Code, authorize.Body.String())
	}
	var authorized struct {
		AuthorizationID string `json:"authorization_id"`
	}
	decodeBody(t, authorize, &authorized)

	capture := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/capture", mustJSON(t, map[string]any{
		"authorization_id": authorized.AuthorizationID, "final_amount": 10_000,
	}), stranger, uuid.NewString())

	if capture.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 — a stranger captured another merchant's authorization: %s",
			capture.Code, capture.Body.String())
	}

	// And the real owner can still capture it — the check refused the
	// stranger without damaging the hold.
	retry := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/capture", mustJSON(t, map[string]any{
		"authorization_id": authorized.AuthorizationID, "final_amount": 10_000,
	}), owner, uuid.NewString())
	if retry.Code != http.StatusOK {
		t.Fatalf("the owning merchant's capture failed after a stranger was refused: %d %s",
			retry.Code, retry.Body.String())
	}
}

// TestAnotherMerchantCannotRefundYourReceipt is
// TestAnotherMerchantCannotCaptureYourAuthorization's counterpart for
// refund: YT-0571 point 1 says "refund-by-receipt has the same shape as
// capture", and GetCaptureByReceipt (redeem.sql) now carries the same
// merchant_id predicate ResolveAuthorization does. This proves it end to
// end over HTTP, where captureForReceipt's own boundary check (ownership.go)
// and the query predicate both have to actually be wired for a stranger's
// receipt_id guess to be refused.
func TestAnotherMerchantCannotRefundYourReceipt(t *testing.T) {
	f := newFixture(t)
	handler, owner := f.httpFixture(t)

	ctx := context.Background()
	keys, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeMerchantHMAC: {1: make([]byte, 32)},
	})
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}
	stranger := f.issueCredential(t, ctx, keys, uuid.New())

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	authorize := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/authorize", mustJSON(t, map[string]any{
		"code": plaintext, "amount": 10_000, "currency": "IDR", "merchant_order_ref": orderRef(),
	}), owner, uuid.NewString())
	if authorize.Code != http.StatusOK {
		t.Fatalf("the owning merchant's authorize failed: %d %s", authorize.Code, authorize.Body.String())
	}
	var authorized struct {
		AuthorizationID string `json:"authorization_id"`
	}
	decodeBody(t, authorize, &authorized)

	capture := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/capture", mustJSON(t, map[string]any{
		"authorization_id": authorized.AuthorizationID, "final_amount": 10_000,
	}), owner, uuid.NewString())
	if capture.Code != http.StatusOK {
		t.Fatalf("the owning merchant's capture failed: %d %s", capture.Code, capture.Body.String())
	}
	var captured struct {
		ReceiptID string `json:"receipt_id"`
	}
	decodeBody(t, capture, &captured)

	refund := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/refund", mustJSON(t, map[string]any{
		"receipt_id": captured.ReceiptID, "amount": 5_000, "reason": "not yours", "refund_ref": "stranger-1",
	}), stranger, uuid.NewString())
	if refund.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 — a stranger refunded another merchant's receipt: %s",
			refund.Code, refund.Body.String())
	}

	// The real owner can still refund it.
	retry := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/refund", mustJSON(t, map[string]any{
		"receipt_id": captured.ReceiptID, "amount": 5_000, "reason": "customer returned an item", "refund_ref": "owner-1",
	}), owner, uuid.NewString())
	if retry.Code != http.StatusOK {
		t.Fatalf("the owning merchant's refund failed after a stranger was refused: %d %s",
			retry.Code, retry.Body.String())
	}
}

// TestLookupRefusesAnOtherMerchantsOrderLikeAnUnknownOne: the order lookup
// is keyed by a merchant-chosen reference, so it must not be an oracle for
// another merchant's orders. A stranger asking for the owner's reference gets
// byte-for-byte what an unknown reference gets, and the owner still sees it.
func TestLookupRefusesAnOtherMerchantsOrderLikeAnUnknownOne(t *testing.T) {
	f := newFixture(t)
	handler, owner := f.httpFixture(t)

	keys, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeMerchantHMAC: {1: make([]byte, 32)},
	})
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}
	stranger := f.issueCredential(t, context.Background(), keys, uuid.New())
	_, order := f.holdOrder(t)

	foreign := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/lookup",
		mustJSON(t, map[string]string{"merchant_order_ref": order}), stranger, uuid.NewString())
	unknown := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/lookup",
		mustJSON(t, map[string]string{"merchant_order_ref": orderRef()}), stranger, uuid.NewString())

	if foreign.Code != http.StatusNotFound || unknown.Code != http.StatusNotFound {
		t.Fatalf("status = %d (another merchant's), %d (unknown); want 404, 404: %s",
			foreign.Code, unknown.Code, foreign.Body.String())
	}
	if foreign.Body.String() != unknown.Body.String() {
		t.Errorf("bodies differ:\n  another merchant's: %s\n  unknown:            %s",
			foreign.Body.String(), unknown.Body.String())
	}
	var envelope struct {
		Error struct{ Code string } `json:"error"`
	}
	decodeBody(t, foreign, &envelope)
	if envelope.Error.Code != "order_not_found" {
		t.Errorf("error code = %q, want order_not_found", envelope.Error.Code)
	}

	if status, answer, body := lookupOverHTTP(t, handler, owner, order); status != http.StatusOK || answer.State != "held" {
		t.Fatalf("the owner's own lookup = %d, %+v (%s)", status, answer, body)
	}
}

// TestLookupNeedsASignatureAndAKey: the route sits behind the same chain as
// authorize, capture and void, so an unsigned call is 401 and a signed call
// with no Idempotency-Key is 400.
func TestLookupNeedsASignatureAndAKey(t *testing.T) {
	f := newFixture(t)
	handler, cred := f.httpFixture(t)
	body := mustJSON(t, map[string]string{"merchant_order_ref": orderRef()})

	if rec := send(handler, "/v1/vouchers/lookup", "", uuid.NewString(), body); rec.Code != http.StatusUnauthorized {
		t.Errorf("unsigned lookup = %d, want 401: %s", rec.Code, rec.Body.String())
	}

	rec := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/lookup", body, cred, "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("lookup with no Idempotency-Key = %d, want 400: %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Error struct{ Code string } `json:"error"`
	}
	decodeBody(t, rec, &envelope)
	if envelope.Error.Code != "idempotency_key_required" {
		t.Errorf("error code = %q, want idempotency_key_required", envelope.Error.Code)
	}
}
