package api_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/testdb"
)

type release struct {
	GrantID    string `json:"grantId"`
	UserID     string `json:"userId"`
	Region     string `json:"region"`
	Points     int64  `json:"points"`
	UnlockedAt string `json:"unlockedAt"`
}

func (s *server) unnotified() map[string]release {
	s.t.Helper()
	var page struct {
		Releases []release `json:"releases"`
	}
	s.mustCall("/releases/unnotified", map[string]any{"limit": 500}, &page)
	byGrant := make(map[string]release, len(page.Releases))
	for _, r := range page.Releases {
		byGrant[r.GrantID] = r
	}
	return byGrant
}

// A held grant, once released, is listed until the worker acknowledges it;
// a tier-3 grant (released with the grant, never locked) is never listed.
func TestReleasedGrantsAreListedUntilAcknowledged(t *testing.T) {
	s := newServer(t)
	ctx := context.Background()
	s.mustCall("/economy/marketing/fund", map[string]any{"region": "AU", "amountMinor": 100_000,
		"proposedBy": "alice", "approvedBy": "bob"}, nil)
	// Marketing points are backed at exactly B, so on their own they hold
	// coverage at 1.0, under the 1.1 pause. A partner purchase lifts it.
	s.mustCall("/allocations/purchase", map[string]any{"businessId": uuid(), "region": "AU", "currency": "AUD",
		"points": 10_000, "paidMinor": 45_000, "idempotencyKey": unique("buy")}, nil)

	grant := func(tier int) string {
		var g struct {
			GrantID string `json:"grantId"`
		}
		s.mustCall("/actions/grants", map[string]any{"kind": "streak", "userId": uuid(), "region": "AU",
			"points": 40, "trustTier": tier, "idempotencyKey": unique("streak")}, &g)
		return g.GrantID
	}
	held, immediate := grant(0), grant(3)

	if _, err := s.owner.Exec(ctx, `UPDATE ledger.grant SET unlock_at = now() - interval '1 minute' WHERE id = $1`, held); err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(ctx, testdb.URL(t, "LEDGER_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if _, err := reward.ReleaseDue(ctx, pool, ledger.New(pool), 500); err != nil {
		t.Fatal(err)
	}

	listed := s.unnotified()
	got, ok := listed[held]
	if !ok {
		t.Fatalf("the released grant %s is not listed", held)
	}
	if got.Region != "AU" || got.Points != 40 || got.UnlockedAt == "" || got.UserID == "" {
		t.Errorf("release %+v", got)
	}
	if _, ok := listed[immediate]; ok {
		t.Errorf("a tier-3 grant was listed as unlocked")
	}

	var ack struct {
		Acknowledged int64 `json:"acknowledged"`
	}
	s.mustCall("/releases/notified", map[string]any{"grantIds": []string{held, immediate, "no-such-grant"}}, &ack)
	if ack.Acknowledged < 1 {
		t.Errorf("acknowledged %d", ack.Acknowledged)
	}
	if _, ok := s.unnotified()[held]; ok {
		t.Error("an acknowledged release is still listed")
	}
	// A repeat acknowledgement is a no-op, not an error.
	s.mustCall("/releases/notified", map[string]any{"grantIds": []string{held}}, &ack)
	if ack.Acknowledged != 0 {
		t.Errorf("a repeat acknowledged %d", ack.Acknowledged)
	}
}
