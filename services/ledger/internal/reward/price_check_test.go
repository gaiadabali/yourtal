package reward_test

import (
	"context"
	"errors"
	"testing"

	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/reward"
)

// 4.4.i: RecordPurchase never checked the price paid against P_issue, so a
// caller could record 1,000 points for IDR 1.
func TestAnUnderpricedPurchaseIsRefused(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()

	if _, err := engine.RecordPurchase(ctx, purchase(unique("pur"), unique("adv"), 1_000, 8_999)); !errors.Is(err, reward.ErrUnderpriced) {
		t.Fatalf("1,000 pts for IDR 8,999 at P_issue IDR 9: err = %v, want ErrUnderpriced", err)
	}
	if _, err := engine.RecordPurchase(ctx, purchase(unique("pur"), unique("adv"), 1_000, 9_000)); err != nil {
		t.Fatalf("1,000 pts at exactly P_issue: %v", err)
	}
}

func TestPurchasesComeInPacks(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	if _, err := engine.RecordPurchase(context.Background(), purchase(unique("pur"), unique("adv"), 1_500, 90_000)); !errors.Is(err, pricing.ErrNotAPack) {
		t.Fatalf("1,500 pts: err = %v, want ErrNotAPack", err)
	}
}
