package api_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

// EM-19: a caller backdated `at` to pick up an older, cheaper rate. EM-11:
// the caller chose the demand multiplier. A quote is now priced at the
// ledger's clock at 1.00, and the database holds it to 15 minutes.
func TestAQuoteIsPricedAtTheLedgersClock(t *testing.T) {
	s := newServer(t)
	quote := func(extra map[string]any) (int, map[string]any) {
		body := map[string]any{"region": "ID", "currency": "IDR", "settlementMinor": 1_800}
		for k, v := range extra {
			body[k] = v
		}
		var out map[string]any
		return s.call("/pricing/quote", body, &out), out
	}

	for name, extra := range map[string]map[string]any{
		"backdated":         {"at": time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)},
		"future":            {"at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339)},
		"caller multiplier": {"demandMultiplierBps": 8_000},
	} {
		if code, _ := quote(extra); code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", name, code)
		}
	}

	code, out := quote(map[string]any{"at": time.Now().UTC().Format(time.RFC3339)})
	if code != http.StatusOK {
		t.Fatalf("a quote at the present: %d %v", code, out)
	}
	if out["demandMultiplierBps"] != float64(10_000) {
		t.Errorf("multiplier = %v, want 10000", out["demandMultiplierBps"])
	}
	expires, err := time.Parse(time.RFC3339Nano, out["expiresAt"].(string))
	if err != nil || time.Until(expires) > 15*time.Minute+5*time.Second {
		t.Errorf("expiresAt = %v (%v), want 15 minutes from now", out["expiresAt"], err)
	}

	// In the database: a raw quote that lives past 15 minutes is refused.
	_, err = s.owner.Exec(context.Background(), `INSERT INTO ledger.quote
		(id, region, currency, settlement_minor, price_points, backing_rate_id, expires_at)
		SELECT gen_random_uuid(), 'ID', 'IDR', 1800, 300, backing_rate_id, now() + interval '1 year'
		FROM ledger.quote WHERE id = $1`, out["quoteId"])
	if err == nil || !strings.Contains(err.Error(), "quote_lives_fifteen_minutes") {
		t.Errorf("a year-long quote was stored: %v", err)
	}
}

// 2.8.g: a listing's staff-set price is the quote when it is above the
// ledger's price, and ignored when it is below; never negative.
func TestAQuoteTakesAStaffPriceOnlyAboveTheLedgersPrice(t *testing.T) {
	s := newServer(t)
	quote := func(minPricePoints any) (int, int64) {
		body := map[string]any{"region": "ID", "currency": "IDR", "settlementMinor": 1_800}
		if minPricePoints != nil {
			body["minPricePoints"] = minPricePoints
		}
		var out struct {
			PricePoints int64 `json:"pricePoints"`
		}
		return s.call("/pricing/quote", body, &out), out.PricePoints
	}
	for name, tc := range map[string]struct {
		min  any
		want int64
	}{
		"none":  {nil, 300}, // IDR 1,800 at B = IDR 6
		"above": {400, 400},
		"below": {200, 300},
	} {
		if code, points := quote(tc.min); code != http.StatusOK || points != tc.want {
			t.Errorf("%s: %d, %d points, want 200 and %d", name, code, points, tc.want)
		}
	}
	if code, _ := quote(-1); code != http.StatusBadRequest {
		t.Errorf("a negative staff price: %d, want 400", code)
	}
}
