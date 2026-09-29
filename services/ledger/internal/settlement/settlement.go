// Package settlement is 10.1's clearing & settlement: a per-business,
// per-region statement of what the platform owes a merchant for captured
// vouchers, a staff-approved simulated payout after the F12 dispute window,
// and the K13 recovery line a captured-voucher dispute resolves into (10.5.b).
package settlement

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// DisputeWindowDays is F12's "Settlement | Dispute window 7 days". A
// per-region override through the 1.2.f settings store is future work
// (9.5.d's pattern for the other economy numbers) — this is a constant, not
// a magic number scattered at each call site.
const DisputeWindowDays = 7

var (
	// ErrNotFound — no statement, capture or recovery has that id.
	ErrNotFound = errors.New("settlement: not found")
	// ErrInvalid — the request is missing something required.
	ErrInvalid = errors.New("settlement: invalid request")
	// ErrInvalidPeriod — to is not after from.
	ErrInvalidPeriod = errors.New("settlement: to must be after from")
	// ErrNotOpen — the statement is not `open` (already disputed, or already paid).
	ErrNotOpen = errors.New("settlement: statement is not open")
	// ErrNotDisputed — resolving a statement that was never disputed.
	ErrNotDisputed = errors.New("settlement: statement is not disputed")
	// ErrDisputeWindowOpen — F12: a payout cannot be approved before the
	// statement's own dispute window has closed.
	ErrDisputeWindowOpen = errors.New("settlement: the dispute window has not closed yet")
)

// Engine is the settlement side of the ledger.
type Engine struct {
	pool   *pgxpool.Pool
	ledger *ledger.Ledger
}

func New(pool *pgxpool.Pool, book *ledger.Ledger) *Engine {
	return &Engine{pool: pool, ledger: book}
}

// Statement is a stored snapshot (10.1.b): once generated, a dispute or an
// approval reads the same figures however much activity has posted since —
// only ReleaseVoucherLiability, PostCaptureRecovery and Payout entries
// posted BEFORE generation are ever in it.
//
// PointPurchasesMinor is always 0 for now: J1's information-only line
// currently carries only the point count (PointPurchasesPoints), from
// ledger.allocation. Its cash figure is a follow-up once a business's point
// purchases carry their own settlement value on that row.
type Statement struct {
	ID                   string
	BusinessID           string
	Region               ledger.Region
	Currency             string
	PeriodFrom           time.Time
	PeriodTo             time.Time
	OpeningPayableMinor  int64
	CapturesMinor        int64
	RefundsMinor         int64
	RecoveriesMinor      int64
	ClosingPayableMinor  int64
	PointPurchasesMinor  int64
	PointPurchasesPoints int64
	Status               string
	DisputeReason        *string
	DisputedAt           *time.Time
	ResolutionNote       *string
	ResolvedAt           *time.Time
	DisputeWindowEndsAt  time.Time
	GeneratedAt          time.Time
	ApprovedBy           *string
	ApprovedAt           *time.Time
	PayoutTransferID     *string
}

// Recovery is one K13 recovery line (10.5.b): staff resolving a
// captured-voucher dispute in the user's favour claws back exactly what
// that capture paid the merchant.
type Recovery struct {
	ID          string
	CaptureID   string
	Region      ledger.Region
	MerchantID  string
	AmountMinor int64
	Currency    string
	Reason      string
	TransferID  string
	At          time.Time
}

// GenerateOrGet computes and stores the statement for [from, to) — or, if
// one already exists for this exact period, returns it unchanged (10.1.b:
// "reproducible from ledger entries" describes how it is FIRST computed,
// not a promise to recompute forever; see Recompute for that check).
func (e *Engine) GenerateOrGet(ctx context.Context, businessID string, region ledger.Region, from, to time.Time) (Statement, error) {
	if !to.After(from) {
		return Statement{}, ErrInvalidPeriod
	}
	queries := sqlcgen.New(e.pool)
	fromDate := pgtype.Timestamptz{Time: from, Valid: true}
	toDate := pgtype.Timestamptz{Time: to, Valid: true}

	if existing, err := queries.GetStatementByPeriod(ctx, sqlcgen.GetStatementByPeriodParams{
		BusinessID: businessID, Region: string(region), PeriodFrom: fromDate, PeriodTo: toDate,
	}); err == nil {
		return fromStatementRow(existing), nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Statement{}, fmt.Errorf("reading statement %s/%s: %w", businessID, region, err)
	}

	figures, err := e.compute(ctx, queries, businessID, region, from, to)
	if err != nil {
		return Statement{}, err
	}

	inserted, err := queries.InsertStatement(ctx, sqlcgen.InsertStatementParams{
		ID: "stmt_" + randomHex(), BusinessID: businessID, Region: string(region), Currency: string(region.Currency()),
		PeriodFrom: fromDate, PeriodTo: toDate,
		OpeningPayableMinor: figures.opening, CapturesMinor: figures.captures, RefundsMinor: figures.refunds,
		RecoveriesMinor: figures.recoveries, ClosingPayableMinor: figures.closing,
		PointPurchasesMinor: 0, PointPurchasesPoints: figures.pointPurchasePoints,
		DisputeWindowEndsAt: pgtype.Timestamptz{Time: to.Add(DisputeWindowDays * 24 * time.Hour), Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Lost a concurrent race for the same period; the winner's row is the answer.
		existing, getErr := queries.GetStatementByPeriod(ctx, sqlcgen.GetStatementByPeriodParams{
			BusinessID: businessID, Region: string(region), PeriodFrom: fromDate, PeriodTo: toDate,
		})
		if getErr != nil {
			return Statement{}, fmt.Errorf("reading the statement that won the race: %w", getErr)
		}
		return fromStatementRow(existing), nil
	}
	if err != nil {
		return Statement{}, fmt.Errorf("recording statement for %s/%s: %w", businessID, region, err)
	}
	return fromStatementRow(inserted), nil
}

// statementFigures is what compute derives from ledger.entry alone.
type statementFigures struct {
	opening, captures, refunds, recoveries, closing, pointPurchasePoints int64
}

// compute is the recomputation 10.1.d's Check is about: closing is always
// opening + the account's TRUE net movement in [from, to) — not
// opening+captures-refunds-recoveries, so it stays correct even if some
// other reason code ever touches this account inside the window. captures,
// refunds and recoveries are the human-readable breakdown of that same
// movement, bucketed by the reason codes this package itself posts.
func (e *Engine) compute(
	ctx context.Context, queries *sqlcgen.Queries, businessID string, region ledger.Region, from, to time.Time,
) (statementFigures, error) {
	accountID := ledger.MerchantPayableID(businessID, region)
	fromTs, toTs := pgtype.Timestamptz{Time: from, Valid: true}, pgtype.Timestamptz{Time: to, Valid: true}

	opening, err := queries.MerchantPayableBalanceBefore(ctx, sqlcgen.MerchantPayableBalanceBeforeParams{
		AccountID: accountID, AsOf: fromTs,
	})
	if err != nil {
		return statementFigures{}, fmt.Errorf("reading opening payable: %w", err)
	}

	activity, err := queries.MerchantPayableActivityByReason(ctx, sqlcgen.MerchantPayableActivityByReasonParams{
		AccountID: accountID, FromTs: fromTs, ToTs: toTs,
	})
	if err != nil {
		return statementFigures{}, fmt.Errorf("reading payable activity: %w", err)
	}

	var net, captures, refunds, recoveries int64
	for _, row := range activity {
		net += row.SubtotalMinor
		switch row.ReasonCode {
		case "capture":
			captures += row.SubtotalMinor
		case "refund_capture":
			refunds += -row.SubtotalMinor
		case "capture_recovery":
			recoveries += -row.SubtotalMinor
		}
	}

	regionStr := string(region)
	points, err := queries.PointPurchasesForBusiness(ctx, sqlcgen.PointPurchasesForBusinessParams{
		FunderID: businessID, Region: &regionStr, FromTs: fromTs, ToTs: toTs,
	})
	if err != nil {
		return statementFigures{}, fmt.Errorf("reading point purchases: %w", err)
	}

	return statementFigures{
		opening: opening, captures: captures, refunds: refunds, recoveries: recoveries,
		closing: opening + net, pointPurchasePoints: points,
	}, nil
}

// Recompute re-derives a stored statement's figures fresh from ledger.entry
// and reports whether they still match — 10.1.d's "statements that match a
// recomputation from ledger entries". A live-activity mismatch (new capture
// posted inside an old, already-closed period) cannot happen in the
// intended flow — nothing posts a capture dated in the past — so a mismatch
// here means the figures were computed wrong, not that time moved on.
func (e *Engine) Recompute(ctx context.Context, statementID string) (match bool, recomputed Statement, err error) {
	stored, err := e.Get(ctx, statementID)
	if err != nil {
		return false, Statement{}, err
	}
	figures, err := e.compute(ctx, sqlcgen.New(e.pool), stored.BusinessID, stored.Region, stored.PeriodFrom, stored.PeriodTo)
	if err != nil {
		return false, Statement{}, err
	}
	fresh := stored
	fresh.OpeningPayableMinor, fresh.CapturesMinor, fresh.RefundsMinor = figures.opening, figures.captures, figures.refunds
	fresh.RecoveriesMinor, fresh.ClosingPayableMinor, fresh.PointPurchasesPoints = figures.recoveries, figures.closing, figures.pointPurchasePoints
	match = fresh.OpeningPayableMinor == stored.OpeningPayableMinor && fresh.CapturesMinor == stored.CapturesMinor &&
		fresh.RefundsMinor == stored.RefundsMinor && fresh.RecoveriesMinor == stored.RecoveriesMinor &&
		fresh.ClosingPayableMinor == stored.ClosingPayableMinor
	return match, fresh, nil
}

// Get reads back one statement.
func (e *Engine) Get(ctx context.Context, statementID string) (Statement, error) {
	row, err := sqlcgen.New(e.pool).GetStatement(ctx, statementID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Statement{}, fmt.Errorf("%w: statement %s", ErrNotFound, statementID)
	}
	if err != nil {
		return Statement{}, fmt.Errorf("reading statement %s: %w", statementID, err)
	}
	return fromStatementRow(row), nil
}

// ListForBusiness answers 10.1.b/10.6.b's own query: every statement for one
// business whose period falls fully inside [from, to), newest first.
func (e *Engine) ListForBusiness(ctx context.Context, businessID string, from, to time.Time) ([]Statement, error) {
	rows, err := sqlcgen.New(e.pool).ListStatementsForBusiness(ctx, sqlcgen.ListStatementsForBusinessParams{
		BusinessID: businessID, FromTs: pgtype.Timestamptz{Time: from, Valid: true}, ToTs: pgtype.Timestamptz{Time: to, Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("listing statements for %s: %w", businessID, err)
	}
	statements := make([]Statement, 0, len(rows))
	for _, row := range rows {
		statements = append(statements, fromStatementRow(row))
	}
	return statements, nil
}

// ListQueue is 10.5/10.6's staff queue: every open or disputed statement in
// a region, oldest first (the ones waiting longest surface first).
func (e *Engine) ListQueue(ctx context.Context, region ledger.Region) ([]Statement, error) {
	rows, err := sqlcgen.New(e.pool).ListOpenStatementsPastDisputeWindow(ctx, string(region))
	if err != nil {
		return nil, fmt.Errorf("listing the settlement queue for %s: %w", region, err)
	}
	statements := make([]Statement, 0, len(rows))
	for _, row := range rows {
		statements = append(statements, fromStatementRow(row))
	}
	return statements, nil
}

// Dispute is 10.6.b's studio call: a business disputes its own statement,
// which holds the payout until staff resolve it (10.6.c).
func (e *Engine) Dispute(ctx context.Context, statementID, reason string) (Statement, error) {
	if reason == "" {
		return Statement{}, fmt.Errorf("%w: a reason is required", ErrInvalid)
	}
	row, err := sqlcgen.New(e.pool).MarkStatementDisputed(ctx, sqlcgen.MarkStatementDisputedParams{
		ID: statementID, DisputeReason: &reason,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Statement{}, e.notOpenOrNotFound(ctx, statementID)
	}
	if err != nil {
		return Statement{}, fmt.Errorf("disputing statement %s: %w", statementID, err)
	}
	return fromStatementRow(row), nil
}

// Resolve is 10.5.a's release: staff clears a dispute, returning the
// statement to `open` so it can still be approved once its window allows.
// The resolution itself — e.g. a K13 recovery line via PostCaptureRecovery —
// is posted separately, onto whichever statement covers its own date, not by
// rewriting this one's totals.
func (e *Engine) Resolve(ctx context.Context, statementID, note string) (Statement, error) {
	row, err := sqlcgen.New(e.pool).MarkStatementResolved(ctx, sqlcgen.MarkStatementResolvedParams{
		ID: statementID, ResolutionNote: nilIfEmpty(note),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		if _, getErr := e.Get(ctx, statementID); errors.Is(getErr, ErrNotFound) {
			return Statement{}, ErrNotFound
		}
		return Statement{}, ErrNotDisputed
	}
	if err != nil {
		return Statement{}, fmt.Errorf("resolving statement %s: %w", statementID, err)
	}
	return fromStatementRow(row), nil
}

// ApprovePayout is 10.1.c: after the dispute window, the statement's closing
// payable moves from the merchant's payable to the reserve — a real transfer
// in the same transaction as marking the statement paid, so a crash between
// the two is impossible. now is injected so a test needs no 7-day sleep and
// F12's window is provably enforced.
func (e *Engine) ApprovePayout(ctx context.Context, statementID, approvedBy string, now time.Time) (Statement, error) {
	statement, err := e.Get(ctx, statementID)
	if err != nil {
		return Statement{}, err
	}
	if statement.Status != "open" {
		return Statement{}, ErrNotOpen
	}
	if now.Before(statement.DisputeWindowEndsAt) {
		return Statement{}, ErrDisputeWindowOpen
	}

	var final Statement
	err = ledger.WithSerializableRetry(ctx, e.pool, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)
		var transferID *string
		// Nothing owed (a zero or, from an over-recovery, negative closing
		// balance) is still resolved — marked paid with no transfer, since a
		// zero-amount ledger entry is refused as malformed, not merely a
		// no-op.
		if statement.ClosingPayableMinor > 0 {
			posted, err := e.ledger.TransferInTx(ctx, tx, ledger.TransferRequest{
				ID: "led_txn_payout_" + statement.ID, IdempotencyKey: "payout_" + statement.ID,
				ReasonCode: "payout",
				Entries:    ledger.Payout(statement.Region, statement.BusinessID, statement.ClosingPayableMinor),
			})
			if err != nil {
				return fmt.Errorf("posting the payout: %w", err)
			}
			transferID = &posted.TransferID
		}
		updated, err := queries.MarkStatementApproved(ctx, sqlcgen.MarkStatementApprovedParams{
			ID: statement.ID, ApprovedBy: &approvedBy, PayoutTransferID: transferID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotOpen // someone else approved (or disputed) it first
		}
		if err != nil {
			return fmt.Errorf("marking statement %s paid: %w", statement.ID, err)
		}
		final = fromStatementRow(updated)
		return nil
	})
	if err != nil {
		return Statement{}, err
	}
	return final, nil
}

// PostCaptureRecovery is 10.5.b: resolving a captured-voucher K13 dispute in
// the user's favour claws back exactly what that capture paid the merchant
// — the reverse of Capture, reason-coded `capture_recovery` so a statement's
// compute() buckets it apart from an ordinary refund. Idempotent per
// captureID: a capture can be recovered at most once, and a replay with the
// same reason returns the original line rather than posting twice.
func (e *Engine) PostCaptureRecovery(ctx context.Context, captureID, reason string) (Recovery, error) {
	if captureID == "" || reason == "" {
		return Recovery{}, fmt.Errorf("%w: a capture id and a reason are required", ErrInvalid)
	}
	if existing, err := e.GetRecovery(ctx, captureID); err == nil {
		return existing, nil
	} else if !errors.Is(err, ErrNotFound) {
		return Recovery{}, err
	}

	captured, err := sqlcgen.New(e.pool).GetCapture(ctx, captureID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Recovery{}, fmt.Errorf("%w: capture %s", ErrNotFound, captureID)
	}
	if err != nil {
		return Recovery{}, fmt.Errorf("reading capture %s: %w", captureID, err)
	}

	id := "rec_" + randomHex()
	var result Recovery
	err = ledger.WithSerializableRetry(ctx, e.pool, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)
		posted, err := e.ledger.TransferInTx(ctx, tx, ledger.TransferRequest{
			ID: "led_txn_recovery_" + captureID, IdempotencyKey: "recovery_" + captureID,
			ReasonCode: "capture_recovery",
			Entries:    ledger.RefundCapture(ledger.Region(captured.Region), captured.MerchantID, captured.AmountMinor),
		})
		if err != nil {
			return fmt.Errorf("posting the recovery: %w", err)
		}
		inserted, err := queries.InsertCaptureRecovery(ctx, sqlcgen.InsertCaptureRecoveryParams{
			ID: id, CaptureID: captureID, Region: captured.Region, MerchantID: captured.MerchantID,
			AmountMinor: captured.AmountMinor, Currency: captured.Currency, Reason: reason, TransferID: posted.TransferID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			// Lost a concurrent race for the same capture; its winner is the answer.
			existing, getErr := queries.GetCaptureRecoveryByCapture(ctx, captureID)
			if getErr != nil {
				return fmt.Errorf("reading the recovery that won the race: %w", getErr)
			}
			result = fromRecoveryRow(existing)
			return nil
		}
		if err != nil {
			return fmt.Errorf("recording the recovery: %w", err)
		}
		result = fromRecoveryRow(inserted)
		return nil
	})
	if err != nil {
		return Recovery{}, err
	}
	return result, nil
}

// GetRecovery answers whether a capture already has a recovery line.
func (e *Engine) GetRecovery(ctx context.Context, captureID string) (Recovery, error) {
	row, err := sqlcgen.New(e.pool).GetCaptureRecoveryByCapture(ctx, captureID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Recovery{}, fmt.Errorf("%w: capture %s has no recovery", ErrNotFound, captureID)
	}
	if err != nil {
		return Recovery{}, fmt.Errorf("reading recovery for capture %s: %w", captureID, err)
	}
	return fromRecoveryRow(row), nil
}

// ReleaseVoucherLiability is 10.1.c's other half: a single-use remainder, an
// expiry or a dead hold that never reached a merchant releases its own S
// back to redemption_clearing — there is no payable leg, since no merchant
// was ever paid. The caller (10.2.b's voucher expiry job) owns the
// idempotency key, one per voucher/event so a retried sweep cannot release
// the same liability twice.
func (e *Engine) ReleaseVoucherLiability(ctx context.Context, idempotencyKey string, region ledger.Region, amountMinor int64) (string, error) {
	if idempotencyKey == "" || amountMinor <= 0 {
		return "", fmt.Errorf("%w: an idempotency key and a positive amount are required", ErrInvalid)
	}
	posted, err := e.ledger.Transfer(ctx, ledger.TransferRequest{
		ID: "led_txn_" + idempotencyKey, IdempotencyKey: idempotencyKey,
		ReasonCode: "voucher_liability_release", Entries: ledger.VoucherExpiry(region, amountMinor),
	})
	if err != nil {
		return "", fmt.Errorf("releasing voucher liability: %w", err)
	}
	return posted.TransferID, nil
}

func (e *Engine) notOpenOrNotFound(ctx context.Context, statementID string) error {
	if _, err := e.Get(ctx, statementID); errors.Is(err, ErrNotFound) {
		return ErrNotFound
	}
	return ErrNotOpen
}

func fromStatementRow(row sqlcgen.LedgerStatement) Statement {
	return Statement{
		ID: row.ID, BusinessID: row.BusinessID, Region: ledger.Region(row.Region), Currency: row.Currency,
		PeriodFrom: row.PeriodFrom.Time, PeriodTo: row.PeriodTo.Time,
		OpeningPayableMinor: row.OpeningPayableMinor, CapturesMinor: row.CapturesMinor, RefundsMinor: row.RefundsMinor,
		RecoveriesMinor: row.RecoveriesMinor, ClosingPayableMinor: row.ClosingPayableMinor,
		PointPurchasesMinor: row.PointPurchasesMinor, PointPurchasesPoints: row.PointPurchasesPoints,
		Status: row.Status, DisputeReason: row.DisputeReason, DisputedAt: timeOrNil(row.DisputedAt),
		ResolutionNote: row.ResolutionNote, ResolvedAt: timeOrNil(row.ResolvedAt),
		DisputeWindowEndsAt: row.DisputeWindowEndsAt.Time, GeneratedAt: row.GeneratedAt.Time,
		ApprovedBy: row.ApprovedBy, ApprovedAt: timeOrNil(row.ApprovedAt), PayoutTransferID: row.PayoutTransferID,
	}
}

func fromRecoveryRow(row sqlcgen.LedgerCaptureRecovery) Recovery {
	return Recovery{
		ID: row.ID, CaptureID: row.CaptureID, Region: ledger.Region(row.Region), MerchantID: row.MerchantID,
		AmountMinor: row.AmountMinor, Currency: row.Currency, Reason: row.Reason, TransferID: row.TransferID,
		At: row.CreatedAt.Time,
	}
}

func timeOrNil(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	return &t.Time
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func randomHex() string {
	var b [12]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}
