package reward

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// Partner point pre-purchase. YT-0046.
//
// # Record the pair; never compute one from the other
//
// A purchase has two facts: N points allocated and X currency received. The
// commercial agreement sets both, so there is nothing to compute — and
// `P_issue` is an OUTPUT of the pair rather than an input to a conversion.
// Nothing here multiplies, divides or converts, which is why this ships
// while YT-0506 is still open.
//
// There is deliberately no stored price-per-point. A quotient is a third
// fact that can disagree with the two it came from, and when it does the two
// are right and the quotient is the bug — the same reasoning that keeps a
// balance a projection rather than a column.
//
// The upside: because both sides of every real purchase are on the record,
// the backing rate `B` can be DERIVED FROM HISTORY once YT-0506 resolves,
// rather than assumed. Recording only the points would have destroyed that.

var (
	// ErrPurchaseCurrencyUnknown — the ledger settles IDR and AUD.
	ErrPurchaseCurrencyUnknown = errors.New("reward: purchase currency is not one the ledger holds")
	// ErrPurchaseNotPositive — a zero-point or zero-cash purchase records
	// nothing and would create an allocation nobody paid for.
	ErrPurchaseNotPositive = errors.New("reward: a purchase needs both points and payment")
)

// PurchaseRequest is one partner buying a block of points.
type PurchaseRequest struct {
	// ID is the caller's reference, and the idempotency boundary: a retried
	// purchase must not create a second allocation for the same money.
	ID        string
	PartnerID string
	// Points allocated — fact one.
	Points int64
	// AmountMinor and Currency — fact two, currency-tagged because the
	// platform runs two and an untagged amount cannot be settled.
	AmountMinor int64
	Currency    string
}

// PurchaseResult links the two sides so a caller can follow either.
type PurchaseResult struct {
	PurchaseID   string
	AllocationID string
	CashTransfer string
}

// RecordPurchase writes both facts and the reserve posting, atomically.
//
// Three things happen in one transaction, and the atomicity is the point:
//
//  1. an allocation of N points, which the Reward Engine may draw down
//  2. a cash transfer into the segregated reserve, in the paid currency
//  3. the purchase row tying them together
//
// If any fails they all roll back. An allocation without its cash is
// unfunded points — precisely what docs/16 K6 forbids. Cash without its
// allocation is money received against nothing, which is the same defect
// pointing the other way and is harder to notice.
//
// The two sides are SEPARATE ledger transfers because they are in different
// currencies, and a transfer may not mix currencies (the YT-0518 trigger
// refuses it). The purchase row is what joins them, and is the audit trail
// the acceptance criteria ask for.
func (e *Engine) RecordPurchase(ctx context.Context, req PurchaseRequest) (PurchaseResult, error) {
	if req.Points <= 0 || req.AmountMinor <= 0 {
		return PurchaseResult{}, fmt.Errorf("%w: %d points for %d",
			ErrPurchaseNotPositive, req.Points, req.AmountMinor)
	}
	if req.Currency != string(ledger.CurrencyIDR) && req.Currency != string(ledger.CurrencyAUD) {
		return PurchaseResult{}, fmt.Errorf("%w: %q", ErrPurchaseCurrencyUnknown, req.Currency)
	}

	allocationID := fmt.Sprintf("alloc_%s", req.ID)
	transferID := fmt.Sprintf("led_txn_purchase_%s", req.ID)

	var result PurchaseResult
	err := ledger.WithSerializableRetry(ctx, e.pool, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)

		if err := e.ensureCashAccounts(ctx, queries, req.Currency); err != nil {
			return err
		}

		// Fact one: the points, as an allocation the engine can draw down.
		if err := queries.InsertAllocation(ctx, sqlcgen.InsertAllocationParams{
			ID: allocationID, FunderType: "partner", FunderID: req.PartnerID,
			TotalPoints: req.Points,
		}); err != nil {
			if isUniqueViolation(err) {
				return fmt.Errorf("%w: purchase %s", ErrAlreadyGranted, req.ID)
			}
			return fmt.Errorf("creating allocation: %w", err)
		}

		// Fact two: the cash, into the segregated reserve. Money flows out
		// of the partner-funding account and into the reserve — the same
		// flow shape as every other posting in this ledger.
		transfer, err := e.ledger.TransferInTx(ctx, tx, ledger.TransferRequest{
			ID:             transferID,
			IdempotencyKey: fmt.Sprintf("purchase_%s", req.ID),
			ReasonCode:     "partner_point_purchase",
			Entries: ledger.FundReserve(
				req.Currency, req.AmountMinor,
			),
		})
		if err != nil {
			return err
		}

		if err := queries.InsertPointPurchase(ctx, sqlcgen.InsertPointPurchaseParams{
			ID: req.ID, PartnerID: req.PartnerID, Points: req.Points,
			AmountMinor: req.AmountMinor, Currency: req.Currency,
			AllocationID: allocationID, CashTransferID: transfer.TransferID,
		}); err != nil {
			return fmt.Errorf("recording purchase: %w", err)
		}

		result = PurchaseResult{
			PurchaseID:   req.ID,
			AllocationID: allocationID,
			CashTransfer: transfer.TransferID,
		}
		return nil
	})

	if err != nil {
		return PurchaseResult{}, err
	}
	return result, nil
}

// PartnerPurchases returns both facts of every purchase a partner has made.
//
// This is the history `B` becomes derivable from — points and cash, side by
// side, per purchase. Deliberately returns the pair rather than a rate: the
// caller that eventually needs a rate should compute it from facts it can
// see, not receive one this package invented.
func (e *Engine) PartnerPurchases(
	ctx context.Context, partnerID string,
) ([]sqlcgen.LedgerPointPurchase, error) {
	rows, err := sqlcgen.New(e.pool).ListPurchasesForPartner(ctx, partnerID)
	if err != nil {
		return nil, fmt.Errorf("listing purchases for %s: %w", partnerID, err)
	}
	return rows, nil
}

// ensureCashAccounts creates the reserve and partner-funding accounts for a
// currency on first use. Separate from EnsureChart because that one covers
// the points side; cash accounts are per-currency and a deployment may never
// see AUD.
func (e *Engine) ensureCashAccounts(
	ctx context.Context, q *sqlcgen.Queries, currency string,
) error {
	for _, account := range ledger.CashChart(currency, e.country) {
		if err := q.InsertAccount(ctx, sqlcgen.InsertAccountParams{
			ID: account.ID, OwnerType: string(account.OwnerType), OwnerID: account.OwnerID,
			Currency: string(account.Currency), Kind: string(account.Kind),
			Country: account.Country,
		}); err != nil {
			return fmt.Errorf("ensuring %s: %w", account.ID, err)
		}
	}
	return nil
}
