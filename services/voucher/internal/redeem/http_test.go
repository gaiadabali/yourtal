package redeem_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/voucher/internal/idempotency"
	"github.com/yourtal/services/voucher/internal/keyring"
	"github.com/yourtal/services/voucher/internal/merchantauth"
	"github.com/yourtal/services/voucher/internal/redeem"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// The full chain, wired exactly as cmd/voucher wires it — RequestID/RealIP/
// Recoverer/Timeout are chi/stdlib middleware with nothing voucher-specific
// to prove, so this starts at auth: merchantauth.Verifier ->
// idempotency.Interceptor -> redeem.Routes. Everything in redeem_test.go,
// adversarial_test.go and tamper_test.go proves the DOMAIN layer; this file
// (and http_authz_test.go) proves the HTTP layer does not undo any of it —
// the two are different claims, per docs/13c-lessons.md's point that a gate
// must be shown to cover what it names.

func discardLogger() *slog.Logger { return slog.New(slog.NewJSONHandler(io.Discard, nil)) }

// credential is a merchant able to sign requests: a secret, sealed and
// stored exactly as YT-0152 expects, plus the key id that names it.
type credential struct {
	merchantID uuid.UUID
	secret     []byte
	keyID      string
}

// httpFixture wires the same three-middleware chain cmd/voucher builds, and
// mints a credential for the fixture's own seeded merchant (`f.merchantID`)
// so its vouchers can actually be redeemed over HTTP.
func (f *fixture) httpFixture(t *testing.T) (http.Handler, credential) {
	t.Helper()
	ctx := context.Background()

	keys, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeMerchantHMAC: {1: make([]byte, 32)},
	})
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}

	cred := f.issueCredential(t, ctx, keys, f.merchantID)

	verifier := merchantauth.New(f.pool, keys)
	interceptor := idempotency.New(f.pool)

	router := chi.NewRouter()
	router.Route("/v1/vouchers", func(r chi.Router) {
		r.Use(verifier.Middleware(discardLogger()))
		r.Use(interceptor.Middleware(discardLogger()))
		r.Mount("/", redeem.Routes(discardLogger(), f.network))
	})

	return router, cred
}

// issueCredential seals a fresh secret for merchantID and stores it exactly
// as the merchant-credential migration expects — the same path
// `voucher.merchant_credential` is populated through in production, not a
// shortcut around it.
func (f *fixture) issueCredential(
	t *testing.T, ctx context.Context, keys *keyring.Keyring, merchantID uuid.UUID,
) credential {
	t.Helper()

	secret := []byte("http-integration test secret, 32by")
	sealed, err := keys.Seal(keyring.PurposeMerchantHMAC, secret)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}

	keyID := "key_http_test_" + uuid.NewString()
	if err := sqlcgen.New(f.pool).InsertCredential(ctx, sqlcgen.InsertCredentialParams{
		KeyID:          keyID,
		MerchantID:     pgtype.UUID{Bytes: merchantID, Valid: true},
		WrappedDataKey: sealed.WrappedDataKey,
		Nonce:          sealed.Nonce,
		Ciphertext:     sealed.Ciphertext,
		KeyPurpose:     string(sealed.Purpose),
		KeyVersion:     int32(sealed.Version),
	}); err != nil {
		t.Fatalf("InsertCredential: %v", err)
	}

	return credential{merchantID: merchantID, secret: secret, keyID: keyID}
}

// issueDeviceCredential is issueCredential's device-scoped twin (4.5.c/d):
// the same signed-credential shape, but voucher.merchant_credential.device_id
// is set, which is what makes the request's context carry a device id after
// Middleware — see routes_release.go's refuseDevicePrincipal.
func (f *fixture) issueDeviceCredential(
	t *testing.T, ctx context.Context, keys *keyring.Keyring, merchantID uuid.UUID, deviceID string,
) credential {
	t.Helper()

	secret := []byte("http-integration test device secret, 32b")
	sealed, err := keys.Seal(keyring.PurposeMerchantHMAC, secret)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}

	keyID := "key_http_device_test_" + uuid.NewString()
	if err := sqlcgen.New(f.pool).InsertCredential(ctx, sqlcgen.InsertCredentialParams{
		KeyID:          keyID,
		MerchantID:     pgtype.UUID{Bytes: merchantID, Valid: true},
		WrappedDataKey: sealed.WrappedDataKey,
		Nonce:          sealed.Nonce,
		Ciphertext:     sealed.Ciphertext,
		KeyPurpose:     string(sealed.Purpose),
		KeyVersion:     int32(sealed.Version),
		DeviceID:       &deviceID,
	}); err != nil {
		t.Fatalf("InsertCredential: %v", err)
	}

	return credential{merchantID: merchantID, secret: secret, keyID: keyID}
}

// signedRequest builds a real, independently-verifiable signed request —
// the same three lines docs/09 §10 asks a merchant's SDK to implement.
func signedRequest(t *testing.T, handler http.Handler, method, path string, body []byte, cred credential, idempotencyKey string) *httptest.ResponseRecorder {
	t.Helper()

	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	header := signFor(cred, method, path, idempotencyKey, body, time.Now().UTC())
	req.Header.Set(merchantauth.SignatureHeader, header)
	if idempotencyKey != "" {
		req.Header.Set(idempotency.HeaderKey, idempotencyKey)
	}

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder, dst any) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), dst); err != nil {
		t.Fatalf("decoding response %s: %v", rec.Body.String(), err)
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

// TestAuthorizeAndCaptureOverHTTP is the control: the whole chain, signed
// and idempotency-keyed exactly as a real merchant would call it, has to
// actually work before any of the refusal tests below mean anything.
func TestAuthorizeAndCaptureOverHTTP(t *testing.T) {
	f := newFixture(t)
	handler, cred := f.httpFixture(t)

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	authorizeBody, _ := json.Marshal(map[string]any{
		"code": plaintext, "amount": 30_000, "currency": "IDR",
		"merchant_order_ref": orderRef(),
	})
	rec := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/authorize",
		authorizeBody, cred, uuid.NewString())
	if rec.Code != http.StatusOK {
		t.Fatalf("authorize status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var authorized struct {
		AuthorizationID  string `json:"authorization_id"`
		RemainingBalance int64  `json:"remaining_balance"`
	}
	decodeBody(t, rec, &authorized)
	if authorized.AuthorizationID == "" {
		t.Fatal("authorize did not return an authorization_id")
	}
	if authorized.RemainingBalance != 50_000 {
		t.Errorf("remaining_balance = %d before capture, want the full face value", authorized.RemainingBalance)
	}

	captureBody, _ := json.Marshal(map[string]any{
		"authorization_id": authorized.AuthorizationID, "final_amount": 30_000,
	})
	rec = signedRequest(t, handler, http.MethodPost, "/v1/vouchers/capture",
		captureBody, cred, uuid.NewString())
	if rec.Code != http.StatusOK {
		t.Fatalf("capture status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var captured struct {
		ReceiptID        string `json:"receipt_id"`
		RemainingBalance int64  `json:"remaining_balance"`
	}
	decodeBody(t, rec, &captured)
	if captured.ReceiptID == "" {
		t.Fatal("capture did not return a receipt_id")
	}
	if captured.RemainingBalance != 20_000 {
		t.Errorf("remaining_balance = %d after a 30,000 capture on a 50,000 voucher, want 20,000",
			captured.RemainingBalance)
	}
}

// TestTheSameIdempotencyKeyReplaysRatherThanCreatingASecondHold is the
// required proof: two authorize calls, same key, same body, over real HTTP
// with a real signature on each — the second must return the FIRST hold,
// and the database must show exactly one row for it, not two.
func TestTheSameIdempotencyKeyReplaysRatherThanCreatingASecondHold(t *testing.T) {
	f := newFixture(t)
	handler, cred := f.httpFixture(t)

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)
	order := orderRef()
	key := uuid.NewString()

	authorizeBody, _ := json.Marshal(map[string]any{
		"code": plaintext, "amount": 10_000, "currency": "IDR", "merchant_order_ref": order,
	})

	first := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/authorize", authorizeBody, cred, key)
	second := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/authorize", authorizeBody, cred, key)

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("status = %d, %d; want 200, 200", first.Code, second.Code)
	}
	if first.Body.String() != second.Body.String() {
		t.Fatalf("a replay returned a different body:\n  first:  %s\n  second: %s",
			first.Body.String(), second.Body.String())
	}
	if second.Header().Get(idempotency.ReplayHeader) != "true" {
		t.Error("the replayed authorize is not marked Idempotent-Replay: true")
	}

	var holds int
	if err := f.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM voucher.authorization WHERE merchant_order_ref = $1`, order).Scan(&holds); err != nil {
		t.Fatalf("counting holds: %v", err)
	}
	if holds != 1 {
		t.Fatalf("the database holds %d authorizations for one idempotency key; want 1 "+
			"(a second row would be a second hold)", holds)
	}
}

// TestDifferentIdempotencyKeysAreCaughtByTheVoucherIndexNotByIdempotency is
// the required second proof: two DIFFERENT idempotency keys on the same
// voucher, different order references so idempotency itself has nothing to
// replay, must both reach the domain layer — and the second is refused by
// `authorization_one_live_hold_per_voucher`, surfaced here as
// `voucher_already_held`, not by anything in this package.
func TestDifferentIdempotencyKeysAreCaughtByTheVoucherIndexNotByIdempotency(t *testing.T) {
	f := newFixture(t)
	handler, cred := f.httpFixture(t)

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	first := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/authorize", mustJSON(t, map[string]any{
		"code": plaintext, "amount": 10_000, "currency": "IDR", "merchant_order_ref": orderRef(),
	}), cred, uuid.NewString())
	if first.Code != http.StatusOK {
		t.Fatalf("the first authorize failed: %d %s", first.Code, first.Body.String())
	}

	second := signedRequest(t, handler, http.MethodPost, "/v1/vouchers/authorize", mustJSON(t, map[string]any{
		"code": plaintext, "amount": 5_000, "currency": "IDR", "merchant_order_ref": orderRef(),
	}), cred, uuid.NewString())

	if second.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 — a second distinct authorize on a held voucher "+
			"must reach the partial index, not be silently accepted: %s", second.Code, second.Body.String())
	}

	var envelope struct {
		Error struct{ Code string } `json:"error"`
	}
	decodeBody(t, second, &envelope)
	if envelope.Error.Code != "voucher_already_held" {
		t.Errorf("error code = %q, want voucher_already_held", envelope.Error.Code)
	}
}

// signFor is the one place these tests sign, so the canonical string lives
// in merchantauth alone.
func signFor(cred credential, method, path, idempotencyKey string, body []byte, at time.Time) string {
	return merchantauth.Sign(cred.secret, cred.keyID, method, path, idempotencyKey, body, at)
}
