package pricing_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
)

// 4.4.i, EM-11: the CHECK only enforced B < P_issue, but the 0.80 demand
// floor needs B ≤ 0.8 × P_issue, or a discounted voucher sells below cost.
// The rule is B × 1.25 ≤ P_issue, in Go and in the database.
func TestTheSpreadCoversTheDemandFloor(t *testing.T) {
	engine, pool := newEngine(t)
	rate := func(backing int64) pricing.Rate {
		return pricing.Rate{ID: unique("rate"), Currency: testCurrency, MicrosPerPoint: backing,
			IssuePriceMicrosPerPoint: 1_000_000, EffectiveFrom: time.Now().UTC().Add(time.Hour),
			Reason: "margin test", SetBy: "pricing_test"}
	}
	if err := engine.ProposeRate(context.Background(), rate(800_000)); err != nil {
		t.Fatalf("B = 0.8 × P_issue was refused: %v", err)
	}
	if err := engine.ProposeRate(context.Background(), rate(800_001)); !errors.Is(err, pricing.ErrMarginTooThin) {
		t.Fatalf("B above 0.8 × P_issue: err = %v, want ErrMarginTooThin", err)
	}
	_, err := pool.Exec(context.Background(), `INSERT INTO ledger.backing_rate
		(id, currency, micros_per_point, issue_price_micros_per_point, effective_from, reason, set_by)
		VALUES ($1, 'AUD', 900000, 1000000, now() + interval '2 hours', 'raw', 'test')`, unique("rate"))
	if err == nil || !strings.Contains(err.Error(), "backing_rate_margin") {
		t.Fatalf("the database took a thin margin: %v", err)
	}
}

// F12: points are sold in packs of 1,000, and the server sets the charge.
func TestQuotePurchaseSellsPacksAtTheIssuePrice(t *testing.T) {
	engine, _ := newEngine(t)
	inForce(t, engine, pricing.Rate{ID: unique("rate"), Currency: "IDR",
		MicrosPerPoint: 6_000_000, IssuePriceMicrosPerPoint: 9_000_000, Reason: "F1", SetBy: "pricing_test"})
	quote, err := engine.QuotePurchase(context.Background(), ledger.RegionID, 3_000)
	if err != nil {
		t.Fatal(err)
	}
	if quote.AmountMinor != 27_000 || quote.Currency != "IDR" {
		t.Errorf("3,000 pts in ID = %d %s, want 27000 IDR", quote.AmountMinor, quote.Currency)
	}
	if _, err := engine.QuotePurchase(context.Background(), ledger.RegionID, 1_500); !errors.Is(err, pricing.ErrNotAPack) {
		t.Errorf("1,500 pts: err = %v, want ErrNotAPack", err)
	}
}
