package api

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/yourtal/services/ledger/internal/httpx"
)

// These tests exercise only what does not require a live Postgres: the
// money-string codec, request validation, and the 501 handlers. The
// balance/quote happy paths are covered against a real database by
// internal/ledger and internal/pricing's own suites — duplicating them here
// with a fake pool would prove nothing extra and could pass while the real
// query does not (docs/13c: coverage is not the same fact as a load-bearing
// test).

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(bytesDiscard{}, nil))
}

type bytesDiscard struct{}

func (bytesDiscard) Write(p []byte) (int, error) { return len(p), nil }

func TestMoneyRoundTrip(t *testing.T) {
	cases := []int64{0, 1, -1, 123456789012345, -9223372036854775808, 9223372036854775807}
	for _, want := range cases {
		s := moneyString(want)
		got, err := parseMoney(s)
		if err != nil {
			t.Fatalf("parseMoney(%q): %v", s, err)
		}
		if got != want {
			t.Errorf("round trip: want %d, got %d", want, got)
		}
	}
}

func TestParseMoneyRejectsNonInteger(t *testing.T) {
	for _, bad := range []string{"", "1.5", "abc", "1e10", " 1"} {
		if _, err := parseMoney(bad); err == nil {
			t.Errorf("parseMoney(%q): expected an error, got none", bad)
		}
	}
}

func TestGetBalanceRejectsMissingAccountID(t *testing.T) {
	a := New(discardLogger(), nil, nil)
	r := httptest.NewRequest(http.MethodGet, "/accounts//balance", nil)
	w := httptest.NewRecorder()

	// chi.URLParam returns "" when the router did not populate it, which is
	// exactly what a direct handler call (no router) simulates.
	a.getBalance(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
	var body httpx.ErrorEnvelope
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decoding error envelope: %v", err)
	}
	if body.Error.Code != "missing_account_id" {
		t.Errorf("error code = %q, want missing_account_id", body.Error.Code)
	}
}

func TestPostPricingQuoteRejectsMalformedJSON(t *testing.T) {
	a := New(discardLogger(), nil, nil)
	r := httptest.NewRequest(http.MethodPost, "/pricing/quote", bytes.NewBufferString("{not json"))
	w := httptest.NewRecorder()

	a.postPricingQuote(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestPostPricingQuoteRejectsMissingCurrency(t *testing.T) {
	a := New(discardLogger(), nil, nil)
	body, _ := json.Marshal(quoteRequest{SettlementMinor: "100", DemandMultiplierBps: 10_000})
	r := httptest.NewRequest(http.MethodPost, "/pricing/quote", bytes.NewReader(body))
	w := httptest.NewRecorder()

	a.postPricingQuote(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

func TestPostPricingQuoteRejectsBadSettlement(t *testing.T) {
	a := New(discardLogger(), nil, nil)
	body, _ := json.Marshal(quoteRequest{
		Currency: "IDR", SettlementMinor: "not-a-number", DemandMultiplierBps: 10_000,
	})
	r := httptest.NewRequest(http.MethodPost, "/pricing/quote", bytes.NewReader(body))
	w := httptest.NewRecorder()

	a.postPricingQuote(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusBadRequest)
	}
}

// TestMoneyNeverJSONNumbers is the assertion that matters most in this
// package: an amount must serialise as a JSON string, never a bare number,
// or a float64 client silently rounds it. It is written against the actual
// encoding/json output rather than against moneyString's return type, so it
// would catch a future response struct that adds an amount as int64 by
// mistake — the type checker would not.
func TestMoneyNeverJSONNumbers(t *testing.T) {
	resp := balanceResponse{AccountID: "acct_1", BalanceMinor: moneyString(9_007_199_254_740_993)}
	encoded, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !bytes.Contains(encoded, []byte(`"balance_minor":"9007199254740993"`)) {
		t.Errorf("balance_minor was not encoded as a quoted string: %s", encoded)
	}
}

// TestQuoteResponseNeverCarriesBackingRate is the assertion that matters
// most in this file. infra/postgres/init/01-schemas.sql revokes yourtal_app
// entirely from the `ledger` schema specifically so no caller outside this
// service can compute a points price itself (YT-0130); a response type that
// serialises B would undo that by a different door. Written against the
// actual JSON output, not the struct definition, so it would catch a future
// field added back by name (`backing_micros_per_point`) or under a
// different one — anything that would let a client recover B.
func TestQuoteResponseNeverCarriesBackingRate(t *testing.T) {
	resp := quoteResponse{
		PricePoints:         "2000",
		SettlementMinor:     "12000",
		BackingRateID:       "rate_1",
		DemandMultiplierBps: 10_000,
	}
	encoded, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, forbidden := range []string{"micros", "backing_rate\":", "\"b\":", "rate_value"} {
		if bytes.Contains(bytes.ToLower(encoded), []byte(forbidden)) {
			t.Errorf("quote response leaks the backing rate: field matching %q present in %s", forbidden, encoded)
		}
	}
	// The one thing it MAY carry: an opaque id for audit correlation, never
	// the rate's value.
	if !bytes.Contains(encoded, []byte(`"backing_rate_id":"rate_1"`)) {
		t.Errorf("expected the opaque backing_rate_id to survive: %s", encoded)
	}
}

// TestAllFourRoutesAre501 exercises the real router, not the handlers
// directly, so it would catch a route accidentally wired to a live handler
// — the mistake this file corrects. Every route this service exposes must
// return 501 until authentication exists; there is currently no exception,
// including the reads.
func TestAllFourRoutesAre501(t *testing.T) {
	a := New(discardLogger(), nil, nil)
	router := a.Routes()

	requests := []*http.Request{
		httptest.NewRequest(http.MethodGet, "/accounts/acct_1/balance", nil),
		httptest.NewRequest(http.MethodPost, "/pricing/quote", bytes.NewBufferString(`{}`)),
		httptest.NewRequest(http.MethodPost, "/transfers", nil),
		httptest.NewRequest(http.MethodPost, "/rewards/grants", nil),
	}

	for _, r := range requests {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != http.StatusNotImplemented {
			t.Errorf("%s %s: status = %d, want %d (every route must be gated)",
				r.Method, r.URL.Path, w.Code, http.StatusNotImplemented)
		}
	}
}

// TestNotYetExposedNamesItsBlocker guards the report obligation directly:
// the 501 body must say what it is waiting for, not just that it is
// unavailable, per the pattern services/voucher/cmd/voucher/main.go set.
func TestNotYetExposedNamesItsBlocker(t *testing.T) {
	a := New(discardLogger(), nil, nil)
	handler := a.notYetExposed("waiting on authentication and idempotency")

	r := httptest.NewRequest(http.MethodPost, "/transfers", nil)
	w := httptest.NewRecorder()
	handler(w, r)

	if w.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusNotImplemented)
	}
	var body httpx.ErrorEnvelope
	if err := json.NewDecoder(w.Body).Decode(&body); err != nil {
		t.Fatalf("decoding error envelope: %v", err)
	}
	if body.Error.Code != "not_exposed" {
		t.Errorf("error code = %q, want not_exposed", body.Error.Code)
	}
	if !bytes.Contains([]byte(body.Error.Message), []byte("authentication")) {
		t.Errorf("501 message does not name its blocker: %q", body.Error.Message)
	}
}
