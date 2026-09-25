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

// The ledger-internal contract's grants (4.1.b) and holdback (4.4.g).

// campaignPaidBy gives a seeded campaign a reward config paying up to
// perCompletion + bonus from allocation. As the owner: the studio (C) writes
// reward configs, the ledger only reads them.
func campaignPaidBy(t *testing.T, allocation string, perCompletion, bonus int64) string {
	t.Helper()
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, testdb.URL(t, "DATABASE_OWNER_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()
	var campaign string
	if err := owner.QueryRow(ctx, `SELECT c.id::text FROM campaign.campaigns c
		LEFT JOIN campaign.reward_config r ON r.campaign_id = c.id
		WHERE r.campaign_id IS NULL ORDER BY c.id LIMIT 1`).Scan(&campaign); err != nil {
		t.Skipf("no seeded campaign without a reward config: %v", err)
	}
	if _, err := owner.Exec(ctx, `INSERT INTO campaign.reward_config
		(campaign_id, allocation_id, funder_type, max_points_for_campaign, reward_points_per_completion, accuracy_bonus_points)
		VALUES ($1, $2, 'partner', 1000000, $3, $4)`, campaign, allocation, perCompletion, bonus); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, err := pgxpool.New(context.Background(), testdb.URL(t, "DATABASE_OWNER_URL"))
		if err == nil {
			_, _ = cleanup.Exec(context.Background(), `DELETE FROM campaign.reward_config WHERE campaign_id = $1`, campaign)
			cleanup.Close()
		}
	})
	return campaign
}


func freshUser() string {
	// A fresh uuid per test: the contract's userId is a uuid.
	n := time.Now().UnixNano()
	return "0b0e2a8c-6a7e-4b8e-9a51-" + leftPad(n%1_000_000_000_000)
}

func leftPad(n int64) string {
	s := make([]byte, 12)
	for i := 11; i >= 0; i-- {
		s[i] = byte('0' + n%10)
		n /= 10
	}
	return string(s)
}

func TestGrantRewardPaysOncePerCampaignAndReplays(t *testing.T) {
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()
	campaign := campaignPaidBy(t, fundedAllocation(t, engine, 10_000), 100, 25)
	user := freshUser()

	req := reward.RewardRequest{CampaignID: campaign, UserID: user, Points: 110, TrustTier: 1, IdempotencyKey: "k1"}
	first, err := engine.GrantReward(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	// Tier 1 holds back 48 hours.
	if hold := time.Until(first.UnlockAt); hold < 47*time.Hour || hold > 49*time.Hour {
		t.Errorf("unlock in %s, want about 48h", hold)
	}
	if replay, err := engine.GrantReward(ctx, req); err != nil || replay.GrantID != first.GrantID {
		t.Fatalf("a replay: %+v, %v", replay, err)
	}
	changed := req
	changed.Points = 120
	if _, err := engine.GrantReward(ctx, changed); !errors.Is(err, ledger.ErrIdempotencyConflict) {
		t.Errorf("same key, other points: %v", err)
	}
	second := req
	second.IdempotencyKey = "k2"
	if _, err := engine.GrantReward(ctx, second); !errors.Is(err, reward.ErrAlreadyGranted) {
		t.Errorf("a second session on the campaign: %v", err)
	}
	over := reward.RewardRequest{CampaignID: campaign, UserID: freshUser(), Points: 126, TrustTier: 1, IdempotencyKey: "k3"}
	if _, err := engine.GrantReward(ctx, over); !errors.Is(err, reward.ErrOverCampaignMax) {
		t.Errorf("126 against a 100 + 25 maximum: %v", err)
	}
	if b, _ := ledger.New(pool).Balance(ctx, ledger.UserAccountID(user, ledger.PurposePending)); b != 110 {
		t.Errorf("pending = %d, want 110", b)
	}
}

// Tier 3 (demo viewers) is spendable at once; other tiers are released by
// ReleaseDue once their holdback passes.
func TestHoldbackReleasesByTier(t *testing.T) {
	engine, pool := newEngine(t, reward.AlwaysAllow{})
	ctx := context.Background()
	book := ledger.New(pool)
	campaign := campaignPaidBy(t, fundedAllocation(t, engine, 10_000), 100, 0)

	demo := freshUser()
	if _, err := engine.GrantReward(ctx, reward.RewardRequest{CampaignID: campaign, UserID: demo, Points: 100,
		TrustTier: 3, IdempotencyKey: "demo"}); err != nil {
		t.Fatal(err)
	}
	if b, _ := book.Balance(ctx, ledger.UserAccountID(demo, ledger.PurposeAvailable)); b != 100 {
		t.Errorf("tier 3 available = %d, want 100 at once", b)
	}

	fresh := freshUser()
	granted, err := engine.GrantReward(ctx, reward.RewardRequest{CampaignID: campaign, UserID: fresh, Points: 100,
		TrustTier: 0, IdempotencyKey: "fresh"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := reward.ReleaseDue(ctx, pool, book, 100); err != nil {
		t.Fatal(err)
	}
	if b, _ := book.Balance(ctx, ledger.UserAccountID(fresh, ledger.PurposeAvailable)); b != 0 {
		t.Fatalf("a tier 0 grant was released before its 72 hours: %d", b)
	}
	// Age the grant past its unlock time, as the owner.
	owner, err := pgxpool.New(ctx, testdb.URL(t, "DATABASE_OWNER_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()
	if _, err := owner.Exec(ctx, `UPDATE ledger.grant SET unlock_at = now() - interval '1 minute' WHERE id = $1`, granted.GrantID); err != nil {
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
