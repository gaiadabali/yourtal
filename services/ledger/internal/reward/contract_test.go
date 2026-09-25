package reward_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/testdb"
)

// The ledger-internal contract's grants (4.1.b), campaign rewards on frozen
// terms and attested completions (4.4.a-d), and holdback (4.4.g).

func freshUser() string {
	n := time.Now().UnixNano() + int64(counter.Add(1))
	s := make([]byte, 12)
	for i := 11; i >= 0; i-- {
		s[i] = byte('0' + n%10)
		n /= 10
	}
	return "0b0e2a8c-6a7e-4b8e-9a51-" + string(s)
}

func rewardEngine(t *testing.T) (*reward.Engine, *pgxpool.Pool) {
	t.Helper()
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	return engine.WithAttestationSecret(attestationSecret), pool
}

func ownerPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	owner, err := pgxpool.New(context.Background(), testdb.URL(t, "DATABASE_OWNER_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	return owner
}

func TestGrantRewardPaysTheTermsOncePerCampaignAndReplays(t *testing.T) {
	engine, pool := rewardEngine(t)
	ctx := context.Background()
	campaign := newLiveCampaign(t, engine, 100, 40, 1_000_000)
	user := freshUser()

	// 4.4.b: 100 + floor(40 × 2 ÷ 3) = 126.
	req := campaign.reward(user, 126, 3, 2, 1)
	first, err := engine.GrantReward(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	if hold := time.Until(first.UnlockAt); hold < 47*time.Hour || hold > 49*time.Hour {
		t.Errorf("tier 1 unlocks in %s, want about 48h", hold)
	}
	if replay, err := engine.GrantReward(ctx, req); err != nil || replay.GrantID != first.GrantID {
		t.Fatalf("a replay: %+v, %v", replay, err)
	}
	// 4.4.j: a second session on the same campaign earns nothing.
	if _, err := engine.GrantReward(ctx, campaign.reward(user, 126, 3, 2, 1)); !errors.Is(err, reward.ErrAlreadyGranted) {
		t.Errorf("a second session: %v", err)
	}
	if b, _ := ledger.New(pool).Balance(ctx, ledger.UserAccountID(user, ledger.PurposePending)); b != 126 {
		t.Errorf("pending = %d, want 126", b)
	}
}

// EM-05/EM-16/EW-05: the caller never sets the amount; the terms do.
func TestTheTermsNotTheCallerSetTheAmount(t *testing.T) {
	engine, _ := rewardEngine(t)
	campaign := newLiveCampaign(t, engine, 100, 40, 1_000_000)
	if _, err := engine.GrantReward(context.Background(), campaign.reward(freshUser(), 2_400, 3, 3, 3)); !errors.Is(err, reward.ErrPointsMismatch) {
		t.Fatalf("2,400 asked against terms paying 140: %v", err)
	}
}

// EW-12: only a completion apps/api signed pays.
func TestAnUnattestedCompletionIsNotPaid(t *testing.T) {
	engine, _ := rewardEngine(t)
	campaign := newLiveCampaign(t, engine, 100, 0, 1_000_000)
	req := campaign.reward(freshUser(), 100, 0, 0, 3)
	req.Completion.Asked = 1 // changed after signing
	if _, err := engine.GrantReward(context.Background(), req); !errors.Is(err, reward.ErrAttestation) {
		t.Fatalf("a tampered attestation: %v", err)
	}
}

func TestAPausedCampaignPaysNothing(t *testing.T) {
	engine, _ := rewardEngine(t)
	ctx := context.Background()
	campaign := newLiveCampaign(t, engine, 100, 0, 1_000_000)
	if _, err := ownerPool(t).Exec(ctx, `UPDATE campaign.campaigns SET lifecycle_state = 'paused' WHERE id = $1`, campaign.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.GrantReward(ctx, campaign.reward(freshUser(), 100, 0, 0, 3)); !errors.Is(err, reward.ErrCampaignNotLive) {
		t.Fatalf("a paused campaign: %v", err)
	}
}

// 4.4.j: a campaign pointed at another business's allocation is refused.
func TestACampaignCannotSpendAnotherBusinessesAllocation(t *testing.T) {
	engine, _ := rewardEngine(t)
	ctx := context.Background()
	campaign := newLiveCampaign(t, engine, 100, 0, 1_000_000)
	stranger := fundedAllocation(t, engine, 10_000) // bought by "adv_1"
	if _, err := ownerPool(t).Exec(ctx, `UPDATE campaign.reward_config SET allocation_id = $2 WHERE campaign_id = $1`, campaign.ID, stranger); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.GrantReward(ctx, campaign.reward(freshUser(), 100, 0, 0, 3)); !errors.Is(err, reward.ErrWrongFunder) {
		t.Fatalf("another business's allocation: %v", err)
	}
}

// The bonus counts toward the campaign's maximum.
func TestTheCampaignMaximumHolds(t *testing.T) {
	engine, _ := rewardEngine(t)
	ctx := context.Background()
	campaign := newLiveCampaign(t, engine, 100, 0, 250)
	for i := range 2 {
		if _, err := engine.GrantReward(ctx, campaign.reward(freshUser(), 100, 0, 0, 3)); err != nil {
			t.Fatalf("viewer %d: %v", i, err)
		}
	}
	if _, err := engine.GrantReward(ctx, campaign.reward(freshUser(), 100, 0, 0, 3)); !errors.Is(err, reward.ErrOverCampaignMax) {
		t.Fatalf("300 of a 250 maximum: %v", err)
	}
}

// Tier 3 (demo viewers) is spendable at once; other tiers are released by
// ReleaseDue once their holdback passes.
func TestHoldbackReleasesByTier(t *testing.T) {
	engine, pool := rewardEngine(t)
	ctx := context.Background()
	book := ledger.New(pool)
	campaign := newLiveCampaign(t, engine, 100, 0, 1_000_000)

	demo := freshUser()
	if _, err := engine.GrantReward(ctx, campaign.reward(demo, 100, 0, 0, 3)); err != nil {
		t.Fatal(err)
	}
	if b, _ := book.Balance(ctx, ledger.UserAccountID(demo, ledger.PurposeAvailable)); b != 100 {
		t.Errorf("tier 3 available = %d, want 100 at once", b)
	}

	fresh := freshUser()
	granted, err := engine.GrantReward(ctx, campaign.reward(fresh, 100, 0, 0, 0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reward.ReleaseDue(ctx, pool, book, 100); err != nil {
		t.Fatal(err)
	}
	if b, _ := book.Balance(ctx, ledger.UserAccountID(fresh, ledger.PurposeAvailable)); b != 0 {
		t.Fatalf("a tier 0 grant was released before its 72 hours: %d", b)
	}
	if _, err := ownerPool(t).Exec(ctx, `UPDATE ledger.grant SET unlock_at = now() - interval '1 minute' WHERE id = $1`, granted.GrantID); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if _, err := reward.ReleaseDue(ctx, pool, book, 100); err != nil {
			t.Fatal(err)
		}
	}
	if b, _ := book.Balance(ctx, ledger.UserAccountID(fresh, ledger.PurposeAvailable)); b != 100 {
		t.Errorf("after the holdback available = %d, want 100 exactly once", b)
	}
}

func TestGrantActionIsMarketingFundedAndBacked(t *testing.T) {
	_, pool := newEngine(t, reward.AlwaysAllow{})
	engine := reward.New(pool, ledger.New(pool), reward.AlwaysAllow{}, ledger.RegionID)
	ctx := context.Background()
	if _, err := engine.FundMarketing(ctx, unique("fund"), 1_000_000, "alice", "bob"); err != nil {
		t.Fatal(err)
	}
	user := freshUser()
	for _, kind := range []string{"streak", "receipt", "goodwill"} {
		if _, err := engine.GrantAction(ctx, reward.ActionRequest{Kind: kind, UserID: user, Points: 60,
			TrustTier: 3, IdempotencyKey: kind + "-1"}); err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
	}
	if b, _ := ledger.New(pool).Balance(ctx, ledger.UserAccountID(user, ledger.PurposeAvailable)); b != 180 {
		t.Errorf("available = %d, want 180", b)
	}
}
