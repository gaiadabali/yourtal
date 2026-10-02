package reward_test

import (
	"testing"

	"github.com/yourtal/services/ledger/internal/reward"
)

// F96: the accuracy bonus is paid only for a perfect score, never prorated,
// so the ledger agrees with apps/api's pointsForCompletion and the terms card.
func TestTermsPointsBonusIsAllOrNothing(t *testing.T) {
	const bonusRule = "base_plus_accuracy_bonus"
	cases := []struct {
		name           string
		rule           string
		asked, correct int
		want           int64
	}{
		{"perfect score earns the whole bonus", bonusRule, 3, 3, 130},
		{"one wrong earns only the base", bonusRule, 3, 2, 100},
		{"all wrong earns the base", bonusRule, 3, 0, 100},
		{"no questions earns the base", bonusRule, 0, 0, 100},
		{"base-only terms never pay a bonus", "base_only", 3, 3, 100},
	}
	for _, c := range cases {
		if got := reward.TermsPoints(100, 30, c.rule, c.asked, c.correct); got != c.want {
			t.Errorf("%s: got %d, want %d", c.name, got, c.want)
		}
	}
}
