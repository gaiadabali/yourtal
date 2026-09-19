// Package lifecycle is the voucher state machine. YT-0142.
//
// # Why the legal moves are a table rather than a series of checks
//
// A voucher's state controls whether value can be taken from it. "Anything
// can become active if the code that sets it says so" is how a voided
// voucher is honoured at a till, and the void becomes advisory. So the legal
// moves are enumerated, exported, and every pair — including every pair that
// must be refused — is checked in the test, because a transition table
// nobody has watched reject anything has not been shown to work.
//
// This is deliberately the same shape as `campaign-lifecycle.ts`, which
// settled the identical question for campaigns. Two state machines that
// disagree about how a state machine is written is a third thing to learn.
//
// # What this package does NOT do
//
// It does not derive the wallet-facing status. That derivation lives once,
// in `packages/contracts`, and the voucher service's API returns the real
// lifecycle state to its callers — the BFF and the merchant portal, both of
// which are internal. A second copy of the mapping here would be a second
// answer to "is this voucher visible", and the copy is what goes stale.
package lifecycle

import (
	"errors"
	"fmt"
)

// State is where a voucher is in its life.
type State string

const (
	// Minted — a code exists and belongs to nobody yet. Bulk issuance
	// produces vouchers in this state (YT-0141).
	Minted State = "minted"
	// Allocated — reserved for a specific redemption, not yet delivered.
	// The saga's intermediate state: points have been debited and the
	// voucher is spoken for, but it is not yet in a wallet.
	Allocated State = "allocated"
	// Active — in a wallet, spendable.
	Active State = "active"
	// Held — an authorization is outstanding against it (docs/09 §8). Still
	// the user's, still shows as active in their wallet; it simply cannot be
	// spent twice at once.
	Held State = "held"
	// Redeemed — consumed. Terminal.
	Redeemed State = "redeemed"
	// Expired — its date passed unspent. Reversible only inside the grace
	// window, which is a decision for the caller and not a property of this
	// table; see ExpiryIsReversible.
	Expired State = "expired"
	// Voided — killed deliberately. Terminal, and always carries a reason.
	Voided State = "voided"
)

// States is the closed set, in roughly the order a voucher moves through it.
var States = []State{Minted, Allocated, Active, Held, Redeemed, Expired, Voided}

// VoidReason says why a voucher was killed, and the distinction is not
// bookkeeping: a voucher voided by TRANSFER became somebody else's and its
// value still exists (docs/09 §7's void-and-remint), while one voided for
// fraud did not. A wallet has to show those differently, and a user asking
// "where did my voucher go" deserves the right answer.
type VoidReason string

const (
	// ReasonTransfer — void-and-remint. The old code died at the instant of
	// transfer and a new one was minted for the recipient. docs/09 §7 rule 1:
	// never move ownership of a live code.
	ReasonTransfer VoidReason = "transfer"
	// ReasonFraud — risk killed it.
	ReasonFraud VoidReason = "fraud"
	// ReasonRefundReversal — a replacement minted for a refund was itself
	// reversed.
	ReasonRefundReversal VoidReason = "refund_reversal"
	// ReasonAdmin — a human decision, which must still be attributable.
	ReasonAdmin VoidReason = "admin"
)

var VoidReasons = []VoidReason{ReasonTransfer, ReasonFraud, ReasonRefundReversal, ReasonAdmin}

// Transitions is every legal move. A state's absence from a list is a
// refusal, not an oversight — the surprising entries carry their reasons.
var Transitions = map[State][]State{
	// A minted voucher is inventory. It can be claimed, killed, or reach
	// its expiry sitting in the batch unsold.
	Minted: {Allocated, Voided, Expired},
	// Allocation is undone by voiding, not by returning to `minted`: the
	// redemption it was allocated against happened, and a voucher that
	// could silently rejoin inventory would be one the saga's compensation
	// could hand to a second user.
	Allocated: {Active, Voided, Expired},
	Active:    {Held, Redeemed, Expired, Voided},
	// A hold ends in exactly three ways: captured (redeemed), released back
	// to active (void or TTL expiry of the HOLD), or the voucher itself is
	// killed under it — a kill switch must not have to wait for a cart.
	Held: {Active, Redeemed, Voided},
	// Terminal. YT-0142: "`redeemed` is terminal". A refund after full
	// redemption restores value by minting a REPLACEMENT voucher, never by
	// reviving this one — see the note on ExpiryIsReversible for the same
	// principle applied to the other terminal-looking state.
	Redeemed: {},
	// Expiry is the one reversal that exists, and only inside a grace
	// window: YT-0142 asks for an expiry job that is "idempotent and
	// reversible within a grace window", because an expiry job that ran
	// against a wrong clock or a wrong batch would otherwise be
	// unrecoverable for every voucher it touched.
	Expired: {Active},
	// Terminal. A voided voucher that could come back makes the kill switch
	// advisory.
	Voided: {},
}

var (
	// ErrIllegalTransition — the move is not in the table.
	ErrIllegalTransition = errors.New("lifecycle: illegal voucher transition")
	// ErrVoidNeedsReason — voiding without saying why.
	ErrVoidNeedsReason = errors.New("lifecycle: a void must carry its reason")
	// ErrReasonWithoutVoid — a reason supplied for a move that is not a void.
	ErrReasonWithoutVoid = errors.New("lifecycle: only a void carries a reason")
	// ErrUnknownState — a state the table does not have. Reachable only from
	// a database row written by something that is not this package.
	ErrUnknownState = errors.New("lifecycle: unknown state")
)

// CanTransition reports whether a move is legal, ignoring reasons.
func CanTransition(from, to State) bool {
	for _, allowed := range Transitions[from] {
		if allowed == to {
			return true
		}
	}
	return false
}

// Check validates a move including its reason, and is what callers use.
//
// The reason is checked HERE rather than at the database, even though the
// database also refuses a void without one, because the caller that gets
// this error can still choose what to do; the one that gets a constraint
// violation has already lost its transaction.
func Check(from, to State, reason VoidReason) error {
	if _, known := Transitions[from]; !known {
		return fmt.Errorf("%w: %q", ErrUnknownState, from)
	}
	if _, known := Transitions[to]; !known {
		return fmt.Errorf("%w: %q", ErrUnknownState, to)
	}

	if !CanTransition(from, to) {
		return fmt.Errorf("%w: %s cannot become %s (%s)",
			ErrIllegalTransition, from, to, explain(from, to))
	}

	switch {
	case to == Voided && reason == "":
		return ErrVoidNeedsReason
	case to != Voided && reason != "":
		return fmt.Errorf("%w: %s -> %s carried %q", ErrReasonWithoutVoid, from, to, reason)
	case to == Voided && !knownReason(reason):
		return fmt.Errorf("%w: %q is not one of %v", ErrVoidNeedsReason, reason, VoidReasons)
	}
	return nil
}

// IsTerminal — nothing follows. Used by the expiry sweeper so it does not
// waste a write trying to expire what is already finished.
func IsTerminal(state State) bool { return len(Transitions[state]) == 0 }

// Spendable — value can be taken from a voucher in this state.
//
// `Held` is spendable because a capture moves a held voucher to redeemed;
// what a hold prevents is a SECOND authorization, and that is enforced by
// the partial unique index rather than by this predicate.
func Spendable(state State) bool { return state == Active || state == Held }

// ExpiryIsReversible is the temporal half of `Expired -> Active`.
//
// The table says the move is legal; whether it is legal NOW depends on how
// long ago the voucher expired, and a duration is not something a transition
// table can hold. Kept here rather than in the caller so that "the grace
// window" has one definition — a second one in the sweeper and a third in
// the support tool is how a voucher gets revived a month later.
func ExpiryIsReversible(secondsSinceExpiry int64, graceSeconds int64) bool {
	return secondsSinceExpiry >= 0 && secondsSinceExpiry <= graceSeconds
}

func knownReason(reason VoidReason) bool {
	for _, candidate := range VoidReasons {
		if candidate == reason {
			return true
		}
	}
	return false
}

// explain turns a refusal into a sentence somebody can act on. A bare
// "illegal transition" in a log at 2am costs whoever is reading it the time
// to go and find this table.
func explain(from, to State) string {
	switch from {
	case Redeemed:
		return "a redeemed voucher is spent; a refund mints a replacement rather than reviving it"
	case Voided:
		return "a voided voucher cannot come back, or the kill switch would be advisory"
	case Minted, Allocated:
		return "an unissued voucher reaches a wallet through allocation, not directly"
	case Expired:
		return "an expired voucher can only be restored to active, inside the grace window"
	default:
		allowed := Transitions[from]
		return fmt.Sprintf("%s can only become %v", from, allowed)
	}
}
