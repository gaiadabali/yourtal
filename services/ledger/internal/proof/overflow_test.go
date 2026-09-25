package proof_test

import (
	"context"
	"math"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// EM-23: FindImbalancedTransfers cast SUM to bigint, so a tampered transfer
// whose sum overflows made the checker error out instead of reporting it.
func TestTheCheckerReportsAnOverflowingImbalance(t *testing.T) {
	alerter := &recordingAlerter{}
	checker, _ := newChecker(t, alerter)
	ctx := context.Background()

	super, err := pgxpool.New(ctx, superuserURL(t))
	if err != nil {
		t.Fatalf("superuser connect: %v", err)
	}
	defer super.Close()

	transferID := unique("led_txn_overflow")
	account := unique("acc_overflow")
	tx, err := super.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// replica skips the balance trigger, as a superuser tampering would.
	for _, stmt := range []string{
		`SET LOCAL session_replication_role = replica`,
		`INSERT INTO ledger.account (id, owner_type, owner_id, currency, kind, country) VALUES ('` + account + `','platform','p','IDR','equity','ID')`,
		`INSERT INTO ledger.transfer (id, idempotency_key, reason_code) VALUES ('` + transferID + `','` + transferID + `','tamper')`,
	} {
		if _, err := tx.Exec(ctx, stmt); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := tx.Exec(ctx, `INSERT INTO ledger.entry (transfer_id, account_id, amount_minor, currency)
		VALUES ($1, $2, $3, 'IDR'), ($1, $2, $3, 'IDR')`, transferID, account, int64(math.MaxInt64)); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	defer func() {
		for _, stmt := range []string{
			`DELETE FROM ledger.entry WHERE transfer_id = $1`, `DELETE FROM ledger.transfer WHERE id = $1`,
		} {
			if _, err := super.Exec(ctx, stmt, transferID); err != nil {
				t.Errorf("cleanup: %v", err)
			}
		}
	}()

	findings, err := checker.Run(ctx)
	if err != nil {
		t.Fatalf("the checker failed instead of reporting: %v", err)
	}
	for _, f := range findings {
		if strings.Contains(f.Detail, transferID) && strings.Contains(f.Detail, "18446744073709551614") {
			return
		}
	}
	t.Fatalf("the overflowing transfer was not reported with its true sum: %+v", findings)
}
