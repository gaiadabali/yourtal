// Package ledgertest gives tests the points a scenario needs, posted the
// way the Reward Engine posts them: the grant transfer and its ledger.grant
// row in one transaction, from a partner allocation a purchase paid for.
// The database refuses points issued any other way (4.10.b, EM-02).
package ledgertest

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

var counter atomic.Uint64

func unique(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano(), counter.Add(1))
}

// PartnerAllocation buys one pack at the region's issue price and returns
// the allocation it opened.
func PartnerAllocation(t *testing.T, pool *pgxpool.Pool, region ledger.Region) string {
	t.Helper()
	engine := reward.New(pool, ledger.New(pool), reward.AlwaysAllow{}, region)
	if err := engine.EnsureChart(context.Background()); err != nil {
		t.Fatal(err)
	}
	price := int64(9_000) // IDR 9 a point
	if region == ledger.RegionAU {
		price = 4_500 // 4.5¢ a point
	}
	bought, err := engine.RecordPurchase(context.Background(), reward.PurchaseRequest{
		ID: unique("pur"), PartnerID: unique("partner"), Points: 1_000,
		AmountMinor: price, Currency: string(region.Currency()),
	})
	if err != nil {
		t.Fatalf("buying a pack for a test grant: %v", err)
	}
	return bought.AllocationID
}

// Grant posts `entries` (which issue points to user) and the grant row that
// accounts for them, in one transaction, and returns the transfer id.
func Grant(t *testing.T, pool *pgxpool.Pool, region ledger.Region, allocation, user string, points int64, entries []ledger.Entry) string {
	t.Helper()
	transferID, err := TryGrant(pool, region, allocation, user, points, entries)
	if err != nil {
		t.Fatalf("posting a test grant: %v", err)
	}
	return transferID
}

// TryGrant is Grant for a test that expects the database to refuse it.
func TryGrant(pool *pgxpool.Pool, region ledger.Region, allocation, user string, points int64, entries []ledger.Entry) (string, error) {
	ctx := context.Background()
	book := ledger.New(pool)
	var transferID string
	r := string(region)
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		posted, err := book.TransferInTx(ctx, tx, ledger.TransferRequest{
			ID: unique("t_grant"), IdempotencyKey: unique("k_grant"), ReasonCode: "test_grant", Entries: entries,
		})
		if err != nil {
			return err
		}
		transferID = posted.TransferID
		_, err = sqlcgen.New(tx).InsertGrant(ctx, sqlcgen.InsertGrantParams{
			ID: unique("grant"), UserID: user, ActionType: "goodwill", TaxonomyVer: 1, Points: points,
			AllocationID: allocation, TransferID: transferID, ExternalRef: unique("ref"), Region: &r,
		})
		return err
	})
	return transferID, err
}

// PartnerGrant issues `points` to user's pending from a fresh partner
// allocation, and returns the transfer id.
func PartnerGrant(t *testing.T, pool *pgxpool.Pool, region ledger.Region, user string, points int64) string {
	t.Helper()
	return Grant(t, pool, region, PartnerAllocation(t, pool, region), user, points, ledger.GrantPartner(region, user, points))
}
