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
	quote, err := prices.NewQuote(ctx, ledger.RegionID, "IDR", 1_800)
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
