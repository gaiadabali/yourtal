// Package capture posts a voucher capture to the ledger (4.6.f.2): the
// merchant was honoured, so voucher liability moves to the merchant's
// payable. services/voucher drains its capture_outbox into this over signed
// HTTP; the outbox lives in the voucher schema, which the ledger cannot read.
package capture

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

// ErrRegionMismatch: the currency is not the region's, or the merchant is
// already paid in the other region (AU and ID never share a merchant).
var ErrRegionMismatch = errors.New("capture: region mismatch")

// ErrNotFound: no capture recorded for this id.
var ErrNotFound = errors.New("capture: not found")

// Request is one capture the voucher service asks the ledger to post.
type Request struct {
	CaptureID   string
	Region      ledger.Region
	MerchantID  string
	AmountMinor int64
	Currency    string
}

// Posting is what was recorded, identical on a replay.
type Posting struct {
	CaptureID   string
	Region      ledger.Region
	MerchantID  string
	AmountMinor int64
	Currency    string
	TransferID  string
	At          time.Time
}

func (p Posting) sameTerms(r Request) bool {
	return p.Region == r.Region && p.MerchantID == r.MerchantID &&
		p.AmountMinor == r.AmountMinor && p.Currency == r.Currency
}

// Engine posts captures for both regions; the region is on each request.
type Engine struct {
	pool   *pgxpool.Pool
	ledger *ledger.Ledger
}

func New(pool *pgxpool.Pool, book *ledger.Ledger) *Engine {
	return &Engine{pool: pool, ledger: book}
}

// Post posts ledger.Capture keyed on the capture id, with the transfer and
// the capture row in one transaction. A replay returns the original posting;
// the same id with other terms is ledger.ErrIdempotencyConflict.
func (e *Engine) Post(ctx context.Context, req Request) (Posting, error) {
	if req.CaptureID == "" || req.MerchantID == "" || req.AmountMinor <= 0 {
		return Posting{}, fmt.Errorf("capture: captureId, merchantId and a positive amountMinor are required")
	}
	if req.Region != ledger.RegionAU && req.Region != ledger.RegionID {
		return Posting{}, fmt.Errorf("%w: unknown region %q", ErrRegionMismatch, req.Region)
	}
	if req.Currency != string(req.Region.Currency()) {
		return Posting{}, fmt.Errorf("%w: %s is not %s's currency", ErrRegionMismatch, req.Currency, req.Region)
	}
	if prior, err := e.Get(ctx, req.CaptureID); err == nil {
		if !prior.sameTerms(req) {
			return Posting{}, fmt.Errorf("%w: capture %s was posted with other terms", ledger.ErrIdempotencyConflict, req.CaptureID)
		}
		return prior, nil
	} else if !errors.Is(err, ErrNotFound) {
		return Posting{}, err
	}

	err := ledger.WithSerializableRetry(ctx, e.pool, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)
		if err := ensureMerchantPayable(ctx, queries, req.MerchantID, req.Region); err != nil {
			return err
		}
		posted, err := e.ledger.TransferInTx(ctx, tx, ledger.TransferRequest{
			ID: "led_txn_capture_" + req.CaptureID, IdempotencyKey: "capture_" + req.CaptureID,
			ReasonCode: "capture", Entries: ledger.Capture(req.Region, req.MerchantID, req.AmountMinor),
		})
		if err != nil {
			return err
		}
		return queries.InsertCapture(ctx, sqlcgen.InsertCaptureParams{
			CaptureID: req.CaptureID, Region: string(req.Region), MerchantID: req.MerchantID,
			AmountMinor: req.AmountMinor, Currency: req.Currency, TransferID: posted.TransferID,
		})
	})
	if err != nil {
		// A concurrent retry that won is the answer, if it is this same request.
		if prior, getErr := e.Get(ctx, req.CaptureID); getErr == nil && prior.sameTerms(req) {
			return prior, nil
		}
		return Posting{}, err
	}
	return e.Get(ctx, req.CaptureID)
}

// Get reads back a posted capture.
func (e *Engine) Get(ctx context.Context, captureID string) (Posting, error) {
	row, err := sqlcgen.New(e.pool).GetCapture(ctx, captureID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Posting{}, fmt.Errorf("%w: %s", ErrNotFound, captureID)
	}
	if err != nil {
		return Posting{}, fmt.Errorf("reading capture %s: %w", captureID, err)
	}
	return Posting{
		CaptureID: row.CaptureID, Region: ledger.Region(row.Region), MerchantID: row.MerchantID,
		AmountMinor: row.AmountMinor, Currency: row.Currency, TransferID: row.TransferID, At: row.CreatedAt.Time,
	}, nil
}

// ensureMerchantPayable creates the merchant's payable on first capture and
// refuses a merchant that already has one in the other region.
func ensureMerchantPayable(ctx context.Context, q *sqlcgen.Queries, merchantID string, region ledger.Region) error {
	other := ledger.RegionID
	if region == ledger.RegionID {
		other = ledger.RegionAU
	}
	if _, err := q.GetAccount(ctx, ledger.MerchantPayableID(merchantID, other)); err == nil {
		return fmt.Errorf("%w: merchant %s is paid in %s, not %s", ErrRegionMismatch, merchantID, other, region)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("reading merchant payable: %w", err)
	}
	account := ledger.MerchantPayable(merchantID, region)
	if err := q.InsertAccount(ctx, sqlcgen.InsertAccountParams{
		ID: account.ID, OwnerType: string(account.OwnerType), OwnerID: account.OwnerID,
		Currency: string(account.Currency), Kind: string(account.Kind),
		Country: account.Country, Purpose: string(account.Purpose),
	}); err != nil {
		return fmt.Errorf("creating merchant payable for %s: %w", merchantID, err)
	}
	return nil
}
