// Package escrow freezes a user's points without zeroing them (9.4.b) and
// releases them exactly once. Points come from available first, then
// pending; the split is recorded so the release returns each part where it
// came from. Pending points keep their grants' unlock times: holdback
// release skips a user while any escrow is held (4.4.g), so once released
// the grants unlock as they would have.
package escrow

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

var (
	// ErrNotFound — no escrow has that id.
	ErrNotFound = errors.New("escrow: not found")
	// ErrInvalid — the request lacks a user, positive points or a reason.
	ErrInvalid = errors.New("escrow: a user, positive points and a reason are required")
)

// Request is one escrow. An empty IdempotencyKey makes every call a new one.
type Request struct {
	UserID         string
	Points         int64
	Reason         string
	IdempotencyKey string
}

// Escrow is one held or released escrow.
type Escrow struct {
	ID              string
	UserID          string
	Region          ledger.Region
	Points          int64
	AvailablePoints int64
	PendingPoints   int64
	Reason          string
	Released        bool
}

// Engine is the escrow side of the ledger.
type Engine struct {
	pool   *pgxpool.Pool
	ledger *ledger.Ledger
}

func New(pool *pgxpool.Pool, book *ledger.Ledger) *Engine {
	return &Engine{pool: pool, ledger: book}
}

// Hold moves req.Points into the user's escrow account, from available
// first and then pending. Nothing to take is ledger.ErrInsufficientFunds. A
// replay returns the original; the same key with other terms is
// ledger.ErrIdempotencyConflict.
func (e *Engine) Hold(ctx context.Context, req Request) (Escrow, error) {
	if req.UserID == "" || req.Points <= 0 || req.Reason == "" {
		return Escrow{}, ErrInvalid
	}
	if req.IdempotencyKey == "" {
		req.IdempotencyKey = rand.Text()
	}
	if prior, err := e.byKey(ctx, req); !errors.Is(err, ErrNotFound) {
		return prior, err
	}

	id := "esc_" + rand.Text()
	err := ledger.WithSerializableRetry(ctx, e.pool, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		availableID := ledger.UserAccountID(req.UserID, ledger.PurposeAvailable)
		pendingID := ledger.UserAccountID(req.UserID, ledger.PurposePending)
		account, err := q.GetAccount(ctx, availableID)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: user %s has no points", ledger.ErrInsufficientFunds, req.UserID)
		}
		if err != nil {
			return fmt.Errorf("reading the user's points account: %w", err)
		}
		// Lock both before reading, in id order, so the split is the one posted.
		for _, accountID := range []string{availableID, pendingID} {
			if err := q.LockAccount(ctx, accountID); err != nil {
				return fmt.Errorf("locking %s: %w", accountID, err)
			}
		}
		available, err := balance(ctx, q, availableID)
		if err != nil {
			return err
		}
		pending, err := balance(ctx, q, pendingID)
		if err != nil {
			return err
		}
		fromAvailable := min(req.Points, available)
		fromPending := req.Points - fromAvailable
		if fromPending > pending {
			return fmt.Errorf("%w: user %s holds %d, the escrow takes %d",
				ledger.ErrInsufficientFunds, req.UserID, available+pending, req.Points)
		}
		transfer, err := e.ledger.TransferInTx(ctx, tx, ledger.TransferRequest{
			ID: transferID(id), IdempotencyKey: "escrow_" + id,
			ReasonCode: "escrow", Entries: ledger.Suspend(req.UserID, fromAvailable, fromPending),
		})
		if err != nil {
			return err
		}
		return q.InsertEscrow(ctx, sqlcgen.InsertEscrowParams{
			ID: id, IdempotencyKey: req.IdempotencyKey, UserID: req.UserID, Region: account.Country,
			Points: req.Points, AvailablePoints: fromAvailable, PendingPoints: fromPending,
			Reason: req.Reason, TransferID: transfer.TransferID,
		})
	})
	if err != nil {
		// A concurrent double submit loses on the key: the winner is the answer.
		if prior, getErr := e.byKey(ctx, req); getErr == nil {
			return prior, nil
		}
		return Escrow{}, err
	}
	return e.Get(ctx, id)
}

// Release returns an escrow's points, each part to the account it came from,
// as the exact reversal of its hold. A second call is a no-op.
func (e *Engine) Release(ctx context.Context, escrowID string) (Escrow, error) {
	held, err := e.Get(ctx, escrowID)
	if err != nil || held.Released {
		return held, err
	}
	err = ledger.WithSerializableRetry(ctx, e.pool, func(tx pgx.Tx) error {
		transfer, err := e.ledger.TransferInTx(ctx, tx, ledger.TransferRequest{
			ID: "led_txn_escrow_release_" + escrowID, IdempotencyKey: "escrow_release_" + escrowID,
			ReasonCode: "escrow_release", Reverses: transferID(escrowID),
			Entries: ledger.Reverse(ledger.Suspend(held.UserID, held.AvailablePoints, held.PendingPoints)),
		})
		if err != nil {
			return err
		}
		_, err = sqlcgen.New(tx).InsertEscrowRelease(ctx, sqlcgen.InsertEscrowReleaseParams{
			EscrowID: escrowID, TransferID: transfer.TransferID,
		})
		return err
	})
	if err != nil {
		return Escrow{}, err
	}
	return e.Get(ctx, escrowID)
}

// Get reads one escrow.
func (e *Engine) Get(ctx context.Context, escrowID string) (Escrow, error) {
	row, err := sqlcgen.New(e.pool).GetEscrow(ctx, escrowID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Escrow{}, fmt.Errorf("%w: %s", ErrNotFound, escrowID)
	}
	if err != nil {
		return Escrow{}, fmt.Errorf("reading escrow %s: %w", escrowID, err)
	}
	return Escrow{
		ID: row.ID, UserID: row.UserID, Region: ledger.Region(row.Region), Points: row.Points,
		AvailablePoints: row.AvailablePoints, PendingPoints: row.PendingPoints, Reason: row.Reason,
		Released: row.ReleasedAt.Valid,
	}, nil
}

// byKey is the escrow this key already made, or ErrNotFound.
func (e *Engine) byKey(ctx context.Context, req Request) (Escrow, error) {
	id, err := sqlcgen.New(e.pool).GetEscrowByIdempotencyKey(ctx, req.IdempotencyKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return Escrow{}, ErrNotFound
	}
	if err != nil {
		return Escrow{}, fmt.Errorf("reading the escrow for key %s: %w", req.IdempotencyKey, err)
	}
	prior, err := e.Get(ctx, id)
	if err != nil {
		return Escrow{}, err
	}
	if prior.UserID != req.UserID || prior.Points != req.Points || prior.Reason != req.Reason {
		return Escrow{}, fmt.Errorf("%w: key %s already escrowed %d points", ledger.ErrIdempotencyConflict, req.IdempotencyKey, prior.Points)
	}
	return prior, nil
}

func transferID(escrowID string) string { return "led_txn_escrow_" + escrowID }

func balance(ctx context.Context, q *sqlcgen.Queries, accountID string) (int64, error) {
	value, err := q.GetAccountBalance(ctx, accountID)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("reading the balance of %s: %w", accountID, err)
	}
	return value, nil
}
