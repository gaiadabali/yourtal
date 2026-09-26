package verify

import "testing"

// Internal test (package verify, not verify_test): emptyCheck is
// unexported, and this is the one behaviour that needs no database — a live
// rehearsal database always holds seed or real data, so a DB-backed test can
// only ever exercise the non-empty path (see verify_test.go).
func TestEmptyCheck(t *testing.T) {
	if err := emptyCheck(0, false); err != ErrNoSealedCodes {
		t.Fatalf("emptyCheck(0, false) = %v, want ErrNoSealedCodes", err)
	}
	if err := emptyCheck(0, true); err != nil {
		t.Fatalf("emptyCheck(0, true) = %v, want nil", err)
	}
	if err := emptyCheck(3, false); err != nil {
		t.Fatalf("emptyCheck(3, false) = %v, want nil", err)
	}
}
