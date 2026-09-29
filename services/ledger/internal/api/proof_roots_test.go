package api_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/testdb"
)

// 10.3.b: GET /api/proof/roots (apps/api) republishes this route's answer
// verbatim — F11's "anyone can verify later, without a blockchain".
func TestProofRootsListsRecordedDays(t *testing.T) {
	s := newServer(t)
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, testdb.URL(t, "DATABASE_OWNER_URL"))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(owner.Close)

	// Far enough in the past that no real entry could land there, and
	// distinct per test run so parallel or repeated runs cannot collide.
	dateOnly := time.Date(1999, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, int(counter.Add(1)))
	t.Cleanup(func() {
		_, _ = owner.Exec(context.Background(), `DELETE FROM ledger.daily_proof WHERE proof_date = $1`, dateOnly)
	})
	// merkle_root is char(64) (a real root is always exactly 64 hex chars,
	// sha256) — padded with spaces if shorter, so the fake root here must be
	// the right width too, or the comparison below sees Postgres's padding
	// rather than what was written.
	sum := sha256.Sum256([]byte(dateOnly.Format(time.DateOnly)))
	fakeRoot := hex.EncodeToString(sum[:])
	if _, err := owner.Exec(ctx, `
		INSERT INTO ledger.daily_proof (proof_date, merkle_root, entry_count)
		VALUES ($1, $2, 0)
	`, dateOnly, fakeRoot); err != nil {
		t.Fatalf("seeding a daily proof: %v", err)
	}

	var body struct {
		Roots []struct {
			Date       string `json:"date"`
			MerkleRoot string `json:"merkleRoot"`
		} `json:"roots"`
	}
	if code := s.call("/proof/roots", map[string]any{}, &body); code != http.StatusOK {
		t.Fatalf("proof/roots: %d", code)
	}
	found := false
	for _, root := range body.Roots {
		if root.Date == dateOnly.Format(time.DateOnly) {
			found = true
			if root.MerkleRoot != fakeRoot {
				t.Errorf("root = %+v, want merkleRoot %s", root, fakeRoot)
			}
		}
	}
	if !found {
		t.Errorf("roots = %+v, want the seeded day", body.Roots)
	}
}
