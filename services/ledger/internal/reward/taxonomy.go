// Package reward is the ONLY path from a verified action to a points credit
// (docs/18 §9). Sister apps call it; they never credit directly.
//
// # What it knows and what it refuses to know
//
// It counts points. It never values them. docs/16 K6 — "every unfunded point
// is backed by a real cash transfer into the reserve at issuance" — has two
// halves, and only one of them is about cash: the cash is recorded when a
// partner pre-purchases a block (YT-0046), not when a point is issued. What
// issuance has to enforce is that a point came out of a funded block at all,
// and a block of N points is N points whatever an IDR integer denominates
// (FOUNDER DECISION T-1: whole Rupiah). The gate never needed to know that to
// be buildable, which is why it shipped before the unit did.
//
// docs/18 §9 also fixes the shape: the engine "gets smarter only in its
// INPUTS (risk score, trust tier), never in its arithmetic". Nothing here
// scales a reward by a risk score or a tier. The gate can refuse an action
// outright; it cannot quietly pay less.
package reward

import "time"

// TaxonomyVersion is stamped on every grant.
//
// Not decoration: without recording which version priced a grant, changing a
// reward silently rewrites history in every report that groups by action.
// "How much did we pay for a completion in September" stops being answerable
// the first time the number moves.
const TaxonomyVersion = 1

// ActionType is the closed set of things a user can be paid for.
//
// Closed on purpose. An open string would let a caller invent an action and
// have the engine price it at whatever the caller said — which is not a
// reward engine, it is an API for minting points.
type ActionType string

const (
	// ActionWatchCompleted — a long-form campaign watched to completion with
	// checkpoint tokens verified (docs/06).
	ActionWatchCompleted ActionType = "watch_completed"
	// ActionQuickWatched — a short-form Quick item (docs/17 §1.1).
	ActionQuickWatched ActionType = "quick_watched"
	// ActionCheckpointCorrect — an accuracy bonus on a scored question.
	ActionCheckpointCorrect ActionType = "checkpoint_correct"
	// ActionDailyStreak — a habit-loop grant, funded by marketing.
	ActionDailyStreak ActionType = "daily_streak"
	// ActionReferralConfirmed — a referral that survived the risk gate.
	ActionReferralConfirmed ActionType = "referral_confirmed"
	// ActionReceiptScanned — snap-apps receipt earning (docs/02 §8).
	ActionReceiptScanned ActionType = "receipt_scanned"
)

// EvidenceRequirement names what must be presented for an action to count.
// The engine does not verify evidence itself — the watch service owns
// checkpoint tokens, risk owns device signals — but it refuses to grant when
// the required evidence is absent, so "verified action" means something.
type EvidenceRequirement string

const (
	EvidenceNone            EvidenceRequirement = "none"
	EvidenceCheckpointToken EvidenceRequirement = "checkpoint_token"
	EvidenceReceiptHash     EvidenceRequirement = "receipt_hash"
	EvidenceReferralCode    EvidenceRequirement = "referral_code"
)

// ActionDefinition is one row of the versioned taxonomy.
type ActionDefinition struct {
	// Points is a fixed quantity. Not a range, not a multiplier — docs/18
	// §9's "never in its arithmetic" means two users completing the same
	// campaign are paid the same, whatever the engine thinks of them.
	Points int64
	// MaxPerUserPerDay caps repetition of this action by one person.
	MaxPerUserPerDay int
	// Evidence must be present or the grant is refused.
	Evidence EvidenceRequirement
	// MarketingFunded routes the posting to the marketing contra account
	// rather than funded issuance. Streaks and referrals are the platform
	// paying for its own growth, and a report that cannot tell that from an
	// advertiser paying for attention is a report that misleads.
	MarketingFunded bool
}

// taxonomy is the whole price list. Fixed at this version; changing a number
// means bumping TaxonomyVersion, so old grants stay attributable to the
// numbers that actually applied.
var taxonomy = map[ActionType]ActionDefinition{
	ActionWatchCompleted: {
		Points: 2_400, MaxPerUserPerDay: 20, Evidence: EvidenceCheckpointToken,
	},
	ActionQuickWatched: {
		Points: 60, MaxPerUserPerDay: 100, Evidence: EvidenceCheckpointToken,
	},
	ActionCheckpointCorrect: {
		Points: 200, MaxPerUserPerDay: 100, Evidence: EvidenceCheckpointToken,
	},
	ActionDailyStreak: {
		// One per day is the definition of a daily streak, and the cap is
		// what makes it true rather than aspirational.
		Points: 500, MaxPerUserPerDay: 1, Evidence: EvidenceNone, MarketingFunded: true,
	},
	ActionReferralConfirmed: {
		Points: 5_000, MaxPerUserPerDay: 5, Evidence: EvidenceReferralCode, MarketingFunded: true,
	},
	ActionReceiptScanned: {
		Points: 300, MaxPerUserPerDay: 10, Evidence: EvidenceReceiptHash,
	},
}

// Definition looks up an action. The second return is false for anything not
// in the taxonomy, and every caller must treat that as "refuse", never as
// "default to zero and carry on" — a zero-point grant still consumes a
// velocity slot and still writes a ledger transfer.
func Definition(action ActionType) (ActionDefinition, bool) {
	definition, found := taxonomy[action]
	return definition, found
}

// AllActions is the taxonomy's key set, for tests and for the admin surface
// that will eventually display the price list.
func AllActions() []ActionType {
	actions := make([]ActionType, 0, len(taxonomy))
	for action := range taxonomy {
		actions = append(actions, action)
	}
	return actions
}

// VelocityWindow is the period caps are counted over. A day, because every
// cap in the taxonomy is expressed per day; making it configurable per
// action would be a knob nobody has asked for and one more thing to get
// wrong in a place where wrong means paying twice.
const VelocityWindow = 24 * time.Hour

// DeviceGrantsPerDay and IPGrantsPerDay are the caps that do not belong to
// any single action: they bound a whole device or address regardless of what
// it claims to have done. docs/14 §3 treats device farming as the primary
// earning attack, and a per-action cap alone is defeated by doing several
// different actions.
const (
	DeviceGrantsPerDay = 50
	IPGrantsPerDay     = 200
)
