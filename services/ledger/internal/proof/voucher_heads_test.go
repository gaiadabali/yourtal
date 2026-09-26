package proof_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/proof"
)

// 4.6.h (D6, F11): a day's anchored voucher heads are covered by that day's
// root, and a day with none proves exactly as before.

func headHash(seed string) string {
	sum := sha256.Sum256([]byte(seed))
	return hex.EncodeToString(sum[:])
}

func backdatedAnchor(t *testing.T, super *pgxpool.Pool, day time.Time, voucherID string, seq int64, hash, region string) {
	t.Helper()
	if _, err := super.Exec(context.Background(),
		`INSERT INTO ledger.voucher_head_anchor (voucher_id, seq, head_hash, region, created_at)
		 VALUES ($1, $2, $3, $4, $5)`, voucherID, seq, hash, region, day.Add(time.Hour)); err != nil {
		t.Fatalf("backdated anchor: %v", err)
	}
}

func storedProof(t *testing.T, super *pgxpool.Pool, day time.Time) (merkle string, ledgerRoot, headsRoot *string, count int64) {
	t.Helper()
	if err := super.QueryRow(context.Background(),
		`SELECT merkle_root, ledger_root, voucher_heads_root, voucher_head_count FROM ledger.daily_proof WHERE proof_date = $1`,
		day).Scan(&merkle, &ledgerRoot, &headsRoot, &count); err != nil {
		t.Fatalf("reading the stored proof: %v", err)
	}
	return merkle, ledgerRoot, headsRoot, count
}

func TestADayWithNoAnchorsProvesExactlyAsBefore(t *testing.T) {
	checker, _ := newChecker(t, &recordingAlerter{})
	super := superuser(t)
	ctx := context.Background()
	day := exclusiveDay(t, super)
	backdatedTransfer(t, super, day, 1_000)

	root, err := checker.RecordDailyProof(ctx, day)
	if err != nil {
		t.Fatalf("record proof: %v", err)
	}
	merkle, ledgerRoot, headsRoot, count := storedProof(t, super, day)
	if merkle != root || ledgerRoot == nil || *ledgerRoot != root || headsRoot != nil || count != 0 {
		t.Fatalf("stored %s / %v / %v / %d, want the ledger-only root %s and no heads", merkle, ledgerRoot, headsRoot, count, root)
	}
	if _, mismatched, err := checker.VerifyDay(ctx, day); err != nil || mismatched {
		t.Fatalf("VerifyDay: mismatched=%v err=%v", mismatched, err)
	}
}

// A day recorded before 4.6.h (no ledger_root) still verifies.
func TestADayRecordedBeforeAnchoringStillVerifies(t *testing.T) {
	checker, _ := newChecker(t, &recordingAlerter{})
	super := superuser(t)
	ctx := context.Background()
	day := exclusiveDay(t, super)
	backdatedTransfer(t, super, day, 700)

	if _, err := checker.RecordDailyProof(ctx, day); err != nil {
		t.Fatalf("record proof: %v", err)
	}
	if _, err := super.Exec(ctx,
		`UPDATE ledger.daily_proof SET ledger_root = NULL, voucher_heads_root = NULL WHERE proof_date = $1`, day); err != nil {
		t.Fatalf("simulating an old row: %v", err)
	}
	if _, mismatched, err := checker.VerifyDay(ctx, day); err != nil || mismatched {
		t.Fatalf("VerifyDay on a pre-4.6.h row: mismatched=%v err=%v", mismatched, err)
	}
}

func TestAnchoredHeadsAreCoveredAndATamperedOneBreaksTheRoot(t *testing.T) {
	checker, _ := newChecker(t, &recordingAlerter{})
	super := superuser(t)
	ctx := context.Background()
	day := exclusiveDay(t, super)
	backdatedTransfer(t, super, day, 500)
	voucherID := "0195c3aa-0000-4000-8000-000000000002"
	backdatedAnchor(t, super, day, voucherID, 3, headHash(unique("head")), "ID")

	root, err := checker.RecordDailyProof(ctx, day)
	if err != nil {
		t.Fatalf("record proof: %v", err)
	}
	_, ledgerRoot, headsRoot, count := storedProof(t, super, day)
	if headsRoot == nil || count != 1 || ledgerRoot == nil || root == *ledgerRoot {
		t.Fatalf("the root does not cover the anchor: heads %v, count %d", headsRoot, count)
	}
	if _, mismatched, err := checker.VerifyDay(ctx, day); err != nil || mismatched {
		t.Fatalf("VerifyDay before tampering: mismatched=%v err=%v", mismatched, err)
	}

	if _, err := super.Exec(ctx,
		`UPDATE ledger.voucher_head_anchor SET head_hash = $2 WHERE voucher_id = $1`, voucherID, headHash("forged")); err != nil {
		t.Fatalf("tamper: %v", err)
	}
	if _, mismatched, err := checker.VerifyDay(ctx, day); err != nil || !mismatched {
		t.Fatalf("a tampered anchor went unnoticed: mismatched=%v err=%v", mismatched, err)
	}
}

func TestAnchorHeadsReplaysAndRefusesARewrittenHead(t *testing.T) {
	alerter := &recordingAlerter{}
	checker, _ := newChecker(t, alerter)
	ctx := context.Background()
	voucherID := fmt.Sprintf("0195c3aa-0000-4000-8000-%012d", time.Now().UnixNano()%1_000_000_000_000)
	head := proof.VoucherHeadLeaf{VoucherID: voucherID, Seq: 1, HeadHash: headHash(unique("h")), Region: "AU"}

	if n, err := checker.AnchorHeads(ctx, []proof.VoucherHeadLeaf{head}); err != nil || n != 1 {
		t.Fatalf("first anchor: %d %v", n, err)
	}
	if n, err := checker.AnchorHeads(ctx, []proof.VoucherHeadLeaf{head}); err != nil || n != 0 {
		t.Fatalf("a re-sent anchor: %d %v, want a no-op", n, err)
	}
	rewritten := head
	rewritten.HeadHash = headHash("rewritten")
	if _, err := checker.AnchorHeads(ctx, []proof.VoucherHeadLeaf{rewritten}); !errors.Is(err, proof.ErrAnchorConflict) {
		t.Fatalf("a rewritten head gave %v, want ErrAnchorConflict", err)
	}
	if len(alerter.pages) == 0 {
		t.Fatal("a rewritten head did not page")
	}
	for _, bad := range []proof.VoucherHeadLeaf{
		{VoucherID: "not-a-uuid", Seq: 1, HeadHash: head.HeadHash, Region: "AU"},
		{VoucherID: head.VoucherID, Seq: 0, HeadHash: head.HeadHash, Region: "AU"},
		{VoucherID: head.VoucherID, Seq: 2, HeadHash: "deadbeef", Region: "AU"},
		{VoucherID: head.VoucherID, Seq: 2, HeadHash: head.HeadHash, Region: "NZ"},
	} {
		if _, err := checker.AnchorHeads(ctx, []proof.VoucherHeadLeaf{bad}); !errors.Is(err, proof.ErrBadAnchor) {
			t.Errorf("%+v gave %v, want ErrBadAnchor", bad, err)
		}
	}
}
