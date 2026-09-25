package pricing_test

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/testdb"
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

	pool, err := pgxpool.New(ctx, testdb.URL(t, "LEDGER_DATABASE_URL"))
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
