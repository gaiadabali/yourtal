package proof_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/yourtal/services/ledger/internal/proof"
)

// Pure filesystem behaviour, no database needed.
func TestFileRootStoreIsAppendOnly(t *testing.T) {
	store := proof.NewFileRootStore(t.TempDir())
	ctx := context.Background()
	day := time.Date(2031, 3, 4, 0, 0, 0, 0, time.UTC)

	if err := store.Append(ctx, day, "root-one"); err != nil {
		t.Fatalf("first append: %v", err)
	}
	if err := store.Append(ctx, day, "root-two"); !errors.Is(err, proof.ErrRootAlreadyStored) {
		t.Fatalf("second append for the same day: %v, want ErrRootAlreadyStored", err)
	}
	read, err := store.Read(ctx, day)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}
	if read != "root-one" {
		t.Errorf("read %q, want the first root only (never overwritten)", read)
	}
}

func TestFileRootStoreReadOfAnUnknownDayIsErrRootNotStored(t *testing.T) {
	store := proof.NewFileRootStore(t.TempDir())
	if _, err := store.Read(context.Background(), time.Date(2031, 1, 1, 0, 0, 0, 0, time.UTC)); !errors.Is(err, proof.ErrRootNotStored) {
		t.Errorf("Read of an unknown day: %v, want ErrRootNotStored", err)
	}
}

// 10.3.a's external witness, over the database: RecordDailyProof writes
// both, and a mismatch between them is a finding VerifyExternalStore
// reports rather than silently trusting either side.
func TestRecordDailyProofWritesTheExternalStoreAndVerifiesAgainstIt(t *testing.T) {
	checker, _ := newChecker(t, &recordingAlerter{})
	store := proof.NewFileRootStore(t.TempDir())
	checker = checker.WithRootStore(store)
	ctx := context.Background()
	day := exclusiveDay(t, superuser(t))

	root, err := checker.RecordDailyProof(ctx, day)
	if err != nil {
		t.Fatalf("RecordDailyProof: %v", err)
	}
	stored, err := store.Read(ctx, day)
	if err != nil {
		t.Fatalf("store.Read: %v", err)
	}
	if stored != root {
		t.Errorf("external store root = %q, want %q", stored, root)
	}

	if _, mismatched, err := checker.VerifyExternalStore(ctx, day); err != nil {
		t.Fatalf("VerifyExternalStore: %v", err)
	} else if mismatched {
		t.Error("a freshly-written external root was reported as mismatched")
	}
}

func TestVerifyExternalStoreCatchesADivergedCopy(t *testing.T) {
	checker, _ := newChecker(t, &recordingAlerter{})
	dir := t.TempDir()
	store := proof.NewFileRootStore(dir)
	checker = checker.WithRootStore(store)
	ctx := context.Background()
	day := exclusiveDay(t, superuser(t))

	if _, err := checker.RecordDailyProof(ctx, day); err != nil {
		t.Fatalf("RecordDailyProof: %v", err)
	}

	// A DIFFERENT store pointed at the same day, standing in for "the
	// external copy was tampered with" — proof.FileRootStore's own
	// append-only guard makes editing the real file impossible through its
	// own API, which is the point; a fresh store with a different value at
	// the same path is the same observable fact a tampered file would be.
	tampered := proof.NewFileRootStore(t.TempDir())
	if err := tampered.Append(ctx, day, "not-the-real-root"); err != nil {
		t.Fatalf("seeding a tampered copy: %v", err)
	}
	checker = checker.WithRootStore(tampered)

	finding, mismatched, err := checker.VerifyExternalStore(ctx, day)
	if err != nil {
		t.Fatalf("VerifyExternalStore: %v", err)
	}
	if !mismatched {
		t.Fatal("a diverged external root was not reported as mismatched")
	}
	if finding.Kind != "proof_external_store_mismatch" {
		t.Errorf("finding kind = %q", finding.Kind)
	}
}
