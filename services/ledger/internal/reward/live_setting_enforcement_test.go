package reward_test

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/testdb"
)

// TASKS.md 10.4.e (F40, moved from 9.5.e): "an AU account is refused the
// grant that would take it past the new cap." 9.5.e already proved the
// SETTING half — Engine.Caps() reads platform.region_setting live, no
// WithCaps override. What was left is the ENFORCEMENT half: a live change,
// with no override anywhere, actually stops a grant through the real
// engine — RiskGate is real now (10.4.a), so this is the first test to
// exercise that path end to end rather than through WithCaps.
// auFundedAllocation is fundedAllocation for AU: that helper is hardcoded to
// IDR/ID (engine_test.go's own fixture region), and this test's subject is
// specifically the AU cap.
func auFundedAllocation(t *testing.T, engine *reward.Engine, points int64) string {
	t.Helper()
	packs := (points + 999) / 1_000
	result, err := engine.RecordPurchase(context.Background(), reward.PurchaseRequest{
		ID: unique("pur"), PartnerID: "adv_au", Points: packs * 1_000, AmountMinor: packs * 4_500, Currency: "AUD",
	})
	if err != nil {
		t.Fatalf("purchase: %v", err)
	}
	return result.AllocationID
}

func TestALiveDailyCapChangeIsWhatTheRealEngineEnforces(t *testing.T) {
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, testdb.URL(t, "LEDGER_DATABASE_URL"))
	if err != nil {
		t.Fatalf("connect as yourtal_ledger: %v", err)
	}
	defer pool.Close()
	owner, err := pgxpool.New(ctx, testdb.URL(t, "DATABASE_OWNER_URL"))
	if err != nil {
		t.Fatalf("connect as owner: %v", err)
	}
	// Not deferred: the revert below, registered with t.Cleanup so it runs
	// even if the test fails partway through, needs this pool still open —
	// deferred statements in THIS function would close it first.

	// AU's seeded default (1.2.f) is 500. 1.2.f's own table never edits an
	// approved row (region_setting_approval_rules) -- a change is always a
	// fresh propose-then-approve pair, by two different people, exactly
	// what /api/staff/economy/settings does. The engine below has NO
	// WithCaps override: whatever it enforces comes from whichever row this
	// leaves "current" (region_setting_current_idx: the newest approved one).
	var proposalID string
	if err := owner.QueryRow(ctx,
		`INSERT INTO platform.region_setting (region, key, value, set_by)
		   VALUES ('AU', 'daily_earn_cap', '120'::jsonb, 'risk_test_proposer')
		 RETURNING id`).Scan(&proposalID); err != nil {
		t.Fatalf("proposing the new cap: %v", err)
	}
	if _, err := owner.Exec(ctx,
		`UPDATE platform.region_setting SET approved_by = 'risk_test_approver' WHERE id = $1`,
		proposalID); err != nil {
		t.Fatalf("approving the new cap: %v", err)
	}
	// This table is process-wide, shared with every other package's tests
	// against the same `pnpm --filter @yourtal/ledger-service test` run
	// (settings_test.go's own AU=500 assertion, most directly) -- restore
	// the seeded default the same propose/approve way, not by resurrecting
	// the row this just superseded.
	t.Cleanup(func() {
		var revertID string
		if err := owner.QueryRow(ctx,
			`INSERT INTO platform.region_setting (region, key, value, set_by)
			   VALUES ('AU', 'daily_earn_cap', '500'::jsonb, 'risk_test_proposer_revert')
			 RETURNING id`).Scan(&revertID); err != nil {
			t.Fatalf("proposing the revert: %v", err)
		}
		if _, err := owner.Exec(ctx,
			`UPDATE platform.region_setting SET approved_by = 'risk_test_approver_revert' WHERE id = $1`,
			revertID); err != nil {
			t.Fatalf("approving the revert: %v", err)
		}
		owner.Close()
	})

	book := ledger.New(pool)
	engine := reward.New(pool, book, reward.AlwaysAllow{}, ledger.RegionAU)
	if err := engine.EnsureChart(ctx); err != nil {
		t.Fatalf("ensure chart: %v", err)
	}
	withF1Rates(t, pool)
	allocation := auFundedAllocation(t, engine, 10_000)
	user := unique("usr")

	// 60 points a grant (ActionQuickWatched's taxonomy price); the new cap
	// of 120 allows exactly two before the third is refused.
	for i := 0; i < 2; i++ {
		if _, err := engine.Grant(ctx, request(user, allocation, reward.ActionQuickWatched)); err != nil {
			t.Fatalf("grant %d under the new 120 cap: %v", i, err)
		}
	}
	if _, err := engine.Grant(ctx, request(user, allocation, reward.ActionQuickWatched)); !errors.Is(err, reward.ErrEarnCapReached) {
		t.Fatalf("a third grant past the live 120 cap: err = %v, want ErrEarnCapReached", err)
	}
}
