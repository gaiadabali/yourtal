package proof

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

// Checker computes daily proofs and verifies past ones. YT-0044.
//
// # "Any imbalance pages a human; it does not merely log"
//
// That acceptance criterion is about a verb, and the verb matters. A logged
// imbalance is a line in a stream nobody reads at 3am; a paged one wakes
// somebody. So `Alerter` is a required constructor argument rather than an
// optional field — there is no way to build a Checker that can only log,
// because the version that can is the version that ships.
type Checker struct {
	pool    *pgxpool.Pool
	alerter Alerter
}

// Alerter raises an incident. Deliberately not a logger: a logger has a
// method for every severity and the quiet ones are always available.
type Alerter interface {
	// Page raises a human-visible incident. Returning an error means the
	// PAGE failed, which is itself an incident — an unraisable alert during
	// a ledger imbalance is the worst combination available.
	Page(ctx context.Context, summary string, detail string) error
}

func New(pool *pgxpool.Pool, alerter Alerter) *Checker {
	return &Checker{pool: pool, alerter: alerter}
}

// Finding is one thing wrong with the ledger.
type Finding struct {
	Kind   string
	Detail string
}

var (
	// ErrImbalance — a transfer's entries do not sum to zero. Should be
	// impossible: the deferred trigger refuses it at COMMIT. If this fires,
	// the trigger has been dropped or bypassed.
	ErrImbalance = errors.New("ledger: imbalanced transfer found")
	// ErrProofMismatch — a past day's entries no longer hash to the root
	// recorded for that day. Something edited history.
	ErrProofMismatch = errors.New("ledger: a past day's Merkle root no longer matches")
)

// RecordDailyProof computes and stores the root for one UTC day.
//
// Storing is INSERT-only by grant, so a day can be proved once. Re-running
// for a day already recorded fails rather than overwriting — an attacker who
// can edit an entry AND recompute its day's root has defeated the entire
// scheme, so the ability to recompute is the thing being denied.
func (c *Checker) RecordDailyProof(ctx context.Context, day time.Time) (string, error) {
	leaves, err := c.leavesFor(ctx, day)
	if err != nil {
		return "", err
	}

	root := Root(leaves)
	queries := sqlcgen.New(c.pool)

	var first, last *int64
	if len(leaves) > 0 {
		first = &leaves[0].ID
		last = &leaves[len(leaves)-1].ID
	}

	if err := queries.InsertDailyProof(ctx, sqlcgen.InsertDailyProofParams{
		ProofDate:    pgtype.Date{Time: startOfDay(day), Valid: true},
		MerkleRoot:   root,
		EntryCount:   int64(len(leaves)),
		FirstEntryID: first,
		LastEntryID:  last,
	}); err != nil {
		return "", fmt.Errorf("recording proof for %s: %w", startOfDay(day).Format(time.DateOnly), err)
	}

	return root, nil
}

// VerifyDay recomputes a past day's root and compares it to what was stored.
//
// The entry count is compared first and reported separately, because a
// late-arriving entry and a tampered one produce the same root mismatch and
// are very different incidents. A count that grew means something wrote into
// a closed day; a count that matches while the root differs means something
// CHANGED a row that was already there, which is the one docs/14 §3 is about.
func (c *Checker) VerifyDay(ctx context.Context, day time.Time) (Finding, bool, error) {
	stored, err := sqlcgen.New(c.pool).GetDailyProof(ctx, pgtype.Date{Time: startOfDay(day), Valid: true})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Finding{}, false, nil // never proved; nothing to verify
		}
		return Finding{}, false, fmt.Errorf("reading proof: %w", err)
	}

	leaves, err := c.leavesFor(ctx, day)
	if err != nil {
		return Finding{}, false, err
	}

	recomputed := Root(leaves)
	if recomputed == stored.MerkleRoot {
		return Finding{}, false, nil
	}

	detail := fmt.Sprintf(
		"day=%s stored_root=%s recomputed_root=%s stored_count=%d current_count=%d",
		startOfDay(day).Format(time.DateOnly), stored.MerkleRoot, recomputed,
		stored.EntryCount, len(leaves),
	)
	if int64(len(leaves)) != stored.EntryCount {
		detail += " — the entry COUNT changed, so rows were written into a day already closed"
	} else {
		detail += " — the count is unchanged, so an existing row was ALTERED"
	}

	return Finding{Kind: "proof_mismatch", Detail: detail}, true, nil
}

// Run is the continuous job: check every invariant, page on anything found.
//
// Returns the findings as well as paging, so a caller can log or expose them
// — but the page happens here, not at the caller's discretion. A checker
// that returned findings and left alerting to whoever remembered would be a
// checker that silently stops mattering the first time someone ignores it.
func (c *Checker) Run(ctx context.Context) ([]Finding, error) {
	var findings []Finding

	imbalanced, err := sqlcgen.New(c.pool).FindImbalancedTransfers(ctx)
	if err != nil {
		return nil, fmt.Errorf("checking balances: %w", err)
	}
	for _, row := range imbalanced {
		findings = append(findings, Finding{
			Kind: "imbalance",
			Detail: fmt.Sprintf("transfer=%s imbalance=%s — the deferred trigger was bypassed or dropped",
				row.TransferID, row.Imbalance),
		})
	}

	// Yesterday, because today is still being written to and its root is not
	// final until the day closes.
	yesterday := time.Now().UTC().AddDate(0, 0, -1)
	finding, mismatched, err := c.VerifyDay(ctx, yesterday)
	if err != nil {
		return nil, err
	}
	if mismatched {
		findings = append(findings, finding)
	}

	for _, found := range findings {
		if err := c.alerter.Page(ctx, "ledger invariant violated: "+found.Kind, found.Detail); err != nil {
			// An unraisable page during a ledger imbalance is the worst
			// combination available, so it is returned rather than logged.
			return findings, fmt.Errorf("could not page on %s: %w", found.Kind, err)
		}
	}

	return findings, nil
}

// leavesFor reads one UTC day's entries in id order.
func (c *Checker) leavesFor(ctx context.Context, day time.Time) ([]Leaf, error) {
	from := startOfDay(day)
	rows, err := sqlcgen.New(c.pool).ListEntriesForDay(ctx, sqlcgen.ListEntriesForDayParams{
		CreatedAt:   pgtype.Timestamptz{Time: from, Valid: true},
		CreatedAt_2: pgtype.Timestamptz{Time: from.AddDate(0, 0, 1), Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("reading entries for %s: %w", from.Format(time.DateOnly), err)
	}

	leaves := make([]Leaf, 0, len(rows))
	for _, row := range rows {
		leaves = append(leaves, Leaf{
			ID: row.ID, TransferID: row.TransferID, AccountID: row.AccountID,
			AmountMinor: row.AmountMinor, Currency: row.Currency,
		})
	}
	return leaves, nil
}

func startOfDay(t time.Time) time.Time {
	utc := t.UTC()
	return time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
}
