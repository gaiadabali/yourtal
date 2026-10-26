package reward_test

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/reward"
)

// ReleaseDue had no caller, so a grant past its holdback stayed pending for ever.
// The loop is what moves it, with nobody asking: an overdue grant becomes
// available exactly once, even with two loops racing (a redeploy overlaps the old
// and new ledger), and a grant still inside its holdback is left alone.
func TestRunReleaserReleasesAnOverdueGrantOnceWithoutBeingAsked(t *testing.T) {
	engine, pool := rewardEngine(t)
	owner := ownerPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	book := ledger.New(pool)
	campaign := newLiveCampaign(t, engine, 100, 0, 1_000_000)

	overdue, waiting := freshUser(), freshUser()
	late, err := engine.GrantReward(ctx, campaign.reward(overdue, 100, 0, 0, 0))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := engine.GrantReward(ctx, campaign.reward(waiting, 100, 0, 0, 0)); err != nil {
		t.Fatal(err)
	}
	// Demo data and a stalled job both look like this: an unlock date in the past.
	if _, err := owner.Exec(ctx,
		`UPDATE ledger.grant SET unlock_at = now() - interval '16 days' WHERE id = $1`, late.GrantID); err != nil {
		t.Fatal(err)
	}
	// The release moves points between the user's own accounts only, so the
	// cash that backed the grant at issue (K6) must not move at all.
	cashBefore := cashTotals(t, owner)

	loopCtx, stop := context.WithCancel(ctx)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			reward.RunReleaser(loopCtx, pool, ledger.New(pool), 10*time.Millisecond, 100, func(int, error) {})
		}()
	}
	stopped := false
	stopLoops := func() {
		if !stopped {
			stop()
			wg.Wait() // RunReleaser returns once its context ends
			stopped = true
		}
	}
	defer stopLoops()

	balance := func(user string, purpose ledger.Purpose) int64 {
		b, _ := book.Balance(ctx, ledger.UserAccountID(user, purpose))
		return b
	}
	for deadline := time.Now().Add(10 * time.Second); balance(overdue, ledger.PurposeAvailable) != 100; {
		if time.Now().After(deadline) {
			t.Fatalf("the overdue grant was never released: available = %d", balance(overdue, ledger.PurposeAvailable))
		}
		time.Sleep(20 * time.Millisecond)
	}
	time.Sleep(150 * time.Millisecond) // many more passes of both loops
	stopLoops()

	if got := balance(overdue, ledger.PurposeAvailable); got != 100 {
		t.Errorf("overdue available = %d, want 100 exactly once", got)
	}
	if got := balance(overdue, ledger.PurposePending); got != 0 {
		t.Errorf("overdue pending = %d, want 0", got)
	}
	if got := balance(waiting, ledger.PurposeAvailable); got != 0 {
		t.Errorf("a grant inside its holdback was released early: available = %d", got)
	}
	if got := balance(waiting, ledger.PurposePending); got != 100 {
		t.Errorf("waiting pending = %d, want 100", got)
	}

	// One release transfer and one release record, and the transfer's two legs
	// are the user's pending (debit) and available (credit) accounts.
	var transfers, records int
	if err := owner.QueryRow(ctx, `SELECT
		  (SELECT count(*) FROM ledger.transfer WHERE idempotency_key = 'release_' || $1),
		  (SELECT count(*) FROM ledger.grant_release WHERE grant_id = $1)`, late.GrantID).Scan(&transfers, &records); err != nil {
		t.Fatal(err)
	}
	if transfers != 1 || records != 1 {
		t.Fatalf("release transfers = %d, records = %d; want 1 and 1", transfers, records)
	}
	rows, err := owner.Query(ctx, `SELECT e.account_id, e.amount_minor FROM ledger.entry e
		JOIN ledger.transfer t ON t.id = e.transfer_id WHERE t.idempotency_key = 'release_' || $1`, late.GrantID)
	if err != nil {
		t.Fatal(err)
	}
	legs := map[string]int64{}
	for rows.Next() {
		var account string
		var amount int64
		if err := rows.Scan(&account, &amount); err != nil {
			t.Fatal(err)
		}
		legs[account] += amount
	}
	rows.Close()
	want := map[string]int64{
		ledger.UserAccountID(overdue, ledger.PurposePending):   -100,
		ledger.UserAccountID(overdue, ledger.PurposeAvailable): 100,
	}
	if len(legs) != len(want) || legs[ledger.UserAccountID(overdue, ledger.PurposePending)] != -100 ||
		legs[ledger.UserAccountID(overdue, ledger.PurposeAvailable)] != 100 {
		t.Errorf("release legs = %v, want %v", legs, want)
	}
	if after := cashTotals(t, owner); !sameTotals(cashBefore, after) {
		t.Errorf("a release moved cash: before %v, after %v", cashBefore, after)
	}
}

// cashTotals counts and sums every cash (non-points) entry by currency: the
// cash side of the books, which a release must leave exactly as it was. The
// package's tests run one at a time, so nothing else posts in between.
func cashTotals(t *testing.T, owner *pgxpool.Pool) map[string][2]int64 {
	t.Helper()
	rows, err := owner.Query(context.Background(), `SELECT currency, count(*), sum(abs(amount_minor))::bigint
		FROM ledger.entry WHERE currency <> $1 GROUP BY currency`, string(ledger.CurrencyPoints))
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	totals := map[string][2]int64{}
	for rows.Next() {
		var currency string
		var n, sum int64
		if err := rows.Scan(&currency, &n, &sum); err != nil {
			t.Fatal(err)
		}
		totals[currency] = [2]int64{n, sum}
	}
	return totals
}

func sameTotals(a, b map[string][2]int64) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}
