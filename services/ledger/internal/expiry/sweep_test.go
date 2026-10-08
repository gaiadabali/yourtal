package expiry_test

import (
	"context"
	"errors"
	"testing"

	"github.com/yourtal/services/ledger/internal/expiry"
	"github.com/yourtal/services/ledger/internal/ledger"
)

// 13.3.h: the scheduler visits a region only while its points_expiry is on.
func TestSweepRegionsSkipsARegionWhereExpiryIsOff(t *testing.T) {
	var ran []ledger.Region
	results, err := expiry.SweepRegions(context.Background(),
		func(_ context.Context, region ledger.Region) (bool, error) { return region == ledger.RegionID, nil },
		func(_ context.Context, region ledger.Region) (expiry.Result, error) {
			ran = append(ran, region)
			return expiry.Result{Expired: 2}, nil
		},
	)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if len(ran) != 1 || ran[0] != ledger.RegionID {
		t.Errorf("swept %v, want only ID", ran)
	}
	if results[ledger.RegionID].Expired != 2 {
		t.Errorf("results = %+v, want ID's tally", results)
	}
	if _, swept := results[ledger.RegionAU]; swept {
		t.Error("AU has a result though its expiry is off")
	}
}

func TestSweepRegionsRunsNothingWhileBothAreOff(t *testing.T) {
	results, err := expiry.SweepRegions(context.Background(),
		func(context.Context, ledger.Region) (bool, error) { return false, nil },
		func(context.Context, ledger.Region) (expiry.Result, error) {
			t.Error("run was called while expiry is off everywhere")
			return expiry.Result{}, nil
		},
	)
	if err != nil || len(results) != 0 {
		t.Errorf("results = %+v, err = %v, want an inert sweep", results, err)
	}
}

// One region's failure (an unreadable setting, a failed run) must not stop the other.
func TestSweepRegionsKeepsGoingAfterARegionFails(t *testing.T) {
	boom := errors.New("boom")
	var ran []ledger.Region
	_, err := expiry.SweepRegions(context.Background(),
		func(_ context.Context, region ledger.Region) (bool, error) {
			if region == ledger.RegionAU {
				return false, boom
			}
			return true, nil
		},
		func(_ context.Context, region ledger.Region) (expiry.Result, error) {
			ran = append(ran, region)
			return expiry.Result{}, nil
		},
	)
	if !errors.Is(err, boom) {
		t.Errorf("err = %v, want it to wrap the failure", err)
	}
	if len(ran) != 1 || ran[0] != ledger.RegionID {
		t.Errorf("swept %v, want ID still swept after AU failed", ran)
	}
}

// Needs Postgres (skips without one): the scheduler's entry point expires
// through the real setting, and a second tick over the same snapshot posts
// nothing more.
func TestSweepExpiresAnInactiveAccountWhereExpiryIsOnAndIsIdempotent(t *testing.T) {
	pool, engine, _ := setup(t)
	setPointsExpiry(t, "ID", `{"enabled": true, "inactivityMonths": 12}`)
	allocation := fundedAllocation(t, engine, 10_000)
	user := grantAndClockShift(t, pool, engine, allocation, 13)

	ctx := context.Background()
	book := ledger.New(pool)
	results, err := expiry.Sweep(ctx, pool, book, 1000)
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if results[ledger.RegionID].Expired < 1 {
		t.Errorf("results = %+v, want ID swept with at least one expiry", results)
	}
	balance, err := book.Balance(ctx, ledger.UserAccountID(user, ledger.PurposeAvailable))
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if balance != 0 {
		t.Errorf("available = %d, want 0 after the sweep", balance)
	}

	again, err := expiry.Sweep(ctx, pool, book, 1000)
	if err != nil {
		t.Fatalf("second sweep: %v", err)
	}
	if again[ledger.RegionID].Expired != 0 {
		t.Errorf("a second sweep expired %d more accounts, want 0", again[ledger.RegionID].Expired)
	}
}
