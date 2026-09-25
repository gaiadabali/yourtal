package reward

import (
	"context"
	"fmt"
	"time"

	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// Allocation holds (4.4.e). At reward-session start the caller holds the
// session's base plus maximum bonus, so the grant at the end cannot be
// refused for an exhausted allocation. The grant consumes the hold; an
// abandoned one is released, or expires and is released by ReleaseExpired.

// HoldRequest reserves points for one reward session.
type HoldRequest struct {
	ID           string // the caller's id for the session's hold; idempotent
	AllocationID string
	Points       int64
	// TTL is how long the session may run: 2 × the video's duration + 1 h.
	TTL time.Duration
}

// Hold reserves points, or returns ErrAllocationExhausted.
func (e *Engine) Hold(ctx context.Context, req HoldRequest) error {
	held, err := sqlcgen.New(e.pool).HoldAllocation(ctx, sqlcgen.HoldAllocationParams{
		HoldID: req.ID, AllocationID: req.AllocationID, Points: req.Points,
		TtlSeconds: int64(req.TTL / time.Second),
	})
	if err != nil {
		return fmt.Errorf("holding %d points on %s: %w", req.Points, req.AllocationID, err)
	}
	if !held {
		return fmt.Errorf("%w: %s cannot hold %d points", ErrAllocationExhausted, req.AllocationID, req.Points)
	}
	return nil
}

// Release gives an abandoned session's points back. False when the hold was
// already consumed or released.
func (e *Engine) Release(ctx context.Context, holdID string) (bool, error) {
	return sqlcgen.New(e.pool).ReleaseHold(ctx, holdID)
}

// ReleaseExpired releases every hold past its TTL; the ledger runs it on its
// checker loop.
func (e *Engine) ReleaseExpired(ctx context.Context) (int32, error) {
	return sqlcgen.New(e.pool).ReleaseExpiredHolds(ctx)
}

// ReturnGrant puts a reversed grant's points back on its allocation, once.
func (e *Engine) ReturnGrant(ctx context.Context, grantID string) (bool, error) {
	return sqlcgen.New(e.pool).ReturnGrant(ctx, grantID)
}

// drawFor takes a grant's points from its allocation inside the grant's
// transaction: from the session's hold when it is still live, otherwise by
// holding and consuming at once. Returns the allocation it drew.
func drawFor(ctx context.Context, q *sqlcgen.Queries, req GrantRequest, ref string, points int64) (sqlcgen.GetAllocationRow, error) {
	if req.HoldID != "" {
		allocationID, err := q.ConsumeHold(ctx, sqlcgen.ConsumeHoldParams{HoldID: req.HoldID, Points: points})
		if err != nil {
			return sqlcgen.GetAllocationRow{}, fmt.Errorf("consuming hold %s: %w", req.HoldID, err)
		}
		if allocationID != "" {
			if allocationID != req.AllocationID {
				return sqlcgen.GetAllocationRow{}, fmt.Errorf("%w: hold %s is on %s, not %s",
					ErrWrongFunder, req.HoldID, allocationID, req.AllocationID)
			}
			return q.GetAllocation(ctx, allocationID)
		}
		// The hold expired or was released: draw directly if there is room.
	}
	inline := "grant_" + ref
	held, err := q.HoldAllocation(ctx, sqlcgen.HoldAllocationParams{
		HoldID: inline, AllocationID: req.AllocationID, Points: points, TtlSeconds: 60,
	})
	if err != nil {
		return sqlcgen.GetAllocationRow{}, fmt.Errorf("drawing down allocation: %w", err)
	}
	if !held {
		return sqlcgen.GetAllocationRow{}, fmt.Errorf("%w: %s cannot fund %d points",
			ErrAllocationExhausted, req.AllocationID, points)
	}
	if _, err := q.ConsumeHold(ctx, sqlcgen.ConsumeHoldParams{HoldID: inline, Points: points}); err != nil {
		return sqlcgen.GetAllocationRow{}, fmt.Errorf("consuming the draw: %w", err)
	}
	return q.GetAllocation(ctx, req.AllocationID)
}
