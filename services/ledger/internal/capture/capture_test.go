package capture_test

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/capture"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
	"github.com/yourtal/services/ledger/internal/testdb"
)

var counter atomic.Uint64

func unique(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano(), counter.Add(1))
}

type fixture struct {
	engine *capture.Engine
	pool   *pgxpool.Pool
}

// newFixture ensures the platform chart exists (voucher_liability is the
// posting rule's debit side) — the same setup main.go's boot now does, and
// the same workaround internal/burn's own tests already use for the same
// reason.
func newFixture(t *testing.T) *fixture {
	t.Helper()
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testdb.URL(t, "LEDGER_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	for _, region := range []ledger.Region{ledger.RegionAU, ledger.RegionID} {
		for _, a := range ledger.PlatformChart(region) {
			if err := sqlcgen.New(pool).InsertAccount(ctx, sqlcgen.InsertAccountParams{
				ID: a.ID, OwnerType: string(a.OwnerType), OwnerID: a.OwnerID,
				Currency: string(a.Currency), Kind: string(a.Kind), Country: a.Country, Purpose: string(a.Purpose),
			}); err != nil {
				t.Fatal(err)
			}
		}
	}

	return &fixture{engine: capture.New(pool, ledger.New(pool)), pool: pool}
}

func TestPostCapturesAVoucherAndPaysTheMerchant(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	merchantID := unique("mer")

	posted, err := f.engine.Post(ctx, capture.Request{
		CaptureID: unique("cap"), Region: ledger.RegionAU, MerchantID: merchantID,
		AmountMinor: 5_000, Currency: "AUD",
	})
	if err != nil {
		t.Fatalf("Post: %v", err)
	}
	if posted.TransferID == "" {
		t.Error("no transfer id recorded")
	}

	balance, err := ledger.New(f.pool).Balance(ctx, ledger.MerchantPayableID(merchantID, ledger.RegionAU))
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if balance != 5_000 {
		t.Errorf("merchant payable balance = %d, want 5000", balance)
	}
}

func TestPostReplaysRatherThanPostingTwice(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	req := capture.Request{
		CaptureID: unique("cap"), Region: ledger.RegionID, MerchantID: unique("mer"),
		AmountMinor: 9_000, Currency: "IDR",
	}

	first, err := f.engine.Post(ctx, req)
	if err != nil {
		t.Fatalf("first Post: %v", err)
	}
	second, err := f.engine.Post(ctx, req)
	if err != nil {
		t.Fatalf("second Post: %v", err)
	}
	if first.TransferID != second.TransferID {
		t.Errorf("a replayed capture posted a second transfer: %s vs %s", first.TransferID, second.TransferID)
	}

	balance, err := ledger.New(f.pool).Balance(ctx, ledger.MerchantPayableID(req.MerchantID, ledger.RegionID))
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if balance != 9_000 {
		t.Errorf("balance = %d after a replay, want 9000 (posted once)", balance)
	}
}

func TestPostRefusesADifferentAmountForTheSameCaptureID(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	captureID := unique("cap")
	merchantID := unique("mer")

	if _, err := f.engine.Post(ctx, capture.Request{
		CaptureID: captureID, Region: ledger.RegionAU, MerchantID: merchantID, AmountMinor: 1_000, Currency: "AUD",
	}); err != nil {
		t.Fatalf("first Post: %v", err)
	}

	_, err := f.engine.Post(ctx, capture.Request{
		CaptureID: captureID, Region: ledger.RegionAU, MerchantID: merchantID, AmountMinor: 2_000, Currency: "AUD",
	})
	if !errors.Is(err, ledger.ErrIdempotencyConflict) {
		t.Fatalf("a different amount for the same captureId gave %v, want ErrIdempotencyConflict", err)
	}
}

func TestPostRefusesACurrencyThatDoesNotMatchTheRegion(t *testing.T) {
	f := newFixture(t)
	_, err := f.engine.Post(context.Background(), capture.Request{
		CaptureID: unique("cap"), Region: ledger.RegionAU, MerchantID: unique("mer"),
		AmountMinor: 1_000, Currency: "IDR",
	})
	if !errors.Is(err, capture.ErrRegionMismatch) {
		t.Fatalf("an AUD region with an IDR currency gave %v, want ErrRegionMismatch", err)
	}
}

func TestGetRefusesAnUnknownCaptureID(t *testing.T) {
	f := newFixture(t)
	_, err := f.engine.Get(context.Background(), unique("cap"))
	if !errors.Is(err, capture.ErrNotFound) {
		t.Fatalf("Get on an unknown captureId gave %v, want ErrNotFound", err)
	}
}
