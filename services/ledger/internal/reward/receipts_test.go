package reward_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/escrow"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/ledgertest"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/risk"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// Group 2.10.b T2b (F127, docs/27 §3.3): a receipt is paid by its partner's
// receipt package, oldest first, never split; when none has room, receipts
// stop earning. Receipt packages pay nothing else.

// receiptsAU is an uncapped AU engine and its pool.
func receiptsAU(t *testing.T) (*reward.Engine, *pgxpool.Pool) {
	t.Helper()
	pool := receiptPool(t)
	return reward.New(pool, ledger.New(pool), reward.AlwaysAllow{}, ledger.RegionAU).WithCaps(uncapped), pool
}

// fundedPartner is a fresh partner whose approved receipt funder in region
// is a fresh business.
func fundedPartner(t *testing.T, region ledger.Region) (partner, business string) {
	t.Helper()
	partner, business = unique("partner"), businessUUID()
	ledgertest.SetRegionSetting(t, string(region), "receipt_funder."+partner, fmt.Sprintf(`{"businessId": %q}`, business))
	return partner, business
}

// buyReceipts buys the business one 1,000-point receipt package at cost.
func buyReceipts(t *testing.T, engine *reward.Engine, business string, region ledger.Region) string {
	t.Helper()
	price := map[ledger.Region]int64{ledger.RegionAU: 3_000, ledger.RegionID: 6_000}[region]
	bought, err := engine.RecordPurchase(context.Background(), receiptPurchase(business, region, "starter", 1_000, price))
	if err != nil {
		t.Fatalf("buying a receipt package: %v", err)
	}
	return bought.AllocationID
}

func receiptFor(user, partner string, points int64) reward.ActionRequest {
	return reward.ActionRequest{Kind: "receipt", UserID: user, Points: points, TrustTier: 3,
		IdempotencyKey: unique("rcpt"), PartnerID: partner, AgeBand: reward.AgeBandAdult}
}

func remainingOf(t *testing.T, engine *reward.Engine, allocation string) int64 {
	t.Helper()
	remaining, err := engine.RemainingPoints(context.Background(), allocation)
	if err != nil {
		t.Fatal(err)
	}
	return remaining
}

type grantRow struct {
	allocation, transfer string
	taxonomy             int32
}

func grantOf(t *testing.T, pool *pgxpool.Pool, grantID string) grantRow {
	t.Helper()
	var row grantRow
	if err := pool.QueryRow(context.Background(),
		`SELECT allocation_id, transfer_id, taxonomy_ver FROM ledger.grant WHERE id = $1`, grantID,
	).Scan(&row.allocation, &row.transfer, &row.taxonomy); err != nil {
		t.Fatalf("grant %s: %v", grantID, err)
	}
	return row
}

// noTrace: a refused receipt left no grant and no hold.
func noTrace(t *testing.T, pool *pgxpool.Pool, req reward.ActionRequest) {
	t.Helper()
	ctx := context.Background()
	q := sqlcgen.New(pool)
	if _, err := q.GetGrantByExternalRef(ctx, sqlcgen.GetGrantByExternalRefParams{UserID: req.UserID,
		ActionType: string(reward.ActionReceiptScanned), ExternalRef: req.IdempotencyKey}); !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("a refused receipt left a grant (%v)", err)
	}
	ref := fmt.Sprintf("%s_%s_%s", req.UserID, reward.ActionReceiptScanned, req.IdempotencyKey)
	if _, err := q.GetHold(ctx, "grant_"+ref); !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("a refused receipt left a hold (%v)", err)
	}
}

func TestAReceiptIsPaidByTheOldestPackageNotMarketing(t *testing.T) {
	engine, pool := receiptsAU(t)
	ctx := context.Background()
	book := engine.Ledger()
	partner, business := fundedPartner(t, ledger.RegionAU)
	older := buyReceipts(t, engine, business, ledger.RegionAU)
	newer := buyReceipts(t, engine, business, ledger.RegionAU)

	marketingCash := ledger.PlatformAccountID(ledger.RegionAU, ledger.RoleMarketingCash)
	cashBefore, _ := book.Balance(ctx, marketingCash)
	user := freshUser()
	req := receiptFor(user, partner, 600)
	paid, err := engine.GrantAction(ctx, req)
	if err != nil {
		t.Fatalf("a receipt: %v", err)
	}

	row := grantOf(t, pool, paid.GrantID)
	if row.allocation != older || row.taxonomy != 2 {
		t.Errorf("grant = %+v, want the older package %s at taxonomy 2", row, older)
	}
	entries, err := sqlcgen.New(pool).ListEntriesByTransfer(ctx, row.transfer)
	if err != nil {
		t.Fatal(err)
	}
	// Dr points_issued / Cr user.pending (credit-positive amounts).
	want := map[string]int64{
		ledger.PlatformAccountID(ledger.RegionAU, ledger.RolePointsIssued): -600,
		ledger.UserAccountID(user, ledger.PurposePending):                  600,
	}
	if len(entries) != len(want) {
		t.Fatalf("entries = %+v, want %v", entries, want)
	}
	for _, entry := range entries {
		if amount, ok := want[entry.AccountID]; !ok || amount != entry.AmountMinor {
			t.Errorf("entry %s %d, want %v", entry.AccountID, entry.AmountMinor, want)
		}
	}
	var backing int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ledger.transfer WHERE id LIKE 'led_txn_backing_%' || $1 || '%'`,
		user).Scan(&backing); err != nil || backing != 0 {
		t.Errorf("backing transfers = %d (%v), want none", backing, err)
	}
	if cashAfter, _ := book.Balance(ctx, marketingCash); cashAfter != cashBefore {
		t.Errorf("marketing cash moved %d → %d", cashBefore, cashAfter)
	}

	// 400 left in the older: 600 more comes whole from the newer.
	if _, err := engine.GrantAction(ctx, receiptFor(freshUser(), partner, 600)); err != nil {
		t.Fatal(err)
	}
	if got := [2]int64{remainingOf(t, engine, older), remainingOf(t, engine, newer)}; got != [2]int64{400, 400} {
		t.Errorf("remaining = %v, want [400 400] (never split)", got)
	}
	// The oldest with room again, until it is empty.
	second, err := engine.GrantAction(ctx, receiptFor(freshUser(), partner, 400))
	if err != nil {
		t.Fatal(err)
	}
	if row := grantOf(t, pool, second.GrantID); row.allocation != older {
		t.Errorf("drawn from %s, want the older %s while it has room", row.allocation, older)
	}
	third, err := engine.GrantAction(ctx, receiptFor(freshUser(), partner, 1))
	if err != nil {
		t.Fatal(err)
	}
	if row := grantOf(t, pool, third.GrantID); row.allocation != newer {
		t.Errorf("drawn from %s, want the newer %s once the older is empty", row.allocation, newer)
	}
}

func TestNoFunderNoPackageOrNoRoomIsExhausted(t *testing.T) {
	engine, pool := receiptsAU(t)
	ctx := context.Background()

	stranger := receiptFor(freshUser(), unique("partner"), 1)
	if _, err := engine.GrantAction(ctx, stranger); !errors.Is(err, reward.ErrAllocationExhausted) {
		t.Errorf("no funder: %v, want ErrAllocationExhausted", err)
	}
	noTrace(t, pool, stranger)

	partner, business := fundedPartner(t, ledger.RegionAU)
	unfunded := receiptFor(freshUser(), partner, 1)
	if _, err := engine.GrantAction(ctx, unfunded); !errors.Is(err, reward.ErrAllocationExhausted) {
		t.Errorf("no package: %v, want ErrAllocationExhausted", err)
	}
	noTrace(t, pool, unfunded)

	pkg := buyReceipts(t, engine, business, ledger.RegionAU)
	if _, err := engine.GrantAction(ctx, receiptFor(freshUser(), partner, 999)); err != nil {
		t.Fatal(err)
	}
	tooBig := receiptFor(freshUser(), partner, 2)
	if _, err := engine.GrantAction(ctx, tooBig); !errors.Is(err, reward.ErrAllocationExhausted) {
		t.Errorf("2 points with 1 left: %v, want ErrAllocationExhausted", err)
	}
	noTrace(t, pool, tooBig)
	if left := remainingOf(t, engine, pkg); left != 1 {
		t.Errorf("remaining = %d, want 1", left)
	}

	// The funder's package in AU pays nothing in ID.
	_, _, idPool := atCostEngines(t)
	id := reward.New(idPool, ledger.New(idPool), reward.AlwaysAllow{}, ledger.RegionID).WithCaps(uncapped)
	if _, err := id.GrantAction(ctx, receiptFor(freshUser(), partner, 1)); !errors.Is(err, reward.ErrAllocationExhausted) {
		t.Errorf("an AU funder's receipt in ID: %v, want ErrAllocationExhausted", err)
	}
}

func TestAReceiptWithoutAPartnerIsRefused(t *testing.T) {
	engine, pool := receiptsAU(t)
	req := receiptFor(freshUser(), "", 1)
	if _, err := engine.GrantAction(context.Background(), req); !errors.Is(err, reward.ErrWrongFunder) {
		t.Fatalf("a receipt naming no partner: %v, want ErrWrongFunder", err)
	}
	noTrace(t, pool, req)
}

// The replay runs before funding is looked up: a paid receipt stays a
// duplicate after its package is spent, and after the receipt rate changed.
func TestAPaidReceiptReplaysAfterExhaustionAndARateChange(t *testing.T) {
	engine, _ := receiptsAU(t)
	ctx := context.Background()
	partner, business := fundedPartner(t, ledger.RegionAU)
	pkg := buyReceipts(t, engine, business, ledger.RegionAU)

	first := receiptFor(freshUser(), partner, 10)
	paid, err := engine.GrantAction(ctx, first)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := engine.GrantAction(ctx, receiptFor(freshUser(), partner, 990)); err != nil {
		t.Fatal(err)
	}
	if left := remainingOf(t, engine, pkg); left != 0 {
		t.Fatalf("remaining = %d, want 0", left)
	}
	for _, points := range []int64{10, 1} {
		replay := first
		replay.Points = points
		got, err := engine.GrantAction(ctx, replay)
		if err != nil || got.GrantID != paid.GrantID || got.Points != 10 {
			t.Errorf("replay at %d points: %+v, %v; want the first grant of 10", points, got, err)
		}
	}
	if _, err := engine.GrantAction(ctx, receiptFor(freshUser(), partner, 1)); !errors.Is(err, reward.ErrAllocationExhausted) {
		t.Errorf("a new receipt: %v, want ErrAllocationExhausted", err)
	}
	// Streaks keep their conflict on the same key with other points.
	if _, err := engine.FundMarketing(ctx, unique("fund"), 100_000, "alice", "bob"); err != nil {
		t.Fatal(err)
	}
	streak := reward.ActionRequest{Kind: "streak", UserID: freshUser(), Points: 10, TrustTier: 3, IdempotencyKey: unique("streak")}
	if _, err := engine.GrantAction(ctx, streak); err != nil {
		t.Fatal(err)
	}
	streak.Points = 1
	if _, err := engine.GrantAction(ctx, streak); !errors.Is(err, ledger.ErrIdempotencyConflict) {
		t.Errorf("a streak's key with other points: %v, want ErrIdempotencyConflict", err)
	}
}

// Receipt points are paid for, so the solvency pause stops streaks only.
func TestReceiptsPayBelowTheCoveragePauseAndStreaksDoNot(t *testing.T) {
	engine, _ := receiptsAU(t)
	ctx := context.Background()
	book := engine.Ledger()
	if _, err := engine.FundMarketing(ctx, unique("fund"), 1_000_000, "alice", "bob"); err != nil {
		t.Fatal(err)
	}
	partner, business := fundedPartner(t, ledger.RegionAU)
	buyReceipts(t, engine, business, ledger.RegionAU)

	sink := ledger.BurnLiability(ledger.RegionAU, 1_000_000_000_000)
	posted, err := book.Transfer(ctx, ledger.TransferRequest{
		ID: unique("t"), IdempotencyKey: unique("k"), ReasonCode: "test_liability", Entries: sink,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := book.Transfer(ctx, ledger.TransferRequest{
			ID: unique("t"), IdempotencyKey: unique("k"), ReasonCode: "test_liability_undo",
			Entries: ledger.Reverse(sink), Reverses: posted.TransferID,
		}); err != nil {
			t.Error(err)
		}
	})

	streak := reward.ActionRequest{Kind: "streak", UserID: freshUser(), Points: 10, TrustTier: 3, IdempotencyKey: unique("streak")}
	if _, err := engine.GrantAction(ctx, streak); !errors.Is(err, reward.ErrSolvencyBlocked) {
		t.Errorf("a streak under collapsed coverage: %v, want ErrSolvencyBlocked", err)
	}
	if _, err := engine.GrantAction(ctx, receiptFor(freshUser(), partner, 1)); err != nil {
		t.Errorf("a receipt under collapsed coverage: %v, want paid", err)
	}
}

// F127: no per-person receipt count; only the earn caps bound receipts.
func TestReceiptsHaveNoPerPersonCount(t *testing.T) {
	engine, _ := receiptsAU(t)
	ctx := context.Background()
	partner, business := fundedPartner(t, ledger.RegionAU)
	buyReceipts(t, engine, business, ledger.RegionAU)
	user := freshUser()
	for i := range 12 {
		if _, err := engine.GrantAction(ctx, receiptFor(user, partner, 1)); err != nil {
			t.Fatalf("receipt %d of the day: %v", i+1, err)
		}
	}
	capped := engine.WithCaps(reward.Caps{DailyPoints: 12, MonthlyPoints: 1 << 40, TeenDailyPoints: 6})
	if _, err := capped.GrantAction(ctx, receiptFor(user, partner, 1)); !errors.Is(err, reward.ErrEarnCapReached) {
		t.Errorf("past the daily earn cap: %v, want ErrEarnCapReached", err)
	}
}

func TestConcurrentReceiptsNeverOverdrawAPackage(t *testing.T) {
	engine, _ := receiptsAU(t)
	ctx := context.Background()
	partner, business := fundedPartner(t, ledger.RegionAU)
	pkg := buyReceipts(t, engine, business, ledger.RegionAU)
	if _, err := engine.GrantAction(ctx, receiptFor(freshUser(), partner, 990)); err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	paid, exhausted := 0, 0
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := engine.GrantAction(ctx, receiptFor(freshUser(), partner, 1))
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				paid++
			case errors.Is(err, reward.ErrAllocationExhausted):
				exhausted++
			default:
				t.Errorf("a concurrent receipt failed: %v", err)
			}
		}()
	}
	wg.Wait()
	if paid != 10 || exhausted != 10 {
		t.Errorf("paid %d, exhausted %d; want 10 and 10", paid, exhausted)
	}
	if left := remainingOf(t, engine, pkg); left != 0 {
		t.Errorf("remaining = %d, want 0", left)
	}
}

// A receipt package pays receipts only: no hold, campaign hold or campaign
// grant may use one.
func TestNoCampaignPathUsesAReceiptPackage(t *testing.T) {
	engine, pool := rewardEngine(t) // ID
	ctx := context.Background()
	campaign := newLiveCampaign(t, engine, 100, 0, 1_000_000)
	// The campaign's own owner is a receipt funder: only the package check refuses.
	ledgertest.SetRegionSetting(t, "ID", "receipt_funder."+unique("partner"), fmt.Sprintf(`{"businessId": %q}`, campaign.Owner))
	pkg := buyReceipts(t, engine, campaign.Owner, ledger.RegionID)
	if _, err := ownerPool(t).Exec(ctx, `UPDATE campaign.reward_config SET allocation_id = $2 WHERE campaign_id = $1`,
		campaign.ID, pkg); err != nil {
		t.Fatal(err)
	}
	isPackageRefusal := func(what string, err error) {
		t.Helper()
		if !errors.Is(err, reward.ErrWrongFunder) || !strings.Contains(err.Error(), "receipt package") {
			t.Errorf("%s: %v, want ErrWrongFunder for a receipt package", what, err)
		}
	}

	hold := reward.HoldRequest{ID: unique("hold"), AllocationID: pkg, Points: 100, TTL: time.Hour}
	isPackageRefusal("Hold", engine.Hold(ctx, hold))
	isPackageRefusal("HoldForCampaign", engine.HoldForCampaign(ctx, hold, campaign.ID))
	_, err := engine.GrantReward(ctx, campaign.reward(freshUser(), 100, 0, 0, 3))
	isPackageRefusal("GrantReward", err)
	if left := remainingOf(t, engine, pkg); left != 1_000 {
		t.Errorf("remaining = %d, want 1000", left)
	}
	if _, err := sqlcgen.New(pool).GetHold(ctx, hold.ID); !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("a refused hold was written (%v)", err)
	}
}

// insertGrant writes a grant of action_type `action` from `allocation`
// straight to the table, as the database sees any writer.
func insertGrant(pool *pgxpool.Pool, region ledger.Region, allocation, action string) error {
	ctx := context.Background()
	user := freshUser()
	r := string(region)
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		for _, a := range ledger.UserAccounts(user, region) {
			if err := q.InsertAccount(ctx, sqlcgen.InsertAccountParams{ID: a.ID, OwnerType: string(a.OwnerType),
				OwnerID: a.OwnerID, Currency: string(a.Currency), Kind: string(a.Kind), Country: a.Country,
				Purpose: string(a.Purpose)}); err != nil {
				return err
			}
		}
		posted, err := ledger.New(pool).TransferInTx(ctx, tx, ledger.TransferRequest{
			ID: unique("t_grant"), IdempotencyKey: unique("k_grant"), ReasonCode: "test_grant",
			Entries: ledger.GrantPartner(region, user, 5),
		})
		if err != nil {
			return err
		}
		_, err = q.InsertGrant(ctx, sqlcgen.InsertGrantParams{
			ID: unique("grant"), UserID: user, ActionType: action, TaxonomyVer: reward.TaxonomyVersion, Points: 5,
			AllocationID: allocation, TransferID: posted.TransferID, ExternalRef: unique("ref"), Region: &r,
		})
		return err
	})
}

// Migration B's backstop: a receipt grant must draw a receipt package, and
// no other grant may.
func TestTheDatabaseRefusesAMismatchedGrant(t *testing.T) {
	engine, pool := receiptsAU(t)
	_, business := fundedPartner(t, ledger.RegionAU)
	pkg := buyReceipts(t, engine, business, ledger.RegionAU)
	plain := ledgertest.PartnerAllocation(t, pool, ledger.RegionAU)

	if err := insertGrant(pool, ledger.RegionAU, plain, string(reward.ActionReceiptScanned)); sqlState(err) != "23514" {
		t.Errorf("a receipt from a plain allocation: %v, want a check_violation", err)
	}
	if err := insertGrant(pool, ledger.RegionAU, pkg, string(reward.ActionGoodwill)); sqlState(err) != "23514" {
		t.Errorf("goodwill from a receipt package: %v, want a check_violation", err)
	}
	if err := insertGrant(pool, ledger.RegionAU, pkg, string(reward.ActionReceiptScanned)); err != nil {
		t.Errorf("a receipt from its package: %v", err)
	}
	if err := insertGrant(pool, ledger.RegionAU, plain, string(reward.ActionGoodwill)); err != nil {
		t.Errorf("goodwill from a plain allocation: %v", err)
	}
}

// Group 2.10.e (founder decision 2.10.d): receipts are left out of the risk
// gate's user-velocity signal. These run through the REAL gate (risk.Gate),
// not AlwaysAllow.

// gatedReceiptsAU is receiptsAU with the real risk gate wired in.
func gatedReceiptsAU(t *testing.T) (*reward.Engine, *pgxpool.Pool) {
	t.Helper()
	pool := receiptPool(t)
	book := ledger.New(pool)
	gate := risk.New(pool, book, escrow.New(pool, book))
	return reward.New(pool, book, gate, ledger.RegionAU).WithCaps(uncapped), pool
}

// riskFlags counts the user's ledger.risk_flag rows, by severity.
func riskFlags(t *testing.T, pool *pgxpool.Pool, user string) map[string]int {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT severity, count(*) FROM ledger.risk_flag WHERE user_id = $1 GROUP BY severity`, user)
	if err != nil {
		t.Fatalf("reading risk flags: %v", err)
	}
	defer rows.Close()
	flags := map[string]int{}
	for rows.Next() {
		var severity string
		var n int
		if err := rows.Scan(&severity, &n); err != nil {
			t.Fatal(err)
		}
		flags[severity] = n
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return flags
}

// sendReceipts pays n one-point receipts for user, in well under a minute,
// and fails the test if any of them is refused.
func sendReceipts(t *testing.T, engine *reward.Engine, user, partner string, n int) {
	t.Helper()
	start := time.Now()
	for i := 0; i < n; i++ {
		if _, err := engine.GrantAction(context.Background(), receiptFor(user, partner, 1)); err != nil {
			t.Fatalf("receipt %d of %d: %v", i+1, n, err)
		}
	}
	if elapsed := time.Since(start); elapsed >= time.Minute {
		t.Fatalf("%d receipts took %s; the test needs them inside a minute", n, elapsed)
	}
}

func TestAStackOfReceiptsIsNeverFlaggedForVelocity(t *testing.T) {
	engine, pool := gatedReceiptsAU(t)
	partner, business := fundedPartner(t, ledger.RegionAU)
	buyReceipts(t, engine, business, ledger.RegionAU)
	user := freshUser()

	// 12 is past both FlagUserVelocity (6) and BlockUserVelocity (10).
	sendReceipts(t, engine, user, partner, 12)

	if flags := riskFlags(t, pool, user); len(flags) != 0 {
		t.Fatalf("12 receipts wrote risk flags %v, want none", flags)
	}
	pending, err := engine.Ledger().Balance(context.Background(), ledger.UserAccountID(user, ledger.PurposePending))
	if err != nil {
		t.Fatal(err)
	}
	available, err := engine.Ledger().Balance(context.Background(), ledger.UserAccountID(user, ledger.PurposeAvailable))
	if err != nil {
		t.Fatal(err)
	}
	if pending+available != 12 {
		t.Errorf("pending %d + available %d, want all 12 points paid and none held", pending, available)
	}

	// The receipts did not count toward the window: a watch after them is
	// the user's FIRST velocity-counted grant, so it neither blocks (13 would)
	// nor flags (6+ would).
	watch := request(user, auFundedAllocation(t, engine, 1_000), reward.ActionQuickWatched)
	if _, err := engine.Grant(context.Background(), watch); err != nil {
		t.Fatalf("a watch after 12 receipts: %v, want it paid", err)
	}
	if flags := riskFlags(t, pool, user); len(flags) != 0 {
		t.Errorf("the watch after 12 receipts wrote risk flags %v, want none", flags)
	}
}

func TestReceiptsNeitherBlockNorHelpBlockAfterWatches(t *testing.T) {
	engine, pool := gatedReceiptsAU(t)
	ctx := context.Background()
	partner, business := fundedPartner(t, ledger.RegionAU)
	buyReceipts(t, engine, business, ledger.RegionAU)
	allocation := auFundedAllocation(t, engine, 10_000)
	user := freshUser()

	// Nine watches: the last four flag, none block.
	for i := 0; i < risk.BlockUserVelocity-1; i++ {
		if _, err := engine.Grant(ctx, request(user, allocation, reward.ActionQuickWatched)); err != nil {
			t.Fatalf("watch %d: %v", i+1, err)
		}
	}
	before := riskFlags(t, pool, user)
	if want := risk.BlockUserVelocity - risk.FlagUserVelocity; before["flag"] != want || before["block"] != 0 {
		t.Fatalf("after 9 watches flags = %v, want %d flag and no block", before, want)
	}

	// A receipt would have been the 10th grant and blocked; now it is not
	// judged for velocity at all, so it pays and writes nothing.
	sendReceipts(t, engine, user, partner, 3)
	if after := riskFlags(t, pool, user); after["flag"] != before["flag"] || after["block"] != 0 {
		t.Fatalf("receipts after 9 watches changed the flags from %v to %v", before, after)
	}

	// The 10th WATCH still blocks: the watches count as before.
	if _, err := engine.Grant(ctx, request(user, allocation, reward.ActionQuickWatched)); !errors.Is(err, reward.ErrRiskRefused) {
		t.Fatalf("the 10th watch: err = %v, want ErrRiskRefused", err)
	}
	if after := riskFlags(t, pool, user); after["block"] != 1 {
		t.Errorf("after the 10th watch flags = %v, want one block", after)
	}
}
