package reward_test

import (
	"context"
	"errors"
	"testing"

	"github.com/yourtal/services/ledger/internal/ledgertest"
	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/reward"
)

// 14.13 (F122): a purchase by tier, priced in the purchase's own transaction.

func tierPurchase(tier string, points, amount int64) reward.PurchaseRequest {
	return reward.PurchaseRequest{ID: unique("pur"), PartnerID: unique("adv"), Points: points,
		AmountMinor: amount, Currency: "IDR", TierKey: tier}
}

func TestATierPurchaseIsPricedAtItsDiscount(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()

	// ID Grow: 10,000 points 5% off IDR 9 a point is IDR 85,500.
	if _, err := engine.RecordPurchase(ctx, tierPurchase("grow", 10_000, 85_499)); !errors.Is(err, reward.ErrUnderpriced) {
		t.Fatalf("a rupiah under the tier: err = %v, want ErrUnderpriced", err)
	}
	bought, err := engine.RecordPurchase(ctx, tierPurchase("grow", 10_000, 85_500))
	if err != nil {
		t.Fatalf("at the tier's price: %v", err)
	}
	if remaining, _ := engine.RemainingPoints(ctx, bought.AllocationID); remaining != 10_000 {
		t.Errorf("allocation = %d, want the tier's 10,000", remaining)
	}
	// The discount is the tier's: the same points untiered pay P_issue.
	untiered := tierPurchase("", 10_000, 85_500)
	if _, err := engine.RecordPurchase(ctx, untiered); !errors.Is(err, reward.ErrUnderpriced) {
		t.Errorf("untiered at the tier's price: err = %v, want ErrUnderpriced", err)
	}
}

func TestATierPurchaseIsTheTiersSizeAndAKnownTier(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()

	if _, err := engine.RecordPurchase(ctx, tierPurchase("scale", 1_000, 405_000)); !errors.Is(err, pricing.ErrTierPointsMismatch) {
		t.Errorf("1,000 points as Scale: err = %v, want ErrTierPointsMismatch", err)
	}
	if _, err := engine.RecordPurchase(ctx, tierPurchase("platinum", 1_000, 9_000)); !errors.Is(err, pricing.ErrUnknownTier) {
		t.Errorf("an unknown tier: err = %v, want ErrUnknownTier", err)
	}
}

func TestAPurchaseNeverSellsATierBelowB(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	// 40% off IDR 9 is IDR 5.4, under B = IDR 6; approved all the same.
	ledgertest.WithTiers(t, "ID", `[{"key": "deep", "points": 1000, "discountBps": 4000}]`)

	if _, err := engine.RecordPurchase(context.Background(), tierPurchase("deep", 1_000, 9_000)); !errors.Is(err, pricing.ErrTierBelowBacking) {
		t.Errorf("err = %v, want ErrTierBelowBacking", err)
	}
}
