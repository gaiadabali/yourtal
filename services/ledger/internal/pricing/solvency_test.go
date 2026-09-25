package pricing_test

import (
	"context"
	"testing"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/reward"
)

// The solvency invariant (docs/09 §5), which §12 calls the thing most likely
// to fail quietly: insolvency by unfunded faucet, "discovered a year later".
//
// Split from engine_test.go to stay under docs/15 rule 6's 300 lines.

// docs/09 §5's trap, demonstrated end to end.
//
// A funded purchase moves cash into the reserve AND creates the allocation
// the points are issued from, so coverage holds. A marketing grant issues
// points with no cash behind them — and coverage must FALL. That is the
// whole reason the ratio is measured: the failure is silent, "discovered a
// year later", and nothing else in the system objects at the moment it
// happens.
func TestAnUnfundedFaucetDrivesCoverageDown(t *testing.T) {
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

	// A partner buys 1,000,000 points for AUD 10,000 — both facts recorded,
	// cash into the reserve.
	purchase, err := rewards.RecordPurchase(ctx, reward.PurchaseRequest{
		ID:          unique("pur"),
		PartnerID:   unique("partner"),
		Points:      1_000_000,
		AmountMinor: 4_500_000, // cents, at P_issue = 4.5 cents/point
		Currency:    testCurrency,
	})
	if err != nil {
		t.Fatalf("RecordPurchase: %v", err)
	}

	// A funded grant: points issued, drawn from the allocation the cash paid
	// for. Coverage after this is the baseline.
	user := unique("usr")
	if _, err := rewards.Grant(ctx, reward.GrantRequest{
		UserID: user, Action: reward.ActionWatchCompleted, ExternalRef: unique("watch"),
		Evidence: "checkpoint-token", AllocationID: purchase.AllocationID,
	}); err != nil {
		t.Fatalf("funded grant: %v", err)
	}

	funded, err := engine.Coverage(ctx, testCountry, at)
	if err != nil {
		t.Fatalf("Coverage (funded): %v", err)
	}
	if !funded.Healthy() {
		t.Fatalf("a fully funded plane is not solvent: %+v", funded)
	}

	// Now the trap: a marketing allocation with NO cash transfer behind it.
	// `CreateAllocation` deliberately has no money side — which is exactly
	// what makes it the unfunded faucet docs/09 §5 warns about, and why K6
	// requires a real transfer into the reserve at the moment of issuance.
	marketing := unique("alloc_marketing")
	if err := rewards.CreateAllocation(ctx, marketing, "marketing", "growth", 5_000_000); err != nil {
		t.Fatalf("CreateAllocation: %v", err)
	}

	for index := 0; index < 5; index++ {
		if _, err := rewards.Grant(ctx, reward.GrantRequest{
			UserID: unique("usr"), Action: reward.ActionReferralConfirmed,
			ExternalRef: unique("ref"), Evidence: "referral-code",
			AllocationID: marketing,
		}); err != nil {
			t.Fatalf("marketing grant %d: %v", index, err)
		}
	}

	unfunded, err := engine.Coverage(ctx, testCountry, at)
	if err != nil {
		t.Fatalf("Coverage (unfunded): %v", err)
	}

	if unfunded.PointsOutstanding <= funded.PointsOutstanding {
		t.Fatalf("points outstanding did not grow: %d then %d",
			funded.PointsOutstanding, unfunded.PointsOutstanding)
	}
	if unfunded.ReserveMinor != funded.ReserveMinor {
		t.Fatalf("the reserve moved for an unfunded grant: %d then %d",
			funded.ReserveMinor, unfunded.ReserveMinor)
	}
	if unfunded.RatioBps >= funded.RatioBps {
		t.Errorf("coverage did not fall after unfunded issuance: %d bps then %d bps",
			funded.RatioBps, unfunded.RatioBps)
	}
	if unfunded.LiabilityMinor <= funded.LiabilityMinor {
		t.Errorf("the liability did not grow with the points: %d then %d",
			funded.LiabilityMinor, unfunded.LiabilityMinor)
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
