package redeem_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/keyring"
)

// 4.5.c: a device-scoped credential (every one 4.5.d issues) may authorize
// and capture, but void and refund need a stronger, merchant-wide
// principal. Both are refused with 403 before any lookup.

func TestADevicePrincipalIsRefusedOnVoid(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	handler, merchantCred := f.httpFixture(t)

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)
	authorizeRec := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/authorize",
		mustJSON(t, map[string]any{
			"code": plaintext, "amount": 30_000, "currency": "IDR", "merchant_order_ref": orderRef(),
		}), merchantCred, uuid.NewString())
	if authorizeRec.Code != http.StatusOK {
		t.Fatalf("authorize status = %d, body = %s", authorizeRec.Code, authorizeRec.Body.String())
	}
	var authorized struct {
		AuthorizationID string `json:"authorization_id"`
	}
	decodeBody(t, authorizeRec, &authorized)

	keys, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeMerchantHMAC: {1: make([]byte, 32)},
	})
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}
	deviceCred := f.issueDeviceCredential(t, ctx, keys, f.merchantID, "device-1")

	rec := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/void",
		mustJSON(t, map[string]string{"authorization_id": authorized.AuthorizationID}), deviceCred, uuid.NewString())
	if rec.Code != http.StatusForbidden {
		t.Fatalf("void with a device credential = %d, want 403: %s", rec.Code, rec.Body.String())
	}
}

func TestADevicePrincipalIsRefusedOnRefund(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	handler, _ := f.httpFixture(t)

	keys, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeMerchantHMAC: {1: make([]byte, 32)},
	})
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}
	deviceCred := f.issueDeviceCredential(t, ctx, keys, f.merchantID, "device-1")

	// No live capture is needed: the refusal happens before any lookup, the
	// same "cheap refusals first" ordering the kill switch and throttle use.
	rec := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/refund",
		mustJSON(t, map[string]any{"receipt_id": "rcpt_does-not-matter", "amount": 1, "reason": "x", "refund_ref": "r1"}),
		deviceCred, uuid.NewString())
	if rec.Code != http.StatusForbidden {
		t.Fatalf("refund with a device credential = %d, want 403: %s", rec.Code, rec.Body.String())
	}
}
