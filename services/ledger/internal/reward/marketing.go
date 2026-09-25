package reward

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// K6 (4.4.h): every point not paid for by a business is backed by cash at
// the moment of issue.
//
//   - A partner allocation exists only with a point_purchase behind it.
//   - A marketing action (streak, receipt, goodwill, referral) draws only from
//     a marketing allocation, and its grant moves ceil(points × B) of
//     marketing cash into the reserve in the same transaction. The overdraft
//     guard on marketing cash refuses a grant the cash cannot back.
//   - Marketing cash rises only through FundMarketing, decided by two people.

var (
	// ErrWrongFunder — a marketing action on a partner allocation, or a
	// campaign reward on a marketing one. Partner money never pays for the
	// platform's own marketing.
	ErrWrongFunder = errors.New("reward: this allocation cannot fund this action")
	// ErrSameApprover — a funding decision needs a second person.
	ErrSameApprover = errors.New("reward: a funding decision needs a second person")
	// ErrPartnerNeedsPurchase — partner allocations come only from RecordPurchase.
	ErrPartnerNeedsPurchase = errors.New("reward: a partner allocation comes only from a point purchase")
)

// Ledger is the book this engine posts to.
func (e *Engine) Ledger() *ledger.Ledger { return e.ledger }

// FundMarketing puts the platform's own cash behind marketing points:
// Dr marketing_cash / Cr platform_equity, recorded with who proposed and who
// approved it. Idempotent on id. Returns the transfer id.
func (e *Engine) FundMarketing(
	ctx context.Context, id string, amountMinor int64, proposedBy, approvedBy string,
) (string, error) {
	if proposedBy == "" || proposedBy == approvedBy {
		return "", fmt.Errorf("%w: proposed by %q, approved by %q", ErrSameApprover, proposedBy, approvedBy)
	}
	if amountMinor <= 0 {
		return "", fmt.Errorf("reward: marketing funding must be positive, got %d", amountMinor)
	}

	var transferID string
	err := ledger.WithSerializableRetry(ctx, e.pool, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)
		if err := ensureChart(ctx, queries, e.region); err != nil {
			return err
		}
		transfer, err := e.ledger.TransferInTx(ctx, tx, ledger.TransferRequest{
			ID:             "led_txn_fund_marketing_" + id,
			IdempotencyKey: "fund_marketing_" + id,
			ReasonCode:     "fund_marketing",
			Entries:        ledger.FundMarketing(e.region, amountMinor),
		})
		if err != nil {
			return err
		}
		transferID = transfer.TransferID
		if transfer.Replayed {
			return nil
		}
		return queries.InsertMarketingFunding(ctx, sqlcgen.InsertMarketingFundingParams{
			ID: id, Region: string(e.region), AmountMinor: amountMinor,
			ProposedBy: proposedBy, ApprovedBy: approvedBy, TransferID: transfer.TransferID,
		})
	})
	return transferID, err
}

// checkFunder is the K6 routing rule: marketing actions from marketing
// allocations, everything else from partner allocations.
func checkFunder(def ActionDefinition, funderType string) error {
	wantMarketing := def.MarketingFunded
	if wantMarketing != (funderType == "marketing") {
		return fmt.Errorf("%w: a %s allocation for a marketing=%v action", ErrWrongFunder, funderType, wantMarketing)
	}
	return nil
}

// backMarketingGrant moves the cash behind a marketing grant into the
// reserve, inside the grant's transaction: Dr reserve / Cr marketing_cash,
// ceil(points × B) at the rate in force now.
func (e *Engine) backMarketingGrant(
	ctx context.Context, tx pgx.Tx, queries *sqlcgen.Queries, grantRef string, points int64,
) error {
	rate, err := queries.GetBackingRateInForce(ctx, string(e.region.Currency()))
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("%w: %s", pricing.ErrNoRateInForce, e.region.Currency())
	}
	if err != nil {
		return fmt.Errorf("reading the rate in force: %w", err)
	}
	backing, err := pricing.SettlementLiabilityMinor(points, rate.MicrosPerPoint)
	if err != nil {
		return err
	}
	_, err = e.ledger.TransferInTx(ctx, tx, ledger.TransferRequest{
		ID:             "led_txn_backing_" + grantRef,
		IdempotencyKey: "marketing_backing_" + grantRef,
		ReasonCode:     "marketing_backing",
		Entries:        ledger.MarketingBacking(e.region, backing),
	})
	return err
}
