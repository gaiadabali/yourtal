// Package ledger is the only writer of point and cash balances (docs/02 §68).
//
// # The ledger moves integers and never interprets them
//
// A transfer takes an amount and a currency, moves it between accounts, and
// returns. It never needs to know what the integer MEANS in human terms, and
// that ignorance is deliberate — it is the same principle as docs/18's
// four intentionally-dumb engines. Nothing here converts, formats, prices or
// settles, so nothing here depends on what an IDR minor unit denominates
// (FOUNDER DECISION T-1: whole Rupiah). If a function would need to know the
// exponent, it belongs in pricing or settlement, not in this package.
//
// # What enforces correctness is Postgres, not this code
//
// The balance invariant is a DEFERRED constraint trigger that fires at
// COMMIT (see packages/db/migrations). This package does validate before
// writing, but only so the caller gets a clear error instead of a raw
// constraint violation — the database remains the thing that is actually
// load-bearing, and packages/db's tests prove it holds against a psql
// session with no service in the way.
package ledger

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// serializationFailure is Postgres's SQLSTATE for a serialization conflict.
// docs/13a §7 requires ledger writes at Serializable with "a documented
// retry on 40001" — documented here, because a retry loop with no comment
// is indistinguishable from one that is papering over a real bug.
const serializationFailure = "40001"

// maxAttempts bounds the retry, and baseBackoff spaces attempts out.
//
// # Why this needs real backoff and not just a loop
//
// The balance trigger reads `ledger.entry WHERE transfer_id = ...` at COMMIT.
// Under SERIALIZABLE that read takes an SIRead predicate lock, and those are
// PAGE-granular: while the table and its index are small, every concurrent
// transfer's read lands on the same index page, so each conflicts with every
// other even though they touch different transfers. Sixteen concurrent
// writers then exhaust a naive five-attempt loop, and they do it in a burst
// because an immediate retry collides with the same crowd it just lost to.
//
// This eases as the table grows and the index spans more pages, which is a
// trap worth naming: the failure is WORST when the database is emptiest,
// so a load test on a fresh database is harsher than production and a
// developer will meet it before an operator does.
//
// Backoff with jitter is the fix — it spreads the retrying crowd rather than
// re-synchronising it. Retrying is safe because the whole transaction is
// idempotent: it re-runs the ON CONFLICT insert, so a retry after a
// serialization failure cannot double-post.
const (
	maxAttempts = 10
	baseBackoff = 2 * time.Millisecond
)

var (
	// ErrUnbalanced is returned before anything is written. The database
	// would also refuse it at COMMIT; catching it here gives the caller a
	// message naming the imbalance rather than a constraint name.
	ErrUnbalanced = errors.New("ledger: entries do not sum to zero")
	// ErrTooFewEntries — double-entry needs at least two sides.
	ErrTooFewEntries = errors.New("ledger: a transfer needs at least two entries")
	// ErrMixedCurrency — a transfer that mixes currencies is not a transfer,
	// it is an unrecorded FX trade.
	ErrMixedCurrency = errors.New("ledger: a transfer cannot mix currencies")
	// ErrZeroAmount — a zero entry moves nothing and hides intent.
	ErrZeroAmount = errors.New("ledger: an entry cannot be zero")
)

// Entry is one side of a transfer. Debits are negative, credits positive;
// summing to zero is what makes it double-entry.
type Entry struct {
	AccountID   string
	AmountMinor int64
	Currency    string
}

// TransferRequest is what a caller asks for. IdempotencyKey is mandatory:
// docs/09 §214, retries are certain and double-spends must be impossible.
type TransferRequest struct {
	ID             string
	IdempotencyKey string
	ReasonCode     string
	Entries        []Entry
}

// TransferResult reports what happened. Replayed distinguishes "we wrote
// this now" from "this key already existed" — the caller needs to tell them
// apart for logging and metrics even though both are successes.
type TransferResult struct {
	TransferID string
	Replayed   bool
}

// Ledger owns the pool. Constructed once at startup and injected; nothing
// below main reaches for a global.
type Ledger struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Ledger {
	return &Ledger{pool: pool}
}

// Transfer writes a balanced set of entries in one transaction.
//
// Replaying an idempotency key returns the ORIGINAL transfer and writes
// nothing. That is decided by `INSERT ... ON CONFLICT (idempotency_key) DO
// NOTHING RETURNING`: if it returns no row, someone else owns the key, and
// the existing transfer is read back. A SELECT-then-INSERT would leave a
// window where two concurrent retries both find nothing and both write —
// which is the double-spend this whole path exists to prevent.
func (l *Ledger) Transfer(ctx context.Context, req TransferRequest) (TransferResult, error) {
	if err := validate(req); err != nil {
		return TransferResult{}, err
	}

	var result TransferResult
	err := l.withSerializableRetry(ctx, func(tx pgx.Tx) error {
		var innerErr error
		result, innerErr = l.postInTx(ctx, tx, req)
		return innerErr
	})

	if err != nil {
		return TransferResult{}, err
	}
	return result, nil
}

// TransferInTx posts inside a transaction the CALLER owns.
//
// It exists for the Reward Engine, which must draw down a funding allocation
// and post the credit atomically: an allocation decremented for points that
// were never issued destroys funding nobody can account for, and points
// issued against an allocation that was never decremented are unfunded
// points — the exact thing docs/16 K6 forbids. Two transactions cannot give
// that guarantee; one can.
//
// The caller owns the retry, because the caller owns the transaction. It
// must open it Serializable — see withSerializableRetry for why, and for the
// page-granular SIRead behaviour that makes backoff necessary.
func (l *Ledger) TransferInTx(ctx context.Context, tx pgx.Tx, req TransferRequest) (TransferResult, error) {
	if err := validate(req); err != nil {
		return TransferResult{}, err
	}
	return l.postInTx(ctx, tx, req)
}

func (l *Ledger) postInTx(ctx context.Context, tx pgx.Tx, req TransferRequest) (TransferResult, error) {
	queries := sqlcgen.New(tx)

	{
		created, err := queries.InsertTransfer(ctx, sqlcgen.InsertTransferParams{
			ID:             req.ID,
			IdempotencyKey: req.IdempotencyKey,
			ReasonCode:     req.ReasonCode,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			existing, lookupErr := queries.GetTransferByIdempotencyKey(ctx, req.IdempotencyKey)
			if lookupErr != nil {
				return TransferResult{}, fmt.Errorf(
					"reading the transfer that already owns this key: %w", lookupErr)
			}
			return TransferResult{TransferID: existing.ID, Replayed: true}, nil
		}
		if err != nil {
			return TransferResult{}, fmt.Errorf("inserting transfer: %w", err)
		}

		for _, entry := range req.Entries {
			if err := queries.InsertEntry(ctx, sqlcgen.InsertEntryParams{
				TransferID:  created.ID,
				AccountID:   entry.AccountID,
				AmountMinor: entry.AmountMinor,
				Currency:    entry.Currency,
			}); err != nil {
				return TransferResult{}, fmt.Errorf("inserting entry: %w", err)
			}
		}

		// The deferred trigger fires when this transaction commits, not here.
		// If the set is unbalanced the COMMIT fails and nothing is written —
		// which is why validate() above is a courtesy and not the control.
		return TransferResult{TransferID: created.ID, Replayed: false}, nil
	}
}

// Balance projects an account's balance from its entries.
//
// Never a stored column. A stored balance is a second source of truth that
// can disagree with the entries it summarises, and when it does, the entries
// are right and the balance is the bug. Projecting costs an aggregate and
// removes a whole class of reconciliation incident (docs/18).
func (l *Ledger) Balance(ctx context.Context, accountID string) (int64, error) {
	balance, err := sqlcgen.New(l.pool).GetAccountBalance(ctx, accountID)
	if err != nil {
		return 0, fmt.Errorf("projecting balance for %s: %w", accountID, err)
	}
	return balance, nil
}

// Imbalance is one transfer whose entries do not sum to zero.
type Imbalance struct {
	TransferID string
	Amount     int64
}

// CheckInvariants looks for any transfer that does not sum to zero.
//
// It should always find nothing: the deferred trigger makes an imbalanced
// transfer impossible to commit. That is exactly why it is worth running —
// a non-empty result means the trigger was dropped, bypassed by a superuser
// session, or the constraint was deferred and never checked. docs/13 §4 puts
// "invariant checker job fails loudly on any imbalance" on the must-have
// list, and a checker that can only ever pass is still the thing that tells
// you the day it cannot.
func (l *Ledger) CheckInvariants(ctx context.Context) ([]Imbalance, error) {
	rows, err := sqlcgen.New(l.pool).FindImbalancedTransfers(ctx)
	if err != nil {
		return nil, fmt.Errorf("checking ledger invariants: %w", err)
	}

	imbalances := make([]Imbalance, 0, len(rows))
	for _, row := range rows {
		imbalances = append(imbalances, Imbalance{TransferID: row.TransferID, Amount: row.Imbalance})
	}
	return imbalances, nil
}

// withSerializableRetry runs fn in a Serializable transaction, retrying a
// serialization failure. docs/13a §7: Serializable for ledger writes.
//
// Serializable is not paranoia here. Two concurrent transfers touching one
// account at a weaker level can interleave into a state neither would have
// produced alone, and for a ledger that state is money that does not exist.
// Postgres answers a conflict with 40001 and expects the caller to retry —
// so this does, a bounded number of times.
func (l *Ledger) withSerializableRetry(ctx context.Context, fn func(pgx.Tx) error) error {
	return WithSerializableRetry(ctx, l.pool, fn)
}

// WithSerializableRetry runs fn in a Serializable transaction on any pool,
// retrying serialization failures with backoff.
//
// Exported because the Reward Engine needs the same policy: it opens its
// own transaction so the funding drawdown and the ledger post commit
// together, and a second copy of this retry logic would be a second place
// to get the backoff subtly wrong. One policy, one explanation.
func WithSerializableRetry(ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) error {
	var lastErr error

	for attempt := 1; attempt <= maxAttempts; attempt++ {
		err := pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{IsoLevel: pgx.Serializable}, fn)
		if err == nil {
			return nil
		}

		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == serializationFailure {
			lastErr = err
			if waitErr := backoff(ctx, attempt); waitErr != nil {
				return waitErr
			}
			continue
		}
		return err
	}

	return fmt.Errorf("ledger: serialization conflict persisted after %d attempts: %w",
		maxAttempts, lastErr)
}

// backoff sleeps for an exponentially growing, jittered interval. The jitter
// matters more than the growth: without it, every conflicting writer wakes at
// the same instant and collides again, which is how a retry loop turns
// contention into a thundering herd.
func backoff(ctx context.Context, attempt int) error {
	//nolint:gosec // Jitter, not a secret. math/rand is the right tool.
	wait := baseBackoff*time.Duration(1<<uint(attempt-1)) + time.Duration(rand.N(int64(baseBackoff)))

	timer := time.NewTimer(wait)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// validate catches the three ways a caller can ask for something the
// database will refuse, so the error names the problem rather than a
// constraint. It is NOT the enforcement; see the package comment.
func validate(req TransferRequest) error {
	if len(req.Entries) < 2 {
		return ErrTooFewEntries
	}

	var sum int64
	currency := req.Entries[0].Currency
	for _, entry := range req.Entries {
		if entry.AmountMinor == 0 {
			return ErrZeroAmount
		}
		if entry.Currency != currency {
			return ErrMixedCurrency
		}
		sum += entry.AmountMinor
	}
	if sum != 0 {
		return fmt.Errorf("%w: off by %d", ErrUnbalanced, sum)
	}
	return nil
}
