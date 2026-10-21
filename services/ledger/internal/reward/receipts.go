package reward

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/settings"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// Receipt points are paid by the partner's receipt package (F127, docs/27
// §3.3): the business named by the region's `receipt_funder.<partnerId>`
// setting buys packages at cost, and each receipt draws its points from the
// oldest one with room. When none has room, receipts stop earning.

// drawReceipt takes a receipt's points from the funder's oldest receipt
// package that can pay all of them, inside the grant's transaction. A grant
// is never split. No funder, no package or no room is ErrAllocationExhausted.
func (e *Engine) drawReceipt(
	ctx context.Context, tx pgx.Tx, q *sqlcgen.Queries, partnerID, ref string, points int64,
) (sqlcgen.GetAllocationRow, error) {
	if partnerID == "" {
		return sqlcgen.GetAllocationRow{}, errNoPartner
	}
	region := string(e.region)
	funder, ok, err := settings.ReceiptFunderFor(ctx, tx, region, partnerID)
	if err != nil {
		return sqlcgen.GetAllocationRow{}, err
	}
	if !ok {
		return sqlcgen.GetAllocationRow{}, fmt.Errorf("%w: %s has no receipt funder in %s",
			ErrAllocationExhausted, partnerID, region)
	}
	// The draw's hold id is the grant's own; it exists only once this
	// receipt was paid, by a request that raced this one past the replay.
	inline := "grant_" + ref
	if _, err := q.GetHold(ctx, inline); err == nil {
		return sqlcgen.GetAllocationRow{}, fmt.Errorf("%w: %s", ErrAlreadyGranted, ref)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return sqlcgen.GetAllocationRow{}, fmt.Errorf("reading the draw's hold: %w", err)
	}
	packages, err := q.ReceiptPackagesWithRoom(ctx, sqlcgen.ReceiptPackagesWithRoomParams{
		FunderID: funder, Region: region, Points: points,
	})
	if err != nil {
		return sqlcgen.GetAllocationRow{}, fmt.Errorf("listing receipt packages: %w", err)
	}
	for _, pkg := range packages {
		held, err := q.HoldAllocation(ctx, sqlcgen.HoldAllocationParams{
			HoldID: inline, AllocationID: pkg.AllocationID, Points: points, TtlSeconds: 60,
		})
		if err != nil {
			return sqlcgen.GetAllocationRow{}, fmt.Errorf("drawing receipt package %s: %w", pkg.AllocationID, err)
		}
		if !held {
			continue
		}
		if _, err := q.ConsumeHold(ctx, sqlcgen.ConsumeHoldParams{HoldID: inline, Points: points}); err != nil {
			return sqlcgen.GetAllocationRow{}, fmt.Errorf("consuming the draw: %w", err)
		}
		return q.GetAllocation(ctx, pkg.AllocationID)
	}
	return sqlcgen.GetAllocationRow{}, fmt.Errorf("%w: %s's receipt packages in %s have no room for %d points",
		ErrAllocationExhausted, partnerID, region, points)
}

// lockReceiptsSession serialises one partner's receipts in a region on the
// connection, before the grant's transaction begins, as Engine.issue does
// for the user: every receipt draws the same package row, and without the
// lock concurrent receipts abort each other under SERIALIZABLE until their
// retries run out. The returned func releases it.
func lockReceiptsSession(ctx context.Context, conn *pgxpool.Conn, region ledger.Region, partnerID string) (func(), error) {
	key := "ledger.receipts:" + string(region) + ":" + partnerID
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(hashtextextended($1::text, 0))`, key); err != nil {
		return nil, fmt.Errorf("locking the partner's receipts: %w", err)
	}
	return func() {
		_, _ = conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock(hashtextextended($1::text, 0))`, key)
	}, nil
}

// errNoPartner: a receipt names the partner that reported it, whose funder
// pays it. ErrWrongFunder, so the contract answers 400 refused.
var errNoPartner = fmt.Errorf("%w: a receipt grant names the partner that reported it", ErrWrongFunder)

// refuseReceiptPackage: a receipt package pays receipts only, never a
// campaign's hold or grant.
func refuseReceiptPackage(ctx context.Context, q *sqlcgen.Queries, allocationID string) error {
	is, err := q.IsReceiptPackage(ctx, allocationID)
	if err != nil {
		return fmt.Errorf("reading allocation %s: %w", allocationID, err)
	}
	if is {
		return fmt.Errorf("%w: allocation %s is a receipt package; it pays receipts only", ErrWrongFunder, allocationID)
	}
	return nil
}
