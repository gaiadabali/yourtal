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
	store   RootStore
	// now is the clock RecordDailyProof checks "today or future" against —
	// injectable so a test can prove the guard without waiting for a real
	// day to close. Defaults to time.Now in New.
	now func() time.Time
}

// GracePeriod (10.3.a): a day closes GracePeriod after its own midnight
// UTC, not exactly at it — an entry still landing in the last seconds of a
// day (a request that started just before midnight and committed just
// after) gets a window to arrive before the day is closed under it.
const GracePeriod = 1 * time.Hour

// Alerter raises an incident. Deliberately not a logger: a logger has a
// method for every severity and the quiet ones are always available.
type Alerter interface {
	// Page raises a human-visible incident. Returning an error means the
	// PAGE failed, which is itself an incident — an unraisable alert during
	// a ledger imbalance is the worst combination available.
	Page(ctx context.Context, summary string, detail string) error
}

func New(pool *pgxpool.Pool, alerter Alerter) *Checker {
	return &Checker{pool: pool, alerter: alerter, now: time.Now}
}

// WithRootStore adds 10.3.a's external append-only copy. Without one,
// RecordDailyProof still writes ledger.daily_proof — the store is a second
// witness, not the only record.
func (c *Checker) WithRootStore(store RootStore) *Checker {
	c.store = store
	return c
}

// WithClock overrides the "is this day closed yet" clock — tests only.
func (c *Checker) WithClock(now func() time.Time) *Checker {
	c.now = now
	return c
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

// ErrDayNotClosed — today or a future day, or one still inside its grace
// period, cannot be proved yet: entries could still land in it.
var ErrDayNotClosed = errors.New("proof: today or a future day cannot be proved yet")

// RecordDailyProof computes and stores the root for one UTC day.
//
// Storing is INSERT-only by grant, so a day can be proved once. Re-running
// for a day already recorded fails rather than overwriting — an attacker who
// can edit an entry AND recompute its day's root has defeated the entire
// scheme, so the ability to recompute is the thing being denied.
//
// 10.3.a: refuses today and any future day, and gives yesterday its own
// GracePeriod before closing it — this is the "after day close with a grace
// period" the task asks for, not merely a caller convention.
func (c *Checker) RecordDailyProof(ctx context.Context, day time.Time) (string, error) {
	if !startOfDay(day).Add(24 * time.Hour).Add(GracePeriod).Before(c.now()) {
		return "", fmt.Errorf("%w: %s", ErrDayNotClosed, startOfDay(day).Format(time.DateOnly))
	}

	leaves, heads, err := c.dayFor(ctx, day)
	if err != nil {
		return "", err
	}

	// 4.6.h: the root covers the day's voucher chain heads when it has any.
	root, ledgerRoot, headsRoot := combineRoots(leaves, heads)
	queries := sqlcgen.New(c.pool)

	var first, last *int64
	if len(leaves) > 0 {
		first = &leaves[0].ID
		last = &leaves[len(leaves)-1].ID
	}

	if err := queries.InsertDailyProof(ctx, sqlcgen.InsertDailyProofParams{
		ProofDate:        pgtype.Date{Time: startOfDay(day), Valid: true},
		MerkleRoot:       root,
		EntryCount:       int64(len(leaves)),
		FirstEntryID:     first,
		LastEntryID:      last,
		LedgerRoot:       &ledgerRoot,
		VoucherHeadsRoot: headsRootOrNil(headsRoot),
		VoucherHeadCount: int64(len(heads)),
	}); err != nil {
		return "", fmt.Errorf("recording proof for %s: %w", startOfDay(day).Format(time.DateOnly), err)
	}

	// 10.3.a's outside-the-database copy. Best-effort in the sense that a
	// store outage does not lose the day's own proof (already committed
	// above) — but it is not silent: the caller gets the error and can page
	// on it, same as any other write that mattered failing.
	if c.store != nil {
		if err := c.store.Append(ctx, day, root); err != nil {
			return root, fmt.Errorf("recording proof for %s in the external store: %w", startOfDay(day).Format(time.DateOnly), err)
		}
	}

	return root, nil
}

// ProvedDay is one proved day, as 10.3.b's GET /api/proof/roots publishes
// it — F11's "without a blockchain": anyone can recompute this from their
// own copy of the day's entries and compare.
type ProvedDay struct {
	Date       string
	MerkleRoot string
	EntryCount int64
	ComputedAt time.Time
}

// ListRoots answers every day proved so far, oldest first.
func (c *Checker) ListRoots(ctx context.Context) ([]ProvedDay, error) {
	rows, err := sqlcgen.New(c.pool).ListDailyProofs(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing daily proofs: %w", err)
	}
	roots := make([]ProvedDay, 0, len(rows))
	for _, row := range rows {
		roots = append(roots, ProvedDay{
			Date: row.ProofDate.Time.Format(time.DateOnly), MerkleRoot: row.MerkleRoot,
			EntryCount: row.EntryCount, ComputedAt: row.ComputedAt.Time,
		})
	}
	return roots, nil
}

// VerifyAllProvedDays is 10.3.a's "verify every proved day", not merely
// yesterday's — Run()'s own per-tick check only re-derives the freshest day
// (cheap, catches drift within the hour), so a tamper to an OLDER day would
// sit undetected between runs of this. Meant for a slower, once-a-day
// schedule (cmd/ledger/main.go), not the 15-minute loop: it recomputes a
// full Merkle tree per day on the ledger's whole history.
func (c *Checker) VerifyAllProvedDays(ctx context.Context) ([]Finding, error) {
	roots, err := c.ListRoots(ctx)
	if err != nil {
		return nil, fmt.Errorf("listing proved days to verify: %w", err)
	}
	var findings []Finding
	for _, root := range roots {
		day, err := time.Parse(time.DateOnly, root.Date)
		if err != nil {
			return findings, fmt.Errorf("parsing proved day %q: %w", root.Date, err)
		}
		finding, mismatched, err := c.VerifyDay(ctx, day)
		if err != nil {
			return findings, fmt.Errorf("verifying %s: %w", root.Date, err)
		}
		if mismatched {
			findings = append(findings, finding)
		}
		if externalFinding, externalMismatch, err := c.VerifyExternalStore(ctx, day); err != nil {
			return findings, fmt.Errorf("verifying %s against the external store: %w", root.Date, err)
		} else if externalMismatch {
			findings = append(findings, externalFinding)
		}
	}
	return findings, nil
}

// RecordDailyProofIfMissing is what a scheduled loop calls: it is safe to
// call every tick, because a day already recorded is answered from storage,
// never re-derived and never an error — only ErrDayNotClosed (too early) or
// an actual failure to write are.
func (c *Checker) RecordDailyProofIfMissing(ctx context.Context, day time.Time) (string, error) {
	existing, err := sqlcgen.New(c.pool).GetDailyProof(ctx, pgtype.Date{Time: startOfDay(day), Valid: true})
	if err == nil {
		return existing.MerkleRoot, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("reading proof for %s: %w", startOfDay(day).Format(time.DateOnly), err)
	}
	return c.RecordDailyProof(ctx, day)
}

// VerifyExternalStore compares a day's database root against its external
// copy — a mismatch means one of the two was edited after the fact, and
// which one takes a human to decide, so this pages rather than picking.
func (c *Checker) VerifyExternalStore(ctx context.Context, day time.Time) (Finding, bool, error) {
	if c.store == nil {
		return Finding{}, false, nil
	}
	stored, err := sqlcgen.New(c.pool).GetDailyProof(ctx, pgtype.Date{Time: startOfDay(day), Valid: true})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Finding{}, false, nil
		}
		return Finding{}, false, fmt.Errorf("reading proof: %w", err)
	}
	external, err := c.store.Read(ctx, day)
	if errors.Is(err, ErrRootNotStored) {
		return Finding{
			Kind:   "proof_external_store_missing",
			Detail: fmt.Sprintf("day=%s has a database root but none in the external store", startOfDay(day).Format(time.DateOnly)),
		}, true, nil
	}
	if err != nil {
		return Finding{}, false, fmt.Errorf("reading the external root store: %w", err)
	}
	if external != stored.MerkleRoot {
		return Finding{
			Kind: "proof_external_store_mismatch",
			Detail: fmt.Sprintf("day=%s database_root=%s external_root=%s — one of the two was edited after the fact",
				startOfDay(day).Format(time.DateOnly), stored.MerkleRoot, external),
		}, true, nil
	}
	return Finding{}, false, nil
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

	leaves, heads, err := c.dayFor(ctx, day)
	if err != nil {
		return Finding{}, false, err
	}

	recomputed, _, _ := combineRoots(leaves, heads)
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
	yesterday := c.now().UTC().AddDate(0, 0, -1)
	finding, mismatched, err := c.VerifyDay(ctx, yesterday)
	if err != nil {
		return nil, err
	}
	if mismatched {
		findings = append(findings, finding)
	}
	if externalFinding, externalMismatch, err := c.VerifyExternalStore(ctx, yesterday); err != nil {
		return nil, err
	} else if externalMismatch {
		findings = append(findings, externalFinding)
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

// dayFor reads both halves of one UTC day's proof.
func (c *Checker) dayFor(ctx context.Context, day time.Time) ([]Leaf, []VoucherHeadLeaf, error) {
	leaves, err := c.leavesFor(ctx, day)
	if err != nil {
		return nil, nil, err
	}
	heads, err := c.headsFor(ctx, day)
	return leaves, heads, err
}

func headsRootOrNil(root string) *string {
	if root == "" {
		return nil
	}
	return &root
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
