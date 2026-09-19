package pricing_test

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/reward"
)

// Against the real Postgres from `pnpm dev:up`, for the same reason the
// reward engine's tests are: the parts that matter here are a uniqueness
// constraint, an effective-dated lookup and two aggregate projections, and
// none of them can be shown to work by a fake.
//
// The AU data plane is used throughout. Not arbitrary — every other Go test
// in this repo works in `ID`, so measuring coverage over `AU` means this
// suite is the only writer of the numbers it reads, and the coverage
// assertions can be about a delta this test caused rather than about
// whatever the database happened to be holding.
const ledgerURL = "postgres://yourtal_ledger:ledger_local_only@127.0.0.1:26432/yourtal"

const (
	testCountry  = "AU"
	testCurrency = "AUD"
	// B = 0.6 cents per point, P_issue = 1 cent per point. Plausible AU
	// figures, and deliberately NOT whole cents — the fractional case is the
	// one that forced micros in the first place.
	backingAUD = 600_000
	issueAUD   = 1_000_000
)

var counter atomic.Uint64

func unique(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano(), counter.Add(1))
}

func newEngine(t *testing.T) (*pricing.Engine, *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, ledgerURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("no local Postgres (run `pnpm dev:up`): %v", err)
	}
	t.Cleanup(pool.Close)

	return pricing.New(pool), pool
}

// withRate gives the AU plane a backing rate effective now, and returns the
// instant to price at.
func withRate(t *testing.T, engine *pricing.Engine) time.Time {
	t.Helper()
	at := time.Now().UTC()

	err := engine.SetRate(context.Background(), pricing.Rate{
		ID:                       unique("rate"),
		Currency:                 testCurrency,
		MicrosPerPoint:           backingAUD,
		IssuePriceMicrosPerPoint: issueAUD,
		EffectiveFrom:            at,
		Reason:                   "test fixture",
		SetBy:                    "pricing_test",
	})
	if err != nil {
		t.Fatalf("SetRate: %v", err)
	}
	return at
}

// The rate in force is the latest one effective at or before the instant —
// not the latest one written. Effective-dating is what makes announcing a
// devaluation possible (docs/09 §6 lever 3), and an implementation that
// quietly used "most recently inserted" would apply an announced change the
// moment it was scheduled rather than when it was promised.
func TestAFutureRateDoesNotPriceToday(t *testing.T) {
	engine, _ := newEngine(t)
	ctx := context.Background()
	now := withRate(t, engine)

	future := now.Add(90 * 24 * time.Hour)
	if err := engine.SetRate(ctx, pricing.Rate{
		ID:                       unique("rate"),
		Currency:                 testCurrency,
		MicrosPerPoint:           backingAUD / 2, // a devaluation, announced in advance
		IssuePriceMicrosPerPoint: issueAUD,
		EffectiveFrom:            future,
		Reason:                   "announced devaluation, effective in 90 days",
		SetBy:                    "pricing_test",
	}); err != nil {
		t.Fatalf("SetRate (future): %v", err)
	}

	today, err := engine.RateAt(ctx, testCurrency, now)
	if err != nil {
		t.Fatalf("RateAt (now): %v", err)
	}
	if today.MicrosPerPoint != backingAUD {
		t.Errorf("today priced at B=%d; the announced change should not apply yet",
			today.MicrosPerPoint)
	}

	later, err := engine.RateAt(ctx, testCurrency, future.Add(time.Second))
	if err != nil {
		t.Fatalf("RateAt (future): %v", err)
	}
	if later.MicrosPerPoint != backingAUD/2 {
		t.Errorf("after the effective date B is still %d", later.MicrosPerPoint)
	}
}

// docs/09 §4.1: B is ALWAYS less than P_issue, because the spread is the
// margin. Refused in Go so the caller gets a sentence, and refused again by
// the CHECK constraint so a psql session cannot do what the service will
// not — this asserts the Go half and `packages/db` asserts the other.
func TestABackingRateAtOrAboveTheIssuePriceIsRefused(t *testing.T) {
	engine, _ := newEngine(t)

	for _, backing := range []int64{issueAUD, issueAUD + 1} {
		err := engine.SetRate(context.Background(), pricing.Rate{
			ID:                       unique("rate"),
			Currency:                 testCurrency,
			MicrosPerPoint:           backing,
			IssuePriceMicrosPerPoint: issueAUD,
			EffectiveFrom:            time.Now().UTC(),
			Reason:                   "should never be written",
			SetBy:                    "pricing_test",
		})
		if !errors.Is(err, pricing.ErrRateNotBelowIssuePrice) {
			t.Errorf("B=%d against P_issue=%d was accepted: %v", backing, issueAUD, err)
		}
	}
}

// A rate change with no reason is a devaluation nobody can announce.
func TestARateChangeMustCarryItsReason(t *testing.T) {
	engine, _ := newEngine(t)

	err := engine.SetRate(context.Background(), pricing.Rate{
		ID:                       unique("rate"),
		Currency:                 testCurrency,
		MicrosPerPoint:           backingAUD,
		IssuePriceMicrosPerPoint: issueAUD,
		EffectiveFrom:            time.Now().UTC(),
		SetBy:                    "pricing_test",
	})
	if !errors.Is(err, pricing.ErrReasonRequired) {
		t.Errorf("a reasonless rate change was accepted: %v", err)
	}
}

// Pricing a currency with no rate refuses rather than defaulting. A default
// B would be a number nobody chose that the whole catalogue rests on.
func TestPricingWithoutARateIsRefused(t *testing.T) {
	engine, _ := newEngine(t)

	_, err := engine.Quote(context.Background(), "IDR", 50_000, pricing.NeutralDemandBps,
		time.Unix(0, 0).UTC())
	if !errors.Is(err, pricing.ErrNoRateInForce) {
		t.Errorf("expected a refusal before any rate existed, got %v", err)
	}
}

// A quote carries the rate that produced it, so a later reprice is
// attributable to a specific, reasoned change.
func TestAQuoteNamesTheRateItWasPricedAt(t *testing.T) {
	engine, _ := newEngine(t)
	at := withRate(t, engine)

	quote, err := engine.Quote(context.Background(), testCurrency, 3_000, pricing.NeutralDemandBps, at)
	if err != nil {
		t.Fatalf("Quote: %v", err)
	}

	// AUD 30.00 = 3000 cents, at 0.6 cents/point, is 5,000 points.
	if quote.PricePoints != 5_000 {
		t.Errorf("got %d points, want 5000", quote.PricePoints)
	}
	if quote.BackingRateID == "" || quote.BackingMicrosPerPoint != backingAUD {
		t.Errorf("the quote does not name its rate: %+v", quote)
	}
}

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

	rewards := reward.New(pool, ledger.New(pool), reward.AlwaysAllow{}, testCountry)
	if err := rewards.EnsureChart(ctx); err != nil {
		t.Fatalf("EnsureChart: %v", err)
	}

	// A partner buys 1,000,000 points for AUD 10,000 — both facts recorded,
	// cash into the reserve.
	purchase, err := rewards.RecordPurchase(ctx, reward.PurchaseRequest{
		ID:          unique("pur"),
		PartnerID:   unique("partner"),
		Points:      1_000_000,
		AmountMinor: 1_000_000, // cents, at P_issue = 1 cent/point
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
		Evidence: "checkpoint-token", AllocationID: purchase.AllocationID, Now: time.Now(),
	}); err != nil {
		t.Fatalf("funded grant: %v", err)
	}

	funded, err := engine.Coverage(ctx, testCountry, testCurrency, at)
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
			AllocationID: marketing, Now: time.Now(),
		}); err != nil {
			t.Fatalf("marketing grant %d: %v", index, err)
		}
	}

	unfunded, err := engine.Coverage(ctx, testCountry, testCurrency, at)
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
