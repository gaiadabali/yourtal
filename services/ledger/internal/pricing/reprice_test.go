package pricing_test

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/testdb"
)

// 4.9.a: a listing is repriced when a newly approved rate takes effect, and
// apps/api reads its points through platform.listing_points only.

func connect(t *testing.T, envVar string) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(), testdb.URL(t, envVar))
	if err != nil {
		t.Fatalf("connect %s: %v", envVar, err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func listingID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func storedPrice(t *testing.T, pool *pgxpool.Pool, id string) (int64, string) {
	t.Helper()
	var points int64
	var rateID string
	if err := pool.QueryRow(context.Background(),
		`SELECT price_points, backing_rate_id FROM ledger.listing_price WHERE listing_id = $1`, id,
	).Scan(&points, &rateID); err != nil {
		t.Fatalf("reading the listing price: %v", err)
	}
	return points, rateID
}

func TestARateCutRepricesListingsOnceItTakesEffect(t *testing.T) {
	engine, pool := newEngine(t)
	owner := connect(t, "DATABASE_OWNER_URL")
	ctx := context.Background()
	withRate(t, engine)
	// Put F1 back in force for later tests: a raise lands at once.
	t.Cleanup(func() { withRate(t, engine) })

	id := listingID()
	priced, err := engine.PriceListing(ctx, id, ledger.RegionAU, testCurrency, 1000)
	if err != nil {
		t.Fatal(err)
	}
	if priced.PricePoints != 334 { // ceil(1000 × 1e6 / 3e6)
		t.Fatalf("priced at %d points, want 334", priced.PricePoints)
	}
	if _, err := engine.RepriceListings(ctx); err != nil {
		t.Fatal(err)
	}

	cut := proposal(2_000_000, time.Now().Add(16*time.Minute))
	if err := engine.ProposeRate(ctx, cut); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.ApproveRate(ctx, cut.ID, "bob"); err != nil {
		t.Fatal(err)
	}

	if _, err := engine.RepriceListings(ctx); err != nil {
		t.Fatal(err)
	}
	if points, rateID := storedPrice(t, pool, id); points != 334 || rateID != priced.BackingRateID {
		t.Fatalf("repriced before the cut took effect: %d points at %s", points, rateID)
	}

	// Time passes: the superuser moves the cut's effective_from to now.
	if _, err := owner.Exec(ctx,
		`UPDATE ledger.backing_rate_approval SET effective_from = now() WHERE rate_id = $1`, cut.ID); err != nil {
		t.Fatal(err)
	}
	n, err := engine.RepriceListings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if n < 1 {
		t.Fatalf("repriced %d listings after the cut took effect", n)
	}
	if points, rateID := storedPrice(t, pool, id); points != 500 || rateID != cut.ID {
		t.Fatalf("after the cut: %d points at %s, want 500 at %s", points, rateID, cut.ID)
	}
	if n, err := engine.RepriceListings(ctx); err != nil || n != 0 {
		t.Fatalf("a second run repriced %d listings (err %v), want 0", n, err)
	}
}

func TestTheAppRoleReadsPointsButNeverTheListingPriceRow(t *testing.T) {
	engine, _ := newEngine(t)
	app := connect(t, "DATABASE_URL")
	ctx := context.Background()
	withRate(t, engine)

	id := listingID()
	if _, err := engine.PriceListing(ctx, id, ledger.RegionAU, testCurrency, 1000); err != nil {
		t.Fatal(err)
	}
	var points int64
	var region, currency string
	if err := app.QueryRow(ctx,
		`SELECT points, region, currency FROM platform.listing_points WHERE listing_id = $1`, id,
	).Scan(&points, &region, &currency); err != nil {
		t.Fatalf("yourtal_app reading platform.listing_points: %v", err)
	}
	if points != 334 || region != "AU" || currency != testCurrency {
		t.Errorf("read %d %s %s, want 334 AU AUD", points, region, currency)
	}

	var cols []string
	rows, err := app.Query(ctx, `SELECT column_name FROM information_schema.columns
		WHERE table_schema = 'platform' AND table_name = 'listing_points' ORDER BY column_name`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			t.Fatal(err)
		}
		cols = append(cols, c)
	}
	if want := []string{"currency", "listing_id", "points", "region"}; !slices.Equal(cols, want) {
		t.Errorf("platform.listing_points exposes %v, want only %v", cols, want)
	}

	_, err = app.Exec(ctx, `SELECT 1 FROM ledger.listing_price LIMIT 1`)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
		t.Fatalf("yourtal_app reading ledger.listing_price: err = %v, want permission denied", err)
	}
}
