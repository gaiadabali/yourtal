package reward_test

import (
	"context"
	"testing"

	"github.com/yourtal/services/ledger/internal/reward"
)

// EM-17 / EW-13: transfer and grant ids left out the user, so a second user
// with the same external ref hit a raw primary-key violation.
func TestTwoUsersMayShareAnExternalRef(t *testing.T) {
	engine, _ := newEngine(t, reward.AlwaysAllow{})
	allocation := fundedAllocation(t, engine, 100_000)
	ref := unique("session")

	for _, user := range []string{unique("usr_a"), unique("usr_b")} {
		req := request(user, allocation, reward.ActionWatchCompleted)
		req.ExternalRef = ref
		if _, err := engine.Grant(context.Background(), req); err != nil {
			t.Fatalf("grant for %s on a shared ref: %v", user, err)
		}
	}
}
