package proof_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/proof"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

const ledgerURL = "postgres://yourtal_ledger:ledger_local_only@127.0.0.1:26432/yourtal"

var counter atomic.Uint64

func unique(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano(), counter.Add(1))
}

// recordingAlerter is the test's pager. It counts rather than logs, because
// the assertion that matters is "a human was paged", not "a line was
// written" — which is the same distinction the Checker's design turns on.
type recordingAlerter struct {
	pages []string
	fail  bool
}

func (a *recordingAlerter) Page(_ context.Context, summary, _ string) error {
	a.pages = append(a.pages, summary)
	if a.fail {
		return fmt.Errorf("pager unreachable")
	}
	return nil
}

func newChecker(t *testing.T, alerter proof.Alerter) (*proof.Checker, *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	url := os.Getenv("LEDGER_DATABASE_URL")
	if url == "" {
		url = ledgerURL
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("no local Postgres (run `pnpm dev:up`): %v", err)
	}
	t.Cleanup(pool.Close)

	return proof.New(pool, alerter), pool
}

// --- the Merkle root itself (no database needed) -------------------------

func TestRootIsDeterministic(t *testing.T) {
	leaves := []proof.Leaf{
		{ID: 1, TransferID: "t1", AccountID: "a", AmountMinor: -100, Currency: "IDR"},
		{ID: 2, TransferID: "t1", AccountID: "b", AmountMinor: 100, Currency: "IDR"},
	}
	if proof.Root(leaves) != proof.Root(leaves) {
		t.Error("the same leaves hashed differently twice")
	}
}

func TestRootChangesWhenAnythingThatMattersChanges(t *testing.T) {
	base := []proof.Leaf{
		{ID: 1, TransferID: "t1", AccountID: "a", AmountMinor: -100, Currency: "IDR"},
		{ID: 2, TransferID: "t1", AccountID: "b", AmountMinor: 100, Currency: "IDR"},
	}
	original := proof.Root(base)

	cases := map[string]func(l []proof.Leaf){
		"the amount":     func(l []proof.Leaf) { l[0].AmountMinor = -99 },
		"the account":    func(l []proof.Leaf) { l[1].AccountID = "c" },
		"the currency":   func(l []proof.Leaf) { l[0].Currency = "AUD" },
		"the transfer":   func(l []proof.Leaf) { l[0].TransferID = "t2" },
		"the entry id":   func(l []proof.Leaf) { l[0].ID = 9 },
		"the leaf order": func(l []proof.Leaf) { l[0], l[1] = l[1], l[0] },
	}

	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			tampered := append([]proof.Leaf(nil), base...)
			mutate(tampered)
			if proof.Root(tampered) == original {
				t.Errorf("changing %s did not change the root", name)
			}
		})
	}
}

func TestEmptyDayHasADefinedRoot(t *testing.T) {
	// A day with no entries is an ordinary day. A checker that could not
	// record one would have a hole in its history exactly where it is least
	// expected — over a weekend, or during an outage.
	if proof.Root(nil) == "" {
		t.Error("an empty day has no root")
	}
	if proof.Root(nil) != proof.Root([]proof.Leaf{}) {
		t.Error("nil and empty disagree")
	}
}

func TestOddLevelsPromoteRatherThanDuplicate(t *testing.T) {
	// CVE-2012-2459's shape: duplicating the last node on an odd level lets
	// two different leaf sets produce the same root, because a duplicated
	// final node is indistinguishable from a genuine pair. Three leaves and
	// "three leaves with the last one repeated" must not collide.
	three := []proof.Leaf{
		{ID: 1, TransferID: "t", AccountID: "a", AmountMinor: 1, Currency: "IDR"},
		{ID: 2, TransferID: "t", AccountID: "b", AmountMinor: -1, Currency: "IDR"},
		{ID: 3, TransferID: "u", AccountID: "c", AmountMinor: 5, Currency: "IDR"},
	}
	four := append(append([]proof.Leaf(nil), three...), three[2])

	if proof.Root(three) == proof.Root(four) {
		t.Error("a duplicated final leaf collided with the un-duplicated set")
	}
}

// --- against the real ledger ---------------------------------------------

func TestVerifyDetectsAnAlteredEntry(t *testing.T) {
	// The assertion the whole mechanism exists for. docs/14 §3: a direct
	// UPDATE via a leaked credential, caught because a published root makes
	// the edit detectable the next day.
	checker, _ := newChecker(t, &recordingAlerter{})
	super := superuser(t)
	ctx := context.Background()

	day := exclusiveDay(t, super)
	transferID := backdatedTransfer(t, super, day, 1_000)

	if _, err := checker.RecordDailyProof(ctx, day); err != nil {
		t.Fatalf("record proof: %v", err)
	}

	// Tamper, keeping the transfer BALANCED so the other invariant stays
	// silent. This is the subtle case: a checker that only looked for
	// imbalances would see nothing wrong at all.
	if _, err := super.Exec(ctx,
		`UPDATE ledger.entry SET amount_minor = amount_minor + 1
		  WHERE transfer_id = $1 AND amount_minor < 0`, transferID); err != nil {
		t.Fatalf("tamper: %v", err)
	}
	if _, err := super.Exec(ctx,
		`UPDATE ledger.entry SET amount_minor = amount_minor - 1
		  WHERE transfer_id = $1 AND amount_minor > 0`, transferID); err != nil {
		t.Fatalf("tamper: %v", err)
	}

	finding, mismatched, err := checker.VerifyDay(ctx, day)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !mismatched {
		t.Fatal("an altered entry did not change the day's root")
	}
	// The count is unchanged, so the finding must say a row was ALTERED
	// rather than that rows arrived late — different incidents entirely.
	if !strings.Contains(finding.Detail, "ALTERED") {
		t.Errorf("finding did not distinguish alteration from late arrival: %s", finding.Detail)
	}
}

func TestVerifyDistinguishesLateArrivalFromAlteration(t *testing.T) {
	// A late-arriving entry and a tampered one produce the same root
	// mismatch. Reporting them identically would send someone hunting a
	// breach over a clock skew, or shrug off a breach as a clock skew.
	checker, _ := newChecker(t, &recordingAlerter{})
	super := superuser(t)
	ctx := context.Background()

	day := exclusiveDay(t, super)
	backdatedTransfer(t, super, day, 500)

	if _, err := checker.RecordDailyProof(ctx, day); err != nil {
		t.Fatalf("record proof: %v", err)
	}

	// A second transfer written into a day already closed.
	backdatedTransfer(t, super, day, 250)

	finding, mismatched, err := checker.VerifyDay(ctx, day)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if !mismatched {
		t.Fatal("rows written into a closed day did not change its root")
	}
	if !strings.Contains(finding.Detail, "COUNT changed") {
		t.Errorf("finding did not identify late arrival: %s", finding.Detail)
	}
}

func TestADayCanOnlyBeProvedOnce(t *testing.T) {
	// An attacker who can edit an entry AND recompute its day's root has
	// defeated the whole scheme, so the ability to recompute is the thing
	// being denied. INSERT-only by grant, primary key by date.
	checker, _ := newChecker(t, &recordingAlerter{})
	super := superuser(t)
	ctx := context.Background()

	day := exclusiveDay(t, super)
	if _, err := checker.RecordDailyProof(ctx, day); err != nil {
		t.Fatalf("first proof: %v", err)
	}
	if _, err := checker.RecordDailyProof(ctx, day); err == nil {
		t.Error("a day was proved twice; a root that can be rewritten proves nothing")
	}
}

func TestRunPagesRatherThanMerelyLogging(t *testing.T) {
	// "Any imbalance pages a human; it does not merely log." The Checker
	// cannot be built without an Alerter, so there is no version of this
	// that quietly writes a line instead.
	alerter := &recordingAlerter{}
	checker, pool := newChecker(t, alerter)
	ctx := context.Background()

	super, err := pgxpool.New(ctx, superuserURL())
	if err != nil {
		t.Fatalf("superuser connect: %v", err)
	}
	defer super.Close()

	transferID := writeTransfer(t, pool, 500)

	// Break the balance with a superuser, which is the only thing that can.
	defer tamperBalance(t, ctx, super, transferID, 7)()

	findings, err := checker.Run(ctx)
	if err != nil {
		t.Fatalf("run: %v", err)
	}

	if len(findings) == 0 {
		t.Fatal("an imbalanced transfer was not found")
	}
	if len(alerter.pages) == 0 {
		t.Fatal("findings were returned but nobody was paged")
	}
}

func TestAFailedPageIsItselfAnIncident(t *testing.T) {
	// An unraisable alert during a ledger imbalance is the worst combination
	// available, so Run returns the error rather than swallowing it.
	alerter := &recordingAlerter{fail: true}
	checker, pool := newChecker(t, alerter)
	ctx := context.Background()

	super, err := pgxpool.New(ctx, superuserURL())
	if err != nil {
		t.Fatalf("superuser connect: %v", err)
	}
	defer super.Close()

	transferID := writeTransfer(t, pool, 300)
	defer tamperBalance(t, ctx, super, transferID, 3)()

	if _, err := checker.Run(ctx); err == nil {
		t.Error("the pager failed during an imbalance and Run reported success")
	}
}

func TestACleanLedgerPagesNobody(t *testing.T) {
	// The other half: a checker that pages on a healthy ledger is one people
	// mute, and a muted pager is no pager at all.
	alerter := &recordingAlerter{}
	checker, _ := newChecker(t, alerter)

	if _, err := checker.Run(context.Background()); err != nil {
		t.Fatalf("run: %v", err)
	}
	if len(alerter.pages) != 0 {
		t.Errorf("a clean ledger raised %d pages: %v", len(alerter.pages), alerter.pages)
	}
}

// writeTransfer posts a balanced transfer and returns its id.
func writeTransfer(t *testing.T, pool *pgxpool.Pool, amount int64) string {
	t.Helper()
	ctx := context.Background()
	queries := sqlcgen.New(pool)

	from, to := unique("acc_p_a"), unique("acc_p_b")
	for _, id := range []string{from, to} {
		if err := queries.InsertAccount(ctx, sqlcgen.InsertAccountParams{
			ID: id, OwnerType: "platform", OwnerID: id, Currency: "IDR",
			Kind: "equity", Country: "ID",
		}); err != nil {
			t.Fatalf("account: %v", err)
		}
	}

	book := ledger.New(pool)
	result, err := book.Transfer(ctx, ledger.TransferRequest{
		ID:             unique("led_txn_proof"),
		IdempotencyKey: unique("idem_proof"),
		ReasonCode:     "proof_test",
		Entries: []ledger.Entry{
			{AccountID: from, AmountMinor: -amount, Currency: "IDR"},
			{AccountID: to, AmountMinor: amount, Currency: "IDR"},
		},
	})
	if err != nil {
		t.Fatalf("transfer: %v", err)
	}
	return result.TransferID
}

// superuser is the only connection that can backdate or delete a ledger row.
// The tests need it for two opposite reasons: to TAMPER (which the ledger
// role deliberately cannot, so the tamper must outrank the control being
// tested) and to CLEAN UP (so these tests are repeatable — see exclusiveDay).
func superuser(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool, err := pgxpool.New(context.Background(),
		superuserURL())
	if err != nil {
		t.Fatalf("superuser connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// exclusiveDay gives a test a historical day nothing else uses, and removes
// everything it wrote afterwards.
//
// This exists because a day can only be proved ONCE — which is the property
// being tested, and which also made the first version of these tests
// unrepeatable: the second run found today already proved and called
// t.Skip. Two skipped tests that look like passes, in the suite whose whole
// point is that a silent skip proves nothing. The fix is cleanup, not a
// skip.
func exclusiveDay(t *testing.T, super *pgxpool.Pool) time.Time {
	t.Helper()
	// Far enough back that no real entry could land there, and distinct per
	// test so parallel or repeated runs cannot collide.
	day := time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC).
		AddDate(0, 0, int(counter.Add(1))*7)

	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = super.Exec(ctx, `DELETE FROM ledger.daily_proof WHERE proof_date = $1`, day)
		_, _ = super.Exec(ctx,
			`DELETE FROM ledger.entry WHERE created_at >= $1 AND created_at < $1 + interval '1 day'`, day)
		_, _ = super.Exec(ctx,
			`DELETE FROM ledger.transfer WHERE reason_code = 'proof_backdated'
			   AND NOT EXISTS (SELECT 1 FROM ledger.entry e WHERE e.transfer_id = ledger.transfer.id)`)
	})
	return day
}

// backdatedTransfer writes a balanced transfer INTO a past day, which only a
// superuser can do: created_at defaults to now() and the ledger role cannot
// override it. Returns the transfer id.
func backdatedTransfer(t *testing.T, super *pgxpool.Pool, day time.Time, amount int64) string {
	t.Helper()
	ctx := context.Background()

	transferID := unique("led_txn_back")
	from, to := unique("acc_back_a"), unique("acc_back_b")

	for _, id := range []string{from, to} {
		if _, err := super.Exec(ctx,
			`INSERT INTO ledger.account (id, owner_type, owner_id, currency, kind, country)
			 VALUES ($1,'platform',$1,'IDR','equity','ID')`, id); err != nil {
			t.Fatalf("account: %v", err)
		}
	}
	if _, err := super.Exec(ctx,
		`INSERT INTO ledger.transfer (id, idempotency_key, reason_code, created_at)
		 VALUES ($1,$2,'proof_backdated',$3)`, transferID, unique("idem_back"), day); err != nil {
		t.Fatalf("transfer: %v", err)
	}
	if _, err := super.Exec(ctx,
		`INSERT INTO ledger.entry (transfer_id, account_id, amount_minor, currency, created_at)
		 VALUES ($1,$2,$4,'IDR',$5), ($1,$3,$6,'IDR',$5)`,
		transferID, from, to, -amount, day, amount); err != nil {
		t.Fatalf("entries: %v", err)
	}
	return transferID
}

// tamperBalance applies a superuser imbalance to a transfer and returns a
// restore function that VERIFIES the ledger balanced again, rather than
// merely attempting it. YT-0567.
//
// # Why the discarded error was worth a ticket
//
// The restores here were `_, _ = super.Exec(...)` inside a `defer`. Three
// ways that goes wrong and says nothing: the Exec fails, the process takes a
// SIGINT between tamper and defer, or an assertion panics. Each leaves
// `ledger.entry` PERMANENTLY imbalanced in a database several packages and,
// on this machine, several sessions share — and the next thing to notice is
// `TestInvariantCheckerFindsNoImbalance` in another package failing for a
// reason that has nothing to do with it. That is the confusion YT-0567 was
// filed about, arriving by a second route.
//
// # Verified, not attempted
//
// Asserting the Exec's error is necessary and not sufficient: an UPDATE that
// matches zero rows succeeds. So the restore re-reads the transfer and
// asserts the entries sum to zero, which is the property the other package
// depends on. A cleanup that reports success without checking its own effect
// is the same shape as the gates `docs/13d` collects.
//
// Deliberately NOT made balance-preserving. Line 149's tamper keeps the
// transfer balanced on purpose, because that test's subject is a change the
// balance check CANNOT see. These two are the opposite: their subject is the
// imbalance itself — "Break the balance with a superuser, which is the only
// thing that can" — so making them balanced would delete the thing under
// test. Isolation is the fix for cross-package visibility (YT-0547), not
// weakening the tamper.
func tamperBalance(t *testing.T, ctx context.Context, super *pgxpool.Pool, transferID string, delta int64) func() {
	t.Helper()
	if _, err := super.Exec(ctx,
		`UPDATE ledger.entry SET amount_minor = amount_minor + $2 WHERE transfer_id = $1 AND amount_minor > 0`,
		transferID, delta); err != nil {
		t.Fatalf("tamper: %v", err)
	}
	return func() {
		if _, err := super.Exec(ctx,
			`UPDATE ledger.entry SET amount_minor = amount_minor - $2 WHERE transfer_id = $1 AND amount_minor > 0`,
			transferID, delta); err != nil {
			t.Errorf("RESTORE FAILED — ledger.entry is left imbalanced for transfer %s by %d: %v",
				transferID, delta, err)
			return
		}
		var sum int64
		if err := super.QueryRow(ctx,
			`SELECT COALESCE(SUM(amount_minor), 0) FROM ledger.entry WHERE transfer_id = $1`,
			transferID).Scan(&sum); err != nil {
			t.Errorf("restore not verified for transfer %s: %v", transferID, err)
			return
		}
		if sum != 0 {
			t.Errorf("restore ran and did NOT balance transfer %s: entries sum to %d, want 0", transferID, sum)
		}
	}
}

// superuserURL follows DATABASE_OWNER_URL so the tampering happens in the
// same database the checker reads (a slot or test database, not always yourtal).
func superuserURL() string {
	if url := os.Getenv("DATABASE_OWNER_URL"); url != "" {
		return url
	}
	return "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal"
}
