package pricing

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

var (
	// ErrNoRateInForce — nothing has been set for this currency yet, or the
	// only rates are effective in the future.
	//
	// Returned rather than defaulted. A default B is a number nobody chose
	// that every price in the catalogue would silently rest on, and the
	// first person to notice would be whoever reconciled a settlement run.
	ErrNoRateInForce = errors.New("pricing: no backing rate is in force for this currency")
	// ErrRateNotBelowIssuePrice is docs/09 §4.1's "B is always less than
	// P_issue" refused at the boundary. The database refuses it too; this
	// exists so the caller gets a sentence instead of a constraint name.
	ErrRateNotBelowIssuePrice = errors.New("pricing: the backing rate must be below the issue price")
	// ErrReasonRequired — a rate change with no stated reason.
	ErrReasonRequired = errors.New("pricing: a rate change must carry its reason")
)

// Rate is one row of the backing-rate history: B, the issue price it was set
// against, and when it took effect.
type Rate struct {
	ID                       string
	Currency                 string
	MicrosPerPoint           int64
	IssuePriceMicrosPerPoint int64
	EffectiveFrom            time.Time
	Reason                   string
	SetBy                    string
}

// SpreadMicros is P_issue − B: what the platform keeps per point, before any
// demand multiplier. docs/09 §4.1 — "the spread is the margin".
func (r Rate) SpreadMicros() int64 { return r.IssuePriceMicrosPerPoint - r.MicrosPerPoint }

// Engine reads and writes the monetary parameters and prices against them.
type Engine struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Engine { return &Engine{pool: pool} }

// SetRate records a new backing rate, effective from an instant.
//
// # Why there is no UpdateRate
//
// Changing B reprices the entire catalogue at once — docs/09 §6 lever 3,
// the one annotated "High — this is a devaluation. Announce it, never do it
// silently". An UPDATE would leave no trace of what the rate had been, so
// the question a user asks after a reprice ("what was this worth
// yesterday?") would have no answer, and the announcement requirement would
// rest entirely on someone remembering to send an email.
//
// Effective-dating also means a rate can be set AHEAD of time, which is what
// makes announcing one possible at all: you cannot give notice of a change
// you can only make at the instant it applies.
func (e *Engine) SetRate(ctx context.Context, rate Rate) error {
	if rate.MicrosPerPoint <= 0 {
		return fmt.Errorf("%w: got %d", ErrBackingRateNotPositive, rate.MicrosPerPoint)
	}
	if rate.MicrosPerPoint >= rate.IssuePriceMicrosPerPoint {
		return fmt.Errorf("%w: B=%d, P_issue=%d — the spread would be %d",
			ErrRateNotBelowIssuePrice, rate.MicrosPerPoint,
			rate.IssuePriceMicrosPerPoint, rate.SpreadMicros())
	}
	if rate.Reason == "" {
		return ErrReasonRequired
	}

	return sqlcgen.New(e.pool).InsertBackingRate(ctx, sqlcgen.InsertBackingRateParams{
		ID:                       rate.ID,
		Currency:                 rate.Currency,
		MicrosPerPoint:           rate.MicrosPerPoint,
		IssuePriceMicrosPerPoint: rate.IssuePriceMicrosPerPoint,
		EffectiveFrom:            pgtype.Timestamptz{Time: rate.EffectiveFrom, Valid: true},
		Reason:                   rate.Reason,
		SetBy:                    rate.SetBy,
	})
}

// RateAt is the rate in force for a currency at an instant.
func (e *Engine) RateAt(ctx context.Context, currency string, at time.Time) (Rate, error) {
	row, err := sqlcgen.New(e.pool).GetBackingRateAt(ctx, sqlcgen.GetBackingRateAtParams{
		Currency:      currency,
		EffectiveFrom: pgtype.Timestamptz{Time: at, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return Rate{}, fmt.Errorf("%w: %s at %s", ErrNoRateInForce, currency, at.UTC().Format(time.RFC3339))
	}
	if err != nil {
		return Rate{}, fmt.Errorf("reading the backing rate: %w", err)
	}

	return Rate{
		ID:                       row.ID,
		Currency:                 row.Currency,
		MicrosPerPoint:           row.MicrosPerPoint,
		IssuePriceMicrosPerPoint: row.IssuePriceMicrosPerPoint,
		EffectiveFrom:            row.EffectiveFrom.Time,
		Reason:                   row.Reason,
		SetBy:                    row.SetBy,
	}, nil
}

// Quote prices one listing: the supplier's declared settlement value, at the
// rate in force, with a demand multiplier.
//
// The returned Quote carries B and the rate's id alongside the price, so the
// audit row the store writes can answer "why did this change?" — see the
// note on Quote.
func (e *Engine) Quote(
	ctx context.Context, currency string, settlementMinor int64, demandBps int32, at time.Time,
) (Quote, error) {
	rate, err := e.RateAt(ctx, currency, at)
	if err != nil {
		return Quote{}, err
	}

	points, err := PriceInPoints(settlementMinor, rate.MicrosPerPoint, demandBps)
	if err != nil {
		return Quote{}, err
	}

	return Quote{
		PricePoints:           points,
		SettlementMinor:       settlementMinor,
		BackingMicrosPerPoint: rate.MicrosPerPoint,
		BackingRateID:         rate.ID,
		DemandMultiplierBps:   demandBps,
	}, nil
}

// History is every rate a currency has had, oldest first.
func (e *Engine) History(ctx context.Context, currency string) ([]Rate, error) {
	rows, err := sqlcgen.New(e.pool).ListBackingRates(ctx, currency)
	if err != nil {
		return nil, fmt.Errorf("listing backing rates: %w", err)
	}

	rates := make([]Rate, 0, len(rows))
	for _, row := range rows {
		rates = append(rates, Rate{
			ID:                       row.ID,
			Currency:                 row.Currency,
			MicrosPerPoint:           row.MicrosPerPoint,
			IssuePriceMicrosPerPoint: row.IssuePriceMicrosPerPoint,
			EffectiveFrom:            row.EffectiveFrom.Time,
			Reason:                   row.Reason,
			SetBy:                    row.SetBy,
		})
	}
	return rates, nil
}
