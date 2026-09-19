// Package redeem is the merchant redemption network. YT-0150 / YT-0151 /
// YT-0153 / YT-0155.
//
// docs/09 §8 takes the shape card networks already solved — authorize →
// capture → void / refund — because the problem is the same one: value moves
// across an organisational boundary, on infrastructure we do not control,
// with retries that are certain and double-spends that must be impossible.
//
// # One refusal, many reasons
//
// A merchant gets `ErrRefused` for every failure that involves looking a
// code up. Internally the specific outcome is recorded on every attempt, and
// that asymmetry is the whole enumeration defence:
//
//   - "no such code" and "that code is not yours" as distinguishable answers
//     turn the API into an oracle for walking the code space
//   - "that code exists but has only IDR 20,000 left" is the balance endpoint
//     docs/09 §8.1 deliberately refuses to provide, reached by binary search
//     on the amount
//
// So the caller learns whether the authorization succeeded and nothing else,
// while `voucher.redemption_attempt` keeps the detail that alerting needs.
// The one exception is a policy refusal a cashier can act on — a minimum
// spend the customer has not met is a fact the customer already knows, and
// hiding it makes the voucher unusable rather than secure.
package redeem

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/code"
	"github.com/yourtal/services/voucher/internal/lifecycle"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// HoldTTL is docs/09 §8.1's default: "holds expire automatically (15 min
// default), so an abandoned cart cannot lock a voucher forever."
const HoldTTL = 15 * time.Minute

// The enumeration brake. docs/09 §10: "repeated invalid codes from one
// merchant is THE canonical signal of a compromised key or an enumeration
// attempt. Alert and auto-throttle."
//
// Twenty failures in five minutes is far above what a busy till produces by
// mistyping — the check symbol catches single typos before they ever reach a
// lookup — and far below what a useful enumeration run needs.
const (
	FailureWindow    = 5 * time.Minute
	FailureThreshold = 20
)

// Outcome is what happened, for the attempt log. These strings are the
// database's CHECK constraint, so a new one has to be added in both places.
type Outcome string

const (
	OutcomeAuthorized        Outcome = "authorized"
	OutcomeUnknownCode       Outcome = "unknown_code"
	OutcomeWrongMerchant     Outcome = "wrong_merchant"
	OutcomeInsufficientValue Outcome = "insufficient_value"
	OutcomeInactiveVoucher   Outcome = "inactive_voucher"
	OutcomePolicyRefused     Outcome = "policy_refused"
	OutcomeKilled            Outcome = "killed"
	OutcomeThrottled         Outcome = "throttled"
)

var (
	// ErrRefused is what a merchant sees for every lookup-related failure.
	// See the package comment.
	ErrRefused = errors.New("redeem: this voucher cannot be authorized for this amount")
	// ErrBelowMinimumSpend is the one refusal a cashier can act on, because
	// the customer already knows what is in their basket.
	ErrBelowMinimumSpend = errors.New("redeem: the order is below this voucher's minimum spend")
	// ErrThrottled — too many failed lookups from this merchant.
	ErrThrottled = errors.New("redeem: too many failed lookups; this merchant is throttled")
	// ErrKilled — a kill switch covers this merchant, batch, or everything.
	ErrKilled = errors.New("redeem: redemption is disabled")
	// ErrAlreadyHeld — another authorization is outstanding on this voucher.
	ErrAlreadyHeld = errors.New("redeem: this voucher already has a live authorization")
	// ErrDuplicateOrder — this merchant already authorized this order.
	ErrDuplicateOrder = errors.New("redeem: this merchant order was already authorized")
)

// Network is the redemption API's implementation.
type Network struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func New(pool *pgxpool.Pool) *Network {
	return &Network{pool: pool, now: func() time.Time { return time.Now().UTC() }}
}

// WithClock replaces the clock. Test seam only.
func (n *Network) WithClock(now func() time.Time) *Network {
	n.now = now
	return n
}

// AuthorizeRequest is docs/09 §8.1's call.
//
// Amount and MerchantOrderRef are required fields rather than options,
// because that is the whole of §8.1's "there is deliberately NO bare
// balance-lookup endpoint for merchants". An optional amount would grow one
// back the first time somebody wanted to check a code before ringing it up.
type AuthorizeRequest struct {
	Code        string
	MerchantID  uuid.UUID
	AmountMinor int64
	Currency    string
	OrderRef    string
}

// Authorization is the hold.
type Authorization struct {
	ID             uuid.UUID
	VoucherID      uuid.UUID
	AmountMinor    int64
	RemainingMinor int64
	ExpiresAt      time.Time
	AlreadyExisted bool
}

// Authorize places a hold, or refuses.
//
// # The order of the checks is the design
//
// Cheap, code-independent refusals come first: the kill switch and the
// throttle need no lookup, so a merchant who has been stopped or is
// enumerating never causes a custody read at all. Only then is the code
// hashed and looked up, and only then are the voucher's own rules applied.
func (n *Network) Authorize(ctx context.Context, req AuthorizeRequest) (Authorization, error) {
	queries := sqlcgen.New(n.pool)

	if req.AmountMinor <= 0 {
		return Authorization{}, fmt.Errorf("%w: an authorization needs a positive amount", ErrRefused)
	}
	if req.OrderRef == "" {
		return Authorization{}, fmt.Errorf("%w: an authorization needs a merchant order reference",
			ErrRefused)
	}

	killed, err := queries.IsKilled(ctx, sqlcgen.IsKilledParams{
		ScopeID: pgUUID(req.MerchantID), ScopeID_2: pgtype.UUID{},
	})
	if err != nil {
		return Authorization{}, fmt.Errorf("reading the kill switch: %w", err)
	}
	if killed {
		n.record(ctx, req.MerchantID, OutcomeKilled, req.AmountMinor)
		return Authorization{}, ErrKilled
	}

	failures, err := queries.CountFailedAttemptsSince(ctx, sqlcgen.CountFailedAttemptsSinceParams{
		MerchantID: pgUUID(req.MerchantID),
		OccurredAt: pgTime(n.now().Add(-FailureWindow)),
	})
	if err != nil {
		return Authorization{}, fmt.Errorf("counting failed attempts: %w", err)
	}
	if failures >= FailureThreshold {
		n.record(ctx, req.MerchantID, OutcomeThrottled, req.AmountMinor)
		return Authorization{}, ErrThrottled
	}

	// A replayed authorize for the same order returns the hold it already
	// has. Without this a merchant retrying a timed-out call gets a
	// duplicate-key error it has to interpret, and the tempting
	// interpretation is "try a different order reference".
	existing, err := queries.GetAuthorizationForOrder(ctx, sqlcgen.GetAuthorizationForOrderParams{
		MerchantID: pgUUID(req.MerchantID), MerchantOrderRef: req.OrderRef,
	})
	if err == nil {
		return n.replay(ctx, queries, existing)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Authorization{}, fmt.Errorf("looking up the order: %w", err)
	}

	canonical, err := code.Parse(req.Code)
	if err != nil {
		// A malformed code and a well-formed unknown one are the same answer
		// outward. Internally they are the same outcome too: the check
		// symbol means an honest typo rarely gets this far, so what reaches
		// here is overwhelmingly a probe.
		n.record(ctx, req.MerchantID, OutcomeUnknownCode, req.AmountMinor)
		return Authorization{}, ErrRefused
	}

	digest := sha256.Sum256([]byte(canonical))
	voucher, err := queries.FindVoucherByCodeHash(ctx, hex.EncodeToString(digest[:]))
	if errors.Is(err, pgx.ErrNoRows) {
		n.record(ctx, req.MerchantID, OutcomeUnknownCode, req.AmountMinor)
		return Authorization{}, ErrRefused
	}
	if err != nil {
		return Authorization{}, fmt.Errorf("looking up the voucher: %w", err)
	}

	if outcome, err := n.check(voucher, req); err != nil {
		n.record(ctx, req.MerchantID, outcome, req.AmountMinor)
		return Authorization{}, err
	}

	return n.place(ctx, req, voucher)
}

// check applies the voucher's own rules. Returns the outcome to record
// alongside the error, so the attempt log stays specific while the caller's
// error stays generic.
func (n *Network) check(
	voucher sqlcgen.VoucherVoucher, req AuthorizeRequest,
) (Outcome, error) {
	// Compared on merchant_id, never on merchant_name. Two merchants sharing
	// a name redeeming each other's vouchers is the ordinary failure of the
	// alternative, not an exotic one.
	if voucher.MerchantID.Bytes != req.MerchantID {
		return OutcomeWrongMerchant, ErrRefused
	}
	// `voucher.vouchers` has no currency column — its money columns are
	// named `*_idr` and the table is Indonesian by construction. So the
	// check that can be made is that the caller agrees, and an AUD amount
	// against this table is refused rather than silently treated as Rupiah.
	//
	// ⚠️ This is the shape of the AU gap, not a solution to it. Multi-currency
	// vouchers need those columns renamed and a `currency` column added,
	// which is a contracts change and belongs with the AU-primary re-cut —
	// see the two-region note in TASKS.md. Until then a refusal here is the
	// honest behaviour: the alternative is honouring an amount whose unit
	// nobody agreed on.
	if req.Currency != "IDR" {
		return OutcomeWrongMerchant, fmt.Errorf(
			"%w: this voucher is denominated in IDR and the request is in %s",
			ErrRefused, req.Currency)
	}
	if !lifecycle.Spendable(lifecycle.State(voucher.State)) {
		return OutcomeInactiveVoucher, ErrRefused
	}
	if !voucher.ExpiresAt.Time.After(n.now()) {
		// Expiry is applied at the moment of use rather than trusted to a
		// sweeper, so a sweeper that stops running cannot silently make
		// expired vouchers spendable.
		return OutcomeInactiveVoucher, ErrRefused
	}
	if req.AmountMinor > voucher.RemainingValueIdr {
		return OutcomeInsufficientValue, ErrRefused
	}

	// The one refusal a cashier can act on. docs/09 §8.2: the policy is
	// shown to the user before they spend points, so the threshold is not a
	// secret — and hiding it here would make the voucher unusable rather
	// than secure, because nobody at the till would know what to do.
	if voucher.PartialRedemptionPolicy == "minimum_spend" {
		if voucher.MinimumSpendIdr == nil {
			// Unreachable while `vouchers_minimum_spend_iff_policy` holds.
			// Refused rather than treated as zero: a minimum_spend voucher
			// with no threshold is a voucher whose terms nobody can state.
			return OutcomePolicyRefused, ErrRefused
		}
		if req.AmountMinor < *voucher.MinimumSpendIdr {
			return OutcomePolicyRefused, fmt.Errorf("%w: %d of %d",
				ErrBelowMinimumSpend, req.AmountMinor, *voucher.MinimumSpendIdr)
		}
	}

	return OutcomeAuthorized, nil
}

// record writes the attempt. Deliberately does not fail the call: an
// alerting signal that can refuse a legitimate redemption is worse than one
// that occasionally misses a row, and the caller is already holding a
// decision the customer is waiting on.
func (n *Network) record(ctx context.Context, merchant uuid.UUID, outcome Outcome, amount int64) {
	_ = sqlcgen.New(n.pool).InsertAttempt(ctx, sqlcgen.InsertAttemptParams{
		MerchantID: pgUUID(merchant), Outcome: string(outcome), AmountMinor: &amount,
	})
}

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func pgTime(at time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: at, Valid: true}
}

// asUUID narrows a pgtype.UUID to a uuid.UUID. Safe for every column this
// package reads, all of which are NOT NULL.
func asUUID(value pgtype.UUID) uuid.UUID { return value.Bytes }
