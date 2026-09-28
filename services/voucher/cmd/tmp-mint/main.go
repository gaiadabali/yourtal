// Temporary, uncommitted bootstrap tool for Phase 8 C's manual e2e checks
// (8.3.d, 8.4.b): mints real voucher stock for two fixture listings using
// the real production issue.Minter, over the real running database. Not
// part of the shipped tree -- deleted before this session's work is merged.
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/keyring"
)

func main() {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("VOUCHER_DATABASE_URL"))
	if err != nil {
		panic(err)
	}
	defer pool.Close()

	keys, err := keyring.FromDirectory(os.Getenv("VOUCHER_KEY_DIR"))
	if err != nil {
		panic(err)
	}

	minter := issue.New(pool, keys)

	listings := map[string]string{
		"au": os.Args[1],
		"id": os.Args[2],
	}
	merchants := map[string]string{
		"au": "00000000-0000-4000-8000-000000000603",
		"id": "00000000-0000-4000-8000-000000000601",
	}

	for region, listingID := range listings {
		batchID := uuid.New()
		if err := minter.RequestBatch(ctx, issue.BatchRequest{
			ID:                 batchID,
			ListingID:          uuid.MustParse(listingID),
			SupplierBusinessID: uuid.MustParse(merchants[region]),
			RequestedBy:        "phase-8-c-e2e-bootstrap",
			Quantity:           3,
			Transferable:       false,
			FundingReference:   "phase-8-c-e2e-bootstrap",
		}); err != nil {
			panic(fmt.Errorf("%s RequestBatch: %w", region, err))
		}
		if err := minter.Approve(ctx, batchID, "phase-8-c-e2e-bootstrap-approver"); err != nil {
			panic(fmt.Errorf("%s Approve: %w", region, err))
		}
		result, err := minter.Mint(ctx, batchID)
		if err != nil {
			panic(fmt.Errorf("%s Mint: %w", region, err))
		}
		fmt.Printf("%s batch=%s vouchers=%v\n", region, batchID, result.VoucherIDs)
	}
}
