package lifecycle_test

import (
	"errors"
	"testing"

	"github.com/yourtal/services/voucher/internal/lifecycle"
)

// Every pair, in both directions, checked against an independent expectation
// written out by hand.
//
// The point is the REFUSALS. A transition table that has only ever been
// asked about moves it permits has not been shown to refuse anything, and
// `docs/13c-lessons.md` records a test in this repo that asserted a fraud
// hole as expected behaviour. So the expectation below is a second, separate
// statement of the rules rather than a loop over `Transitions` — a test that
// reads the table it is testing proves only that the table equals itself.
func TestEveryPair(t *testing.T) {
	const (
		minted    = lifecycle.Minted
		allocated = lifecycle.Allocated
		active    = lifecycle.Active
		held      = lifecycle.Held
		redeemed  = lifecycle.Redeemed
		expired   = lifecycle.Expired
		voided    = lifecycle.Voided
	)

	legal := map[[2]lifecycle.State]bool{
		{minted, allocated}: true,
		{minted, voided}:    true,
		{minted, expired}:   true,

		{allocated, active}:  true,
		{allocated, voided}:  true,
		{allocated, expired}: true,
		{allocated, minted}:  true,

		{active, held}:     true,
		{active, redeemed}: true,
		{active, expired}:  true,
		{active, voided}:   true,

		{held, active}:   true,
		{held, redeemed}: true,
		{held, voided}:   true,

		{expired, active}: true,
	}

	for _, from := range lifecycle.States {
		for _, to := range lifecycle.States {
			want := legal[[2]lifecycle.State{from, to}]
			if got := lifecycle.CanTransition(from, to); got != want {
				t.Errorf("CanTransition(%s, %s) = %v, want %v", from, to, got, want)
			}
		}
	}
}

// The three rules that would each be a real incident.
func TestTheTerminalStatesAreTerminal(t *testing.T) {
	for _, terminal := range []lifecycle.State{lifecycle.Redeemed, lifecycle.Voided} {
		if !lifecycle.IsTerminal(terminal) {
			t.Errorf("%s is not terminal", terminal)
		}
		for _, to := range lifecycle.States {
			if lifecycle.CanTransition(terminal, to) {
				t.Errorf("%s -> %s is permitted; %s must be terminal", terminal, to, terminal)
			}
		}
	}
}

// A voided voucher that can be revived makes the kill switch advisory, which
// is the single control docs/09 §10 describes as "one call disables a
// compromised merchant's ability to redeem anything".
func TestAVoidedVoucherCannotBeRevived(t *testing.T) {
	err := lifecycle.Check(lifecycle.Voided, lifecycle.Active, "")
	if !errors.Is(err, lifecycle.ErrIllegalTransition) {
		t.Fatalf("reviving a voided voucher gave %v", err)
	}
	if !contains(err.Error(), "kill switch") {
		t.Errorf("the refusal does not say why: %v", err)
	}
}

// A void without a reason leaves a wallet unable to tell a user whether
// their voucher was transferred away or killed for fraud.
func TestAVoidMustCarryItsReason(t *testing.T) {
	if err := lifecycle.Check(lifecycle.Active, lifecycle.Voided, ""); !errors.Is(
		err, lifecycle.ErrVoidNeedsReason,
	) {
		t.Errorf("a reasonless void was accepted: %v", err)
	}

	if err := lifecycle.Check(lifecycle.Active, lifecycle.Voided, "because"); !errors.Is(
		err, lifecycle.ErrVoidNeedsReason,
	) {
		t.Errorf("an unregistered void reason was accepted: %v", err)
	}

	for _, reason := range lifecycle.VoidReasons {
		if err := lifecycle.Check(lifecycle.Active, lifecycle.Voided, reason); err != nil {
			t.Errorf("Check with reason %q: %v", reason, err)
		}
	}
}

// And the mirror: a reason on a move that is not a void is a field somebody
// set by accident, and the honest response is to refuse rather than ignore.
func TestOnlyAVoidCarriesAReason(t *testing.T) {
	err := lifecycle.Check(lifecycle.Active, lifecycle.Held, lifecycle.ReasonFraud)
	if !errors.Is(err, lifecycle.ErrReasonWithoutVoid) {
		t.Errorf("a reason on a non-void was accepted: %v", err)
	}
}

// Value can only be taken from a voucher that is active or held. This is the
// predicate the authorize path gates on, so a minted-but-unissued voucher
// being spendable would mean inventory could be redeemed before anybody
// bought it.
func TestOnlyActiveAndHeldAreSpendable(t *testing.T) {
	spendable := map[lifecycle.State]bool{lifecycle.Active: true, lifecycle.Held: true}

	for _, state := range lifecycle.States {
		if got := lifecycle.Spendable(state); got != spendable[state] {
			t.Errorf("Spendable(%s) = %v, want %v", state, got, spendable[state])
		}
	}
}

// The grace window is temporal, and the boundary is where the bugs are.
func TestExpiryIsOnlyReversibleInsideTheGraceWindow(t *testing.T) {
	const grace = int64(72 * 3600)

	cases := []struct {
		name    string
		elapsed int64
		want    bool
	}{
		{"the instant it expired", 0, true},
		{"an hour later", 3600, true},
		{"the last second of the window", grace, true},
		{"one second past", grace + 1, false},
		{"a month later", 30 * 24 * 3600, false},
		{"a clock that went backwards", -1, false},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := lifecycle.ExpiryIsReversible(testCase.elapsed, grace); got != testCase.want {
				t.Errorf("ExpiryIsReversible(%d, %d) = %v, want %v",
					testCase.elapsed, grace, got, testCase.want)
			}
		})
	}
}

// A state that is not in the table must be refused rather than silently
// treated as having no legal moves — a row written by something that is not
// this package should be loud, not inert.
func TestAnUnknownStateIsRefused(t *testing.T) {
	err := lifecycle.Check("pending", lifecycle.Active, "")
	if !errors.Is(err, lifecycle.ErrUnknownState) {
		t.Errorf("an unknown source state gave %v", err)
	}

	err = lifecycle.Check(lifecycle.Active, "cancelled", "")
	if !errors.Is(err, lifecycle.ErrUnknownState) {
		t.Errorf("an unknown target state gave %v", err)
	}
}

// Every state in the set has an entry in the table. A state added to `States`
// without a row would report "no legal moves", which reads exactly like a
// terminal state and is how a voucher gets stuck with nobody noticing.
func TestEveryStateHasARowInTheTable(t *testing.T) {
	for _, state := range lifecycle.States {
		if _, present := lifecycle.Transitions[state]; !present {
			t.Errorf("%s is in States but has no row in Transitions", state)
		}
	}
	if len(lifecycle.Transitions) != len(lifecycle.States) {
		t.Errorf("Transitions has %d rows for %d states",
			len(lifecycle.Transitions), len(lifecycle.States))
	}
}

func contains(haystack, needle string) bool {
	for index := 0; index+len(needle) <= len(haystack); index++ {
		if haystack[index:index+len(needle)] == needle {
			return true
		}
	}
	return false
}
