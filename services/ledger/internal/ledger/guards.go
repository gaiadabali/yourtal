package ledger

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// The ledger guards (4.3). Postgres enforces each of them; the checks here
// only turn a refusal into a sentinel error before anything is written.

var marketingCashID = regexp.MustCompile(`^plat_(AU|ID)_marketing_cash$`)

// Guarded reports whether an account may never go below zero: a user's
// points, marketing cash and a merchant's payable. The overdraft trigger in
// 20260925181000_ledger_guards.sql uses the same rule.
func Guarded(ownerType, purpose, id string) bool {
	return ownerType == string(OwnerUser) || purpose == string(PurposePayable) || marketingCashID.MatchString(id)
}

// requestHash fingerprints what a transfer does, so a reused idempotency key
// with a different payload is a conflict rather than a silent replay (EM-14).
// The caller's transfer id is left out: a retry may mint a fresh one.
func requestHash(req TransferRequest) []byte {
	var b strings.Builder
	b.WriteString(req.ReasonCode)
	b.WriteByte('\n')
	b.WriteString(req.Reverses)
	for _, e := range req.Entries {
		fmt.Fprintf(&b, "\n%s\x1f%d\x1f%s", e.AccountID, e.AmountMinor, e.Currency)
	}
	sum := sha256.Sum256([]byte(b.String()))
	return sum[:]
}

// guardDebits locks every guarded account this transfer takes value from,
// in id order so two transfers never wait on each other in a cycle, and
// refuses one that would go below zero (EM-04).
func guardDebits(ctx context.Context, q *sqlcgen.Queries, entries []Entry) error {
	net := map[string]int64{}
	for _, e := range entries {
		net[e.AccountID] += e.AmountMinor
	}
	ids := make([]string, 0, len(net))
	for id := range net {
		ids = append(ids, id)
	}
	sort.Strings(ids)

	for _, id := range ids {
		account, err := q.GetAccount(ctx, id)
		if err != nil {
			return fmt.Errorf("reading account %s: %w", id, err)
		}
		change := net[id]
		if account.Kind == string(KindAsset) || account.Kind == string(KindExpense) {
			change = -change
		}
		if change >= 0 || !Guarded(account.OwnerType, account.Purpose, account.ID) {
			continue
		}
		if err := q.LockAccount(ctx, id); err != nil {
			return fmt.Errorf("locking %s: %w", id, err)
		}
		balance, err := q.GetAccountBalance(ctx, id)
		if err != nil {
			return fmt.Errorf("reading the balance of %s: %w", id, err)
		}
		if balance+change < 0 {
			return fmt.Errorf("%w: %s holds %d, the transfer takes %d", ErrInsufficientFunds, id, balance, -change)
		}
	}
	return nil
}

// sumExactly adds in arbitrary precision; an int64 sum wraps (EM-23).
func sumExactly(entries []Entry) *big.Int {
	total := new(big.Int)
	for _, e := range entries {
		total.Add(total, big.NewInt(e.AmountMinor))
	}
	return total
}

// asLedgerError maps the guard triggers' refusals at COMMIT to sentinels.
func asLedgerError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && strings.HasPrefix(pgErr.Message, "ledger: overdraft") {
		return fmt.Errorf("%w: %s", ErrInsufficientFunds, pgErr.Message)
	}
	return err
}
