package pricing_test

import (
	"context"
	"errors"
	"testing"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/reward"
)

// The solvency invariant (docs/09 §5), which §12 calls the thing most likely
// to fail quietly: insolvency by unfunded faucet, "discovered a year later".
//
// Split from engine_test.go to stay under docs/15 rule 6's 300 lines.

// docs/09 §5's trap, and K6 closing it (4.4.h, EM-02).
//
// This test once asserted that a marketing grant with no cash behind it
// succeeds and drags coverage down: the unfunded faucet, "discovered a year
// later". K6 makes that grant impossible. With no marketing cash it is
// refused; once the platform funds marketing, each grant moves its backing
// into the reserve, so marketing points never dilute coverage.
func TestMarketingPointsCannotDiluteCoverage(t *testing.T) {
	engine, pool := newEngine(t)
	ctx := context.Background()
	at := withRate(t, engine)

	// Uncapped: the subject is coverage, and the taxonomy's 2,400-point watch
	// (removed in 4.4.a) is over the F12 daily cap.
	rewards := reward.New(pool, ledger.New(pool), reward.AlwaysAllow{}, testCountry).
		WithCaps(reward.Caps{DailyPoints: 1 << 40, MonthlyPoints: 1 << 40})
	if err := rewards.EnsureChart(ctx); err != nil {
		t.Fatalf("EnsureChart: %v", err)
	}
	purchase, err := rewards.RecordPurchase(ctx, reward.PurchaseRequest{
		ID: unique("pur"), PartnerID: unique("partner"), Points: 1_000_000,
		AmountMinor: 4_500_000, // cents, at P_issue = 4.5 cents/point
		Currency:    testCurrency,
	})
	if err != nil {
		t.Fatalf("RecordPurchase: %v", err)
	}
	if _, err := rewards.Grant(ctx, reward.GrantRequest{
		UserID: unique("usr"), Action: reward.ActionQuickWatched, ExternalRef: unique("watch"),
		Evidence: "checkpoint-token", AllocationID: purchase.AllocationID,
	}); err != nil {
		t.Fatalf("funded grant: %v", err)
	}
	baseline, err := engine.Coverage(ctx, testCountry, at)
	if err != nil {
		t.Fatal(err)
	}

	marketing := unique("alloc_marketing")
	if err := rewards.CreateAllocation(ctx, marketing, "marketing", "growth", 5_000_000); err != nil {
		t.Fatal(err)
	}
	referral := func() error {
		_, err := rewards.Grant(ctx, reward.GrantRequest{
			UserID: unique("usr"), Action: reward.ActionReferralConfirmed,
			ExternalRef: unique("ref"), Evidence: "referral-code", AllocationID: marketing,
		})
		return err
	}

	// Drain any marketing cash earlier tests funded: the point is "none".
	book := ledger.New(pool)
	cashID := ledger.PlatformAccountID(testCountry, ledger.RoleMarketingCash)
	if cash, _ := book.Balance(ctx, cashID); cash > 0 {
		if _, err := book.Transfer(ctx, ledger.TransferRequest{ID: unique("t"), IdempotencyKey: unique("k"),
			ReasonCode: "test_drain", Entries: ledger.Reverse(ledger.FundMarketing(testCountry, cash))}); err != nil {
			t.Fatal(err)
		}
	}
	if err := referral(); !errors.Is(err, ledger.ErrInsufficientFunds) {
		t.Fatalf("an unbacked marketing grant: err = %v, want ErrInsufficientFunds", err)
	}

	if _, err := rewards.FundMarketing(ctx, unique("fund"), 100_000, "alice", "bob"); err != nil {
		t.Fatal(err)
	}
	for i := range 5 {
		if err := referral(); err != nil {
			t.Fatalf("backed marketing grant %d: %v", i, err)
		}
	}
	after, err := engine.Coverage(ctx, testCountry, at)
	if err != nil {
		t.Fatal(err)
	}
	// 5 × 5,000 points at B = 3¢ is AUD 750.00 of backing into the reserve.
	if d := after.ReserveMinor - baseline.ReserveMinor; d != 75_000 {
		t.Errorf("the reserve moved by %d, want 75000", d)
	}
	if !after.Healthy() {
		t.Errorf("backed marketing points left the plane insolvent: %+v", after)
	}
}

// Zero points outstanding is reported as a distinct state, not as a ratio.
//
// Reported as a ratio it would be either infinite or zero, and zero reads as
// total insolvency — the most alarming possible false positive, arriving on
// the day before launch when nobody yet trusts the alert.
func TestNoPointsOutstandingIsNotAZeroRatio(t *testing.T) {
	empty := pricing.Coverage{NoPointsOutstanding: true}

	if !empty.Healthy() {
		t.Error("an economy that owes nothing is reported as insolvent")
	}
	if empty.ShouldAlert() {
		t.Error("an economy that owes nothing pages someone")
	}
}

// The two thresholds mean different things and must not collapse into one.
func TestTheCoverageThresholds(t *testing.T) {
	cases := []struct {
		name        string
		ratioBps    int64
		wantHealthy bool
		wantAlert   bool
	}{
		{"comfortable", 15_000, true, false},
		{"exactly at the alert line", pricing.CoverageAlertBps, true, false},
		{"below the alert line, still solvent", 11_999, true, true},
		{"exactly at the floor", pricing.CoverageFloorBps, true, true},
		{"insolvent", 9_999, false, true},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			coverage := pricing.Coverage{RatioBps: testCase.ratioBps, PointsOutstanding: 1}
			if coverage.Healthy() != testCase.wantHealthy {
				t.Errorf("Healthy() = %v at %d bps", coverage.Healthy(), testCase.ratioBps)
			}
			if coverage.ShouldAlert() != testCase.wantAlert {
				t.Errorf("ShouldAlert() = %v at %d bps", coverage.ShouldAlert(), testCase.ratioBps)
			}
		})
	}
}
