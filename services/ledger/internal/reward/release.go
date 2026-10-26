package reward

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// Holdback release (4.4.g). A grant waits in pending until its unlock_at,
// then moves to available: Dr user.pending / Cr user.available, recorded in
// ledger.grant_release so it happens once.

// releaseInTx releases one grant inside the caller's transaction.
func (e *Engine) releaseInTx(ctx context.Context, tx pgx.Tx, q *sqlcgen.Queries, grantID, userID string, points int64) error {
	transfer, err := e.ledger.TransferInTx(ctx, tx, ledger.TransferRequest{
		ID: "led_txn_release_" + grantID, IdempotencyKey: "release_" + grantID,
		ReasonCode: "holdback_release", Entries: ledger.Release(userID, points),
	})
	if err != nil {
		return err
	}
	if _, err := q.InsertGrantRelease(ctx, sqlcgen.InsertGrantReleaseParams{
		GrantID: grantID, TransferID: transfer.TransferID,
	}); err != nil {
		return fmt.Errorf("recording the release of %s: %w", grantID, err)
	}
	return nil
}

// ReleaseDue releases up to limit grants whose holdback has passed, each in
// its own transaction, and reports how many. The ledger runs it on its loop.
// A user with a held escrow is skipped (4.4.g): their pending stays pending,
// with its unlock times, until the escrow is released. The list query skips
// them, and the transaction re-checks so an escrow that lands in between wins.
func ReleaseDue(ctx context.Context, pool ledgerPool, book *ledger.Ledger, limit int32) (int, error) {
	due, err := sqlcgen.New(pool).ListUnlockedGrants(ctx, limit)
	if err != nil {
		return 0, fmt.Errorf("listing grants due for release: %w", err)
	}
	released := 0
	engine := &Engine{ledger: book}
	for _, grant := range due {
		err := pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{IsoLevel: pgx.Serializable}, func(tx pgx.Tx) error {
			q := sqlcgen.New(tx)
			held, err := q.UserHasHeldEscrow(ctx, grant.UserID)
			if err != nil {
				return err
			}
			if held {
				return errEscrowHeld
			}
			return engine.releaseInTx(ctx, tx, q, grant.ID, grant.UserID, grant.Points)
		})
		if err != nil {
			continue // left due; the next run retries it
		}
		released++
	}
	return released, nil
}

// RunReleaser is what actually calls ReleaseDue: nothing else does, so without it
// a grant's holdback passes and its points stay pending for good. It runs one pass
// at once and then every interval until ctx ends, draining a backlog (a full page
// means more are due) before it waits. after sees each pass's count and error;
// an error never stops the loop, because the next pass retries what was left.
func RunReleaser(
	ctx context.Context, pool ledgerPool, book *ledger.Ledger, every time.Duration, limit int32,
	after func(released int, err error),
) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		for {
			released, err := ReleaseDue(ctx, pool, book, limit)
			after(released, err)
			if err != nil || released < int(limit) || ctx.Err() != nil {
				break
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// errEscrowHeld leaves a grant due while its user's escrow is held.
var errEscrowHeld = errors.New("reward: the user's points are in escrow")

// ledgerPool is the part of *pgxpool.Pool ReleaseDue needs.
type ledgerPool interface {
	sqlcgen.DBTX
	BeginTx(ctx context.Context, opts pgx.TxOptions) (pgx.Tx, error)
}

// optionalUUID is a NULL uuid for "" or anything that is not a uuid.
func optionalUUID(value string) pgtype.UUID {
	var parsed pgtype.UUID
	if value == "" || parsed.Scan(value) != nil {
		return pgtype.UUID{}
	}
	return parsed
}
