package burn_test

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"testing"

	"github.com/yourtal/services/ledger/internal/burn"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
)

// 4.7: the ledger burns exactly the price it holds, never what a caller asks.

func newUUID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func pricedListing(t *testing.T, f *fixture, region ledger.Region, currency string, settlement int64) (string, int64) {
	t.Helper()
	id := newUUID()
	price, err := pricing.New(f.pool).PriceListing(context.Background(), id, region, currency, settlement)
	if err != nil {
		t.Fatal(err)
	}
	return id, price.PricePoints
}

func TestABurnPaysTheListingsPriceExactly(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	user := f.user(t, ledger.RegionID, 1_000)
	listing, price := pricedListing(t, f, ledger.RegionID, "IDR", 1_800)

	if _, err := f.engine.ForListing(ctx, unique("saga"), user, listing, "", price-1); !errors.Is(err, burn.ErrPriceNotHeld) {
		t.Fatalf("one point short of %d: %v", price, err)
	}
	if _, err := f.engine.ForListing(ctx, unique("saga"), user, listing, "", price); err != nil {
		t.Fatalf("the listing's price: %v", err)
	}
}

func TestABurnOnAQuotePaysTheLockedQuote(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	user := f.user(t, ledger.RegionID, 1_000)
	listing, _ := pricedListing(t, f, ledger.RegionID, "IDR", 1_800)
	prices := pricing.New(f.pool)
	quote, err := prices.NewQuote(ctx, ledger.RegionID, "IDR", 1_800, 0)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := f.engine.ForListing(ctx, unique("saga"), user, listing, quote.ID, quote.PricePoints); !errors.Is(err, burn.ErrPriceNotHeld) {
		t.Fatalf("an unlocked quote: %v", err)
	}
	if _, err := prices.LockQuote(ctx, quote.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.engine.ForListing(ctx, unique("saga"), user, listing, quote.ID, 1); !errors.Is(err, burn.ErrPriceNotHeld) {
		t.Fatalf("1 point against a %d-point quote: %v", quote.PricePoints, err)
	}
	saga := unique("saga")
	if _, err := f.engine.ForListing(ctx, saga, user, listing, quote.ID, quote.PricePoints); err != nil {
		t.Fatalf("the locked quote: %v", err)
	}
	// A quote for another value is not this listing's price.
	other, _ := pricedListing(t, f, ledger.RegionID, "IDR", 3_600)
	if _, err := f.engine.ForListing(ctx, unique("saga"), user, other, quote.ID, quote.PricePoints); !errors.Is(err, burn.ErrPriceNotHeld) {
		t.Fatalf("a quote for IDR 1,800 on an IDR 3,600 listing: %v", err)
	}
}

// 4.7.d: an ID user cannot burn for an AU listing, even calling the ledger directly.
func TestAnIDUserCannotBurnForAnAUListing(t *testing.T) {
	f := newFixture(t)
	user := f.user(t, ledger.RegionID, 1_000)
	listing, price := pricedListing(t, f, ledger.RegionAU, "AUD", 300)
	if _, err := f.engine.ForListing(context.Background(), unique("saga"), user, listing, "", price); !errors.Is(err, burn.ErrRegionMismatch) {
		t.Fatalf("an AU listing for an ID user: %v", err)
	}
}

// 2.8.g: a listing's staff-set price above the ledger's quote is what the
// buyer pays. The burn takes exactly that quote; its points half books every
// point and its cash half books S, so the points above S ÷ B leave the users'
// claims and the reserve keeps the cash that backed them. A staff price below
// the ledger's quote is ignored.
func TestAListingPriceAboveTheQuoteBurnsAndKeepsTheBacking(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	user := f.user(t, ledger.RegionID, 1_000)
	listing, ledgerPrice := pricedListing(t, f, ledger.RegionID, "IDR", 1_800) // 300 points at B = IDR 6
	prices := pricing.New(f.pool)

	below, err := prices.NewQuote(ctx, ledger.RegionID, "IDR", 1_800, ledgerPrice-100)
	if err != nil {
		t.Fatal(err)
	}
	if below.PricePoints != ledgerPrice {
		t.Errorf("a staff price below the quote: %d points, want the ledger's %d", below.PricePoints, ledgerPrice)
	}
	none, err := prices.NewQuote(ctx, ledger.RegionID, "IDR", 1_800, 0)
	if err != nil {
		t.Fatal(err)
	}
	if none.PricePoints != ledgerPrice {
		t.Errorf("no staff price: %d points, want %d", none.PricePoints, ledgerPrice)
	}
	if _, err := prices.NewQuote(ctx, ledger.RegionID, "IDR", 1_800, -1); !errors.Is(err, pricing.ErrMinPriceNegative) {
		t.Errorf("a negative staff price: %v", err)
	}

	staffPrice := ledgerPrice + 100
	quote, err := prices.NewQuote(ctx, ledger.RegionID, "IDR", 1_800, staffPrice)
	if err != nil {
		t.Fatal(err)
	}
	if quote.PricePoints != staffPrice {
		t.Fatalf("a staff price above the quote: %d points, want %d", quote.PricePoints, staffPrice)
	}
	if _, err := prices.LockQuote(ctx, quote.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.engine.ForListing(ctx, unique("saga"), user, listing, quote.ID, ledgerPrice); !errors.Is(err, burn.ErrPriceNotHeld) {
		t.Fatalf("the ledger's %d against a %d-point quote: %v", ledgerPrice, staffPrice, err)
	}
	saga := unique("saga")
	burned, err := f.engine.ForListing(ctx, saga, user, listing, quote.ID, staffPrice)
	if err != nil {
		t.Fatalf("the staff price: %v", err)
	}
	if burned.Points != staffPrice || burned.SettlementMinor != 1_800 {
		t.Errorf("burned %d points against S %d, want %d against 1800", burned.Points, burned.SettlementMinor, staffPrice)
	}
	if got := f.available(t, user); got != 1_000-staffPrice {
		t.Errorf("available = %d, want %d", got, 1_000-staffPrice)
	}

	// The books: points at the staff price, the voucher at S, and the reserve untouched.
	want := map[string]int64{
		ledger.UserAccountID(user, ledger.PurposeAvailable):                      -staffPrice,
		ledger.PlatformAccountID(ledger.RegionID, ledger.RolePointsRedeemed):     staffPrice,
		ledger.PlatformAccountID(ledger.RegionID, ledger.RoleRedemptionClearing): -1_800,
		ledger.PlatformAccountID(ledger.RegionID, ledger.RoleVoucherLiability):   1_800,
	}
	rows, err := f.pool.Query(ctx, `SELECT account_id, amount_minor FROM ledger.entry
		WHERE transfer_id IN ($1, $2)`, "led_txn_burn_points_"+saga, "led_txn_burn_liability_"+saga)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := map[string]int64{}
	for rows.Next() {
		var account string
		var amount int64
		if err := rows.Scan(&account, &amount); err != nil {
			t.Fatal(err)
		}
		got[account] += amount
	}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("the burn posted %v, want %v (no reserve leg)", got, want)
	}
}
