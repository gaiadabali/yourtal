package reward_test

import (
	"context"
	"testing"

	"github.com/yourtal/services/ledger/internal/escrow"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// 4.4.g: holdback release skips a user with a held escrow. Their pending
// stays pending, with its unlock time, and unlocks once the escrow ends.
func TestHoldbackReleaseSkipsEscrowedUsers(t *testing.T) {
	engine, pool := rewardEngine(t)
	ctx := context.Background()
	book := ledger.New(pool)
	campaign := newLiveCampaign(t, engine, 100, 0, 1_000_000)
	balance := func(user string, purpose ledger.Purpose) int64 {
		t.Helper()
		b, err := book.Balance(ctx, ledger.UserAccountID(user, purpose))
		if err != nil {
			t.Fatal(err)
		}
		return b
	}

	user := freshUser()
	granted, err := engine.GrantReward(ctx, campaign.reward(user, 100, 0, 0, 0))
	if err != nil {
		t.Fatal(err)
	}
	held, err := escrow.New(pool, book).Hold(ctx, escrow.Request{UserID: user, Points: 30, Reason: "suspended"})
	if err != nil {
		t.Fatal(err)
	}
	if held.PendingPoints != 30 {
		t.Fatalf("escrow took %d from pending, want 30", held.PendingPoints)
	}
	if _, err := ownerPool(t).Exec(ctx, `UPDATE ledger.grant SET unlock_at = now() - interval '1 minute' WHERE id = $1`, granted.GrantID); err != nil {
		t.Fatal(err)
	}
	if _, err := reward.ReleaseDue(ctx, pool, book, 100); err != nil {
		t.Fatal(err)
	}
	if a, p := balance(user, ledger.PurposeAvailable), balance(user, ledger.PurposePending); a != 0 || p != 70 {
		t.Fatalf("while escrowed: available %d, pending %d; want 0 and 70", a, p)
	}
	buckets, err := sqlcgen.New(pool).PendingBuckets(ctx, user)
	if err != nil || len(buckets) != 1 {
		t.Fatalf("the grant left pending while escrowed: %v %v", buckets, err)
	}

	if _, err := escrow.New(pool, book).Release(ctx, held.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := reward.ReleaseDue(ctx, pool, book, 100); err != nil {
		t.Fatal(err)
	}
	if a, p := balance(user, ledger.PurposeAvailable), balance(user, ledger.PurposePending); a != 100 || p != 0 {
		t.Fatalf("after the escrow: available %d, pending %d; want 100 and 0", a, p)
	}
}
