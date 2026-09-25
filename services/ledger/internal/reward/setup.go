package reward

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// EnsureChart creates the platform accounts the posting rules reference.
//
// Called once at startup rather than lazily on every grant. Lazy creation
// would work — the inserts are ON CONFLICT DO NOTHING — but it would hide
// setup inside the hot path and make "which accounts does this deployment
// have" a question you answer by reading the grant code. An explicit step is
// also the thing an operator can run and check.
func (e *Engine) EnsureChart(ctx context.Context) error {
	queries := sqlcgen.New(e.pool)

	for _, account := range ledger.PlatformChart(e.country) {
		if err := queries.InsertAccount(ctx, sqlcgen.InsertAccountParams{
			ID:        account.ID,
			OwnerType: string(account.OwnerType),
			OwnerID:   account.OwnerID,
			Currency:  string(account.Currency),
			Kind:      string(account.Kind),
			Country:   account.Country,
		}); err != nil {
			return fmt.Errorf("creating %s: %w", account.ID, err)
		}
	}
	return nil
}

// CreateAllocation records a funded block of points the engine may draw on.
//
// The CASH that backed a partner's purchase is recorded separately, when the
// purchase happens (YT-0046) — not here, and not at issuance. That split is
// what let docs/16 K6's structural half be enforced before its valuation
// half (the backing rate) existed: this counts points, and a block of N
// points is N points whatever an IDR integer denominates.
func (e *Engine) CreateAllocation(
	ctx context.Context, id, funderType, funderID string, points int64,
) error {
	if funderType != "partner" && funderType != "marketing" {
		return fmt.Errorf("reward: unknown funder type %q", funderType)
	}

	if err := sqlcgen.New(e.pool).InsertAllocation(ctx, sqlcgen.InsertAllocationParams{
		ID:          id,
		FunderType:  funderType,
		FunderID:    funderID,
		TotalPoints: points,
	}); err != nil {
		return fmt.Errorf("creating allocation %s: %w", id, err)
	}
	return nil
}

// RemainingPoints reports what is left in an allocation. Read-only; the only
// thing that moves it is the drawdown inside a grant.
func (e *Engine) RemainingPoints(ctx context.Context, allocationID string) (int64, error) {
	allocation, err := sqlcgen.New(e.pool).GetAllocation(ctx, allocationID)
	if err != nil {
		return 0, fmt.Errorf("reading allocation %s: %w", allocationID, err)
	}
	return allocation.RemainingPoints, nil
}

// uniqueViolation is Postgres's SQLSTATE for a duplicate key.
const uniqueViolation = "23505"

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == uniqueViolation
}
