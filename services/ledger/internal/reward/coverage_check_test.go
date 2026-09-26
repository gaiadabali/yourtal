package reward_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/burn"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// 4.9.f's Check, in AU at B = 3¢ and P_issue = 4.5¢. The test database is
// shared with other tests, so each step is measured as the change it makes:
// what this purchase, burn and capture do to the region's coverage.

type cover struct{ backing, owed int64 }

func measureAU(t *testing.T, pool *pgxpool.Pool) cover {
	t.Helper()
	c, err := pricing.CoverageNow(context.Background(), sqlcgen.New(pool), ledger.RegionAU)
	if err != nil {
		t.Fatal(err)
	}
	return cover{backing: c.ReserveMinor + c.MarketingCashMinor, owed: c.LiabilityMinor}
}

func TestCoverageCheck49f(t *testing.T) {
	_, pool := newEngine(t, reward.AlwaysAllow{})
	book := ledger.New(pool)
	engine := reward.New(pool, book, reward.AlwaysAllow{}, ledger.RegionAU).WithCaps(uncapped)
	ctx := context.Background()
	if err := engine.EnsureChart(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.FundMarketing(ctx, unique("fund"), 100_000, "alice", "bob"); err != nil {
		t.Fatal(err)
	}
	user := freshUser()
	merchant := unique("mer")
	for _, a := range append(ledger.UserAccounts(user, ledger.RegionAU), ledger.MerchantPayable(merchant, ledger.RegionAU)) {
		if err := sqlcgen.New(pool).InsertAccount(ctx, sqlcgen.InsertAccountParams{ID: a.ID, OwnerType: string(a.OwnerType),
			OwnerID: a.OwnerID, Currency: string(a.Currency), Kind: string(a.Kind), Country: a.Country, Purpose: string(a.Purpose)}); err != nil {
			t.Fatal(err)
		}
	}

	// An AU purchase of 1,000 points, fully granted: AUD 45.00 of cash
	// against 1,000 × 3¢ = AUD 30.00 owed is coverage 1.50.
	before := measureAU(t, pool)
	if _, err := engine.RecordPurchase(ctx, reward.PurchaseRequest{
		ID: unique("pur"), PartnerID: unique("partner"), Points: 1_000, AmountMinor: 4_500, Currency: "AUD",
	}); err != nil {
		t.Fatal(err)
	}
	for _, entries := range [][]ledger.Entry{ledger.GrantPartner(ledger.RegionAU, user, 1_000), ledger.Release(user, 1_000)} {
		if _, err := book.Transfer(ctx, ledger.TransferRequest{ID: unique("t"), IdempotencyKey: unique("k"),
			ReasonCode: "test_grant", Entries: entries}); err != nil {
			t.Fatal(err)
		}
	}
	granted := measureAU(t, pool)
	backing, owed := granted.backing-before.backing, granted.owed-before.owed
	if backing != 4_500 || owed != 3_000 || backing*10_000/owed != 15_000 {
		t.Fatalf("the purchase added %d of cash against %d owed, want 4,500 against 3,000 (1.50)", backing, owed)
	}
	if _, err := engine.GrantAction(ctx, reward.ActionRequest{Kind: "streak", UserID: freshUser(), Points: 60,
		TrustTier: 3, IdempotencyKey: unique("streak")}); err != nil {
		t.Fatalf("a streak after the purchase: %v", err)
	}

	// Burn the 1,000 points for a voucher worth S = AUD 30.00, then the
	// merchant captures it: value moves between what is owed, never away.
	listing := newListingID()
	if _, err := pricing.New(pool).PriceListing(ctx, listing, ledger.RegionAU, "AUD", 3_000); err != nil {
		t.Fatal(err)
	}
	start := measureAU(t, pool)
	if _, err := burn.New(pool, book).ForListing(ctx, unique("saga"), user, listing, "", 1_000); err != nil {
		t.Fatal(err)
	}
	burned := measureAU(t, pool)
	if _, err := book.Transfer(ctx, ledger.TransferRequest{ID: unique("t"), IdempotencyKey: unique("k"),
		ReasonCode: "test_capture", Entries: ledger.Capture(ledger.RegionAU, merchant, 3_000)}); err != nil {
		t.Fatal(err)
	}
	captured := measureAU(t, pool)
	for step, c := range map[string]cover{"burn": burned, "capture": captured} {
		if abs(c.backing-start.backing) > 1 || abs(c.owed-start.owed) > 1 {
			t.Errorf("after the %s: cash moved %d and owed moved %d, want both within one cent",
				step, c.backing-start.backing, c.owed-start.owed)
		}
	}
}

func abs(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

func newListingID() string {
	u := freshUser() // a uuid-shaped id, unique per call
	return "1b1e" + u[4:]
}
