package merchantauth_test

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/keyring"
	"github.com/yourtal/services/voucher/internal/merchantauth"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// The HTTP wiring for YT-0152: signing.go is well tested on its own, and
// none of that proves it is actually consulted before a handler runs. This
// is the same distinction docs/13c-lessons.md draws about the ledger's
// repositories — a passing suite for the unwired version and the wired
// version can look identical unless something drives the real
// http.Handler behind the real middleware, against real Postgres, which is
// what every test below does.
const defaultURL = "postgres://yourtal_voucher:voucher_local_only@127.0.0.1:26432/yourtal"

// `body`, `secret` and `now` are signing_test.go's package-level fixtures,
// reused here rather than redeclared.

func discardLogger() *slog.Logger { return slog.New(slog.NewJSONHandler(io.Discard, nil)) }

type harness struct {
	secret     []byte
	keyID      string
	merchantID uuid.UUID
	called     bool
	handler    http.Handler
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	ctx := context.Background()

	url := os.Getenv("VOUCHER_DATABASE_URL")
	if url == "" {
		url = defaultURL
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("no local Postgres (run `pnpm dev:up`): %v", err)
	}
	t.Cleanup(pool.Close)

	keys, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeMerchantHMAC: {1: make([]byte, 32)},
	})
	if err != nil {
		t.Fatalf("keyring: %v", err)
	}

	secret := []byte("a merchant's shared secret, 32 bytes+")
	sealed, err := keys.Seal(keyring.PurposeMerchantHMAC, secret)
	if err != nil {
		t.Fatalf("seal: %v", err)
	}

	merchantID := uuid.New()
	keyID := "key_test_" + uuid.New().String()

	if err := sqlcgen.New(pool).InsertCredential(ctx, sqlcgen.InsertCredentialParams{
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

	h := &harness{secret: secret, keyID: keyID, merchantID: merchantID}

	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.called = true
		id, ok := merchantauth.MerchantID(r.Context())
		if !ok || id != h.merchantID {
			// Distinct from both 200 and 401 so a test failure here cannot be
			// mistaken for either the pass or the refusal case.
			w.WriteHeader(http.StatusTeapot)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	h.handler = merchantauth.New(pool, keys).Middleware(discardLogger())(inner)

	return h
}

func (h *harness) request(payload []byte, header string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v1/vouchers/authorize", bytes.NewReader(payload))
	if header != "" {
		req.Header.Set(merchantauth.SignatureHeader, header)
	}
	rec := httptest.NewRecorder()
	h.called = false
	h.handler.ServeHTTP(rec, req)
	return rec
}

func (h *harness) sign(secret []byte, keyID string, at time.Time) string {
	return merchantauth.Sign(secret, keyID, http.MethodPost, "/v1/vouchers/authorize", body, at)
}

// TestNoSignatureIsRefused is break-it proof #1: a request carrying no
// signature at all must never reach the handler.
func TestNoSignatureIsRefused(t *testing.T) {
	h := newHarness(t)
	rec := h.request(body, "")

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if h.called {
		t.Fatal("the protected handler ran with no signature presented")
	}
}

// TestAnUnknownKeyIdIsRefused: a syntactically valid signature naming a key
// this merchant credential table has never heard of.
func TestAnUnknownKeyIdIsRefused(t *testing.T) {
	h := newHarness(t)
	header := h.sign(h.secret, "key_does_not_exist", time.Now().UTC())

	rec := h.request(body, header)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if h.called {
		t.Fatal("the protected handler ran for an unknown key id")
	}
}

// TestATamperedBodyIsRefused is break-it proof #2: a signature computed over
// the ORIGINAL body must not verify against a body an attacker changed in
// flight — here, the amount.
func TestATamperedBodyIsRefused(t *testing.T) {
	h := newHarness(t)
	header := h.sign(h.secret, h.keyID, time.Now().UTC())

	tampered := []byte(strings.Replace(string(body), `"amount":3000`, `"amount":300000`, 1))

	rec := h.request(tampered, header)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 — a tampered body verified", rec.Code)
	}
	if h.called {
		t.Fatal("the protected handler ran against a body the signature does not cover")
	}
}

// TestATimestampTenMinutesAheadIsRefused is break-it proof #3: docs/09 §10's
// ±5 minute replay window, exercised through the actual HTTP path rather
// than only through signing_test.go's direct call to Verify.
func TestATimestampTenMinutesAheadIsRefused(t *testing.T) {
	h := newHarness(t)
	future := time.Now().UTC().Add(10 * time.Minute)
	header := h.sign(h.secret, h.keyID, future)

	rec := h.request(body, header)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 — a signature 10 minutes in the future verified", rec.Code)
	}
	if h.called {
		t.Fatal("the protected handler ran for a timestamp outside the replay window")
	}
}

// TestAGenuineRequestReachesTheHandlerWithTheMerchantIdentified is the
// control: everything above only means something if a correctly signed
// request DOES get through, carrying the right merchant id.
func TestAGenuineRequestReachesTheHandlerWithTheMerchantIdentified(t *testing.T) {
	h := newHarness(t)
	header := h.sign(h.secret, h.keyID, time.Now().UTC())

	rec := h.request(body, header)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if !h.called {
		t.Fatal("a genuinely signed request never reached the handler")
	}
}

// TestEveryRefusalIsTheSame401: the same enumeration-defence discipline
// `internal/redeem` applies to a voucher code applies to a forged signature
// — a prober must not be able to tell "no such key" from "bad MAC" apart
// from the response.
func TestEveryRefusalIsTheSame401(t *testing.T) {
	h := newHarness(t)

	unknownKey := h.request(body, h.sign(h.secret, "key_does_not_exist", time.Now().UTC()))
	badMAC := h.request(body, h.sign([]byte("the wrong secret entirely, 32byte"), h.keyID, time.Now().UTC()))

	if unknownKey.Code != badMAC.Code || unknownKey.Body.String() != badMAC.Body.String() {
		t.Errorf("an unknown key id and a bad MAC are distinguishable:\n  %d %q\n  %d %q",
			unknownKey.Code, unknownKey.Body.String(), badMAC.Code, badMAC.Body.String())
	}
}
