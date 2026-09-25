// Package burn turns a user's points into a voucher obligation exactly once
// per checkout saga, and undoes that exactly once when a merchant would not
// honour the voucher (K13). The /v1/burns route that calls it waits for the
// 1.2.a contract (4.3.e).
package burn

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

var (
	// ErrRegionMismatch — the user's points are in the other region. The
	// ledger re-checks this itself, whatever the caller already checked.
	ErrRegionMismatch = errors.New("burn: region mismatch")
	// ErrNotFound — no burn for this saga.
	ErrNotFound = errors.New("burn: no burn for this saga")
)

// Request is one checkout's burn: Points from the user's available balance,
// and SettlementMinor (the voucher's S) owed from then on.
type Request struct {
	SagaID          string
	UserID          string
	Region          ledger.Region
	Points          int64
	SettlementMinor int64
}

// Burn is what a saga burned, and whether it was reinstated.
type Burn struct {
	SagaID          string
	UserID          string
	Region          ledger.Region
	Points          int64
	SettlementMinor int64
	At              time.Time
	Reinstated      bool
}

// Engine is the burn side of the ledger.
type Engine struct {
	pool   *pgxpool.Pool
	ledger *ledger.Ledger
}

func New(pool *pgxpool.Pool, book *ledger.Ledger) *Engine {
	return &Engine{pool: pool, ledger: book}
}

// Burn posts both halves in one transaction, keyed by the saga: the points
// half (Dr user.available / Cr points_redeemed, refused below zero) and the
// liability half (Dr redemption_clearing / Cr voucher_liability at S). A
// replay returns the original burn; the same saga with other amounts is
// ledger.ErrIdempotencyConflict.
func (e *Engine) Burn(ctx context.Context, req Request) (Burn, error) {
	if req.SagaID == "" || req.Points <= 0 || req.SettlementMinor <= 0 {
		return Burn{}, fmt.Errorf("burn: a saga id, points and a settlement value are required")
	}
	if prior, err := e.Get(ctx, req.SagaID); err == nil {
		if prior.UserID != req.UserID || prior.Region != req.Region || prior.Points != req.Points ||
			prior.SettlementMinor != req.SettlementMinor {
			return Burn{}, fmt.Errorf("%w: saga %s already burned %d points", ledger.ErrIdempotencyConflict, req.SagaID, prior.Points)
		}
		return prior, nil
	} else if !errors.Is(err, ErrNotFound) {
		return Burn{}, err
	}

	err := ledger.WithSerializableRetry(ctx, e.pool, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)
		account, err := queries.GetAccount(ctx, ledger.UserAccountID(req.UserID, ledger.PurposeAvailable))
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: user %s has no points", ledger.ErrInsufficientFunds, req.UserID)
		}
		if err != nil {
			return fmt.Errorf("reading the user's points account: %w", err)
		}
		if account.Country != string(req.Region) {
			return fmt.Errorf("%w: user %s is in %s, the burn is in %s", ErrRegionMismatch, req.UserID, account.Country, req.Region)
		}
		pointsHalf, err := e.ledger.TransferInTx(ctx, tx, ledger.TransferRequest{
			ID: "led_txn_burn_points_" + req.SagaID, IdempotencyKey: "burn_" + req.SagaID,
			ReasonCode: "burn_points", Entries: ledger.BurnPoints(req.Region, req.UserID, req.Points),
		})
		if err != nil {
			return err
		}
		liabilityHalf, err := e.ledger.TransferInTx(ctx, tx, ledger.TransferRequest{
			ID: "led_txn_burn_liability_" + req.SagaID, IdempotencyKey: "burn_liability_" + req.SagaID,
			ReasonCode: "burn_liability", Entries: ledger.BurnLiability(req.Region, req.SettlementMinor),
		})
		if err != nil {
			return err
		}
		return queries.InsertBurn(ctx, sqlcgen.InsertBurnParams{
			SagaID: req.SagaID, UserID: req.UserID, Region: string(req.Region), Points: req.Points,
			SettlementMinor: req.SettlementMinor, PointsTransferID: pointsHalf.TransferID,
			LiabilityTransferID: liabilityHalf.TransferID,
		})
	})
	if err != nil {
		// A concurrent double submit loses on the saga's key: the burn that
		// won is the answer, if it is this same request.
		if prior, getErr := e.Get(ctx, req.SagaID); getErr == nil && prior.Points == req.Points &&
			prior.SettlementMinor == req.SettlementMinor && prior.UserID == req.UserID {
			return prior, nil
		}
		return Burn{}, err
	}
	return e.Get(ctx, req.SagaID)
}

// Get is getBurn: what a saga burned. The checkout's recovery job uses it to
// decide whether to activate a reserved voucher or release it.
func (e *Engine) Get(ctx context.Context, sagaID string) (Burn, error) {
	row, err := sqlcgen.New(e.pool).GetBurn(ctx, sagaID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Burn{}, fmt.Errorf("%w: %s", ErrNotFound, sagaID)
	}
	if err != nil {
		return Burn{}, fmt.Errorf("reading burn %s: %w", sagaID, err)
	}
	return Burn{
		SagaID: row.SagaID, UserID: row.UserID, Region: ledger.Region(row.Region), Points: row.Points,
		SettlementMinor: row.SettlementMinor, At: row.CreatedAt.Time, Reinstated: row.ReinstatedAt.Valid,
	}, nil
}

// Reinstate is K13's reinstateBurn: the voucher was voided before capture, so
// the exact points return to available at once and the voucher obligation is
// released. Both halves are exact reversals naming their originals; a second
// call is a no-op.
func (e *Engine) Reinstate(ctx context.Context, sagaID, reason string) (Burn, error) {
	burned, err := e.Get(ctx, sagaID)
	if err != nil {
		return Burn{}, err
	}
	if burned.Reinstated {
		return burned, nil
	}
	err = ledger.WithSerializableRetry(ctx, e.pool, func(tx pgx.Tx) error {
		pointsBack, err := e.ledger.TransferInTx(ctx, tx, ledger.TransferRequest{
			ID: "led_txn_reinstate_points_" + sagaID, IdempotencyKey: "reinstate_" + sagaID,
			ReasonCode: "reinstate_burn", Reverses: "led_txn_burn_points_" + sagaID,
			Entries: ledger.Reverse(ledger.BurnPoints(burned.Region, burned.UserID, burned.Points)),
		})
		if err != nil {
			return err
		}
		liabilityBack, err := e.ledger.TransferInTx(ctx, tx, ledger.TransferRequest{
			ID: "led_txn_reinstate_liability_" + sagaID, IdempotencyKey: "reinstate_liability_" + sagaID,
			ReasonCode: "reinstate_burn", Reverses: "led_txn_burn_liability_" + sagaID,
			Entries: ledger.Reverse(ledger.BurnLiability(burned.Region, burned.SettlementMinor)),
		})
		if err != nil {
			return err
		}
		return sqlcgen.New(tx).InsertBurnReinstatement(ctx, sqlcgen.InsertBurnReinstatementParams{
			SagaID: sagaID, PointsTransferID: pointsBack.TransferID,
			LiabilityTransferID: liabilityBack.TransferID, Reason: reason,
		})
	})
	if err != nil {
		return Burn{}, err
	}
	return e.Get(ctx, sagaID)
}
