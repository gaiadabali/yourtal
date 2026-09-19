package redeem

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/yourtal/services/voucher/internal/chain"
	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/lifecycle"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

var (
	// ErrNoLiveHold — the authorization is not held, or its TTL has passed.
	// Both are the same fact to a caller: that hold is gone, start again.
	ErrNoLiveHold = errors.New("redeem: no live authorization; it was resolved or has expired")
	// ErrNotFound — no such authorization or capture.
	ErrNotFound = errors.New("redeem: not found")
	// ErrRefundNeedsReplacement is the named refusal for the case nobody has
	// decided yet.
	//
	// YT-0142 makes `redeemed` terminal; docs/09 §8.1 says a refund "restores
	// value post-capture". Both cannot hold for a voucher that was fully
	// consumed: either the state machine lets a spent voucher come back —
	// which would mean a state write can un-spend money — or the refund mints
	// a REPLACEMENT voucher with a new code and a new expiry.
	//
	// The replacement is almost certainly right, and it is not an
	// implementation detail: it resets a liability clock the platform
	// accounts for, hands the merchant a second code to reconcile against one
	// original sale, and opens a redeem-then-refund path that risk should
	// look at BEFORE it exists. So this refuses, loudly, rather than quietly
	// inventing a mint inside a refund. A partially-captured balance-carrying
	// voucher never reaches `redeemed`, so the ordinary case is unaffected.
	ErrRefundNeedsReplacement = errors.New(
		"redeem: refunding a fully redeemed voucher needs a replacement voucher, " +
			"which is a product decision nobody has made yet (YT-0142)")
)

// place inserts the hold and moves the voucher, in one transaction.
func (n *Network) place(
	ctx context.Context, req AuthorizeRequest, voucher sqlcgen.VoucherVoucher,
) (Authorization, error) {
	var placed Authorization

	err := pgx.BeginTxFunc(ctx, n.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)
		id := uuid.New()

		row, err := queries.InsertAuthorization(ctx, sqlcgen.InsertAuthorizationParams{
			ID:               pgUUID(id),
			VoucherID:        voucher.ID,
			MerchantID:       pgUUID(req.MerchantID),
			AmountMinor:      req.AmountMinor,
			Currency:         req.Currency,
			MerchantOrderRef: req.OrderRef,
			ExpiresAt:        pgTime(n.now().Add(HoldTTL)),
		})
		if err != nil {
			// Two unique indexes, two different things to tell a till.
			switch {
			case constraintIs(err, "authorization_one_live_hold_per_voucher"):
				return ErrAlreadyHeld
			case constraintIs(err, "authorization_one_per_merchant_order"):
				return ErrDuplicateOrder
			default:
				return fmt.Errorf("placing the hold: %w", err)
			}
		}

		if _, err := issue.Move(ctx, queries, issue.MoveRequest{
			VoucherID:      asUUID(voucher.ID),
			To:             lifecycle.Held,
			RemainingMinor: voucher.RemainingValueIdr,
			Version:        voucher.Version,
			EventType:      chain.TypeAuthorized,
			Detail: chain.Detail(
				"authorization_id", id.String(),
				"merchant_id", req.MerchantID.String(),
				"amount_minor", chain.Amount(req.AmountMinor),
				"order_ref", req.OrderRef,
			),
			At: n.now(),
		}); err != nil {
			return err
		}

		placed = Authorization{
			ID:             id,
			VoucherID:      asUUID(voucher.ID),
			AmountMinor:    row.AmountMinor,
			RemainingMinor: voucher.RemainingValueIdr,
			ExpiresAt:      row.ExpiresAt.Time,
		}
		return nil
	})

	if err != nil {
		return Authorization{}, err
	}

	n.record(ctx, req.MerchantID, OutcomeAuthorized, req.AmountMinor)
	return placed, nil
}

// replay returns the hold a merchant already has for an order.
func (n *Network) replay(
	ctx context.Context, queries *sqlcgen.Queries, existing sqlcgen.VoucherAuthorization,
) (Authorization, error) {
	voucher, err := queries.GetVoucher(ctx, existing.VoucherID)
	if err != nil {
		return Authorization{}, fmt.Errorf("reading the held voucher: %w", err)
	}

	// A resolved authorization is not replayable as a hold — the merchant
	// captured, voided or let it expire, and handing back a dead hold as if
	// it were live is how a second capture gets attempted.
	if existing.State != "held" {
		return Authorization{}, fmt.Errorf("%w: order %s is already %s",
			ErrDuplicateOrder, existing.MerchantOrderRef, existing.State)
	}

	return Authorization{
		ID:             asUUID(existing.ID),
		VoucherID:      asUUID(existing.VoucherID),
		AmountMinor:    existing.AmountMinor,
		RemainingMinor: voucher.RemainingValueIdr,
		ExpiresAt:      existing.ExpiresAt.Time,
		AlreadyExisted: true,
	}, nil
}

// Capture is the commit. YT-0151.
//
// `finalAmount` may be below the authorized amount and never above — the
// database refuses that through a CHECK plus a composite foreign key, so a
// caller cannot inflate the authorized figure to justify a larger capture.
//
// What happens to the voucher afterwards is the per-batch partial-redemption
// policy (docs/09 §8.2, YT-0155), applied here in one place so that a
// balance-carrying voucher and a single-use one cannot diverge between the
// merchant portal and the API.
func (n *Network) Capture(
	ctx context.Context, authorizationID uuid.UUID, finalAmountMinor int64, receiptID string,
) (Capture, error) {
	var captured Capture

	err := pgx.BeginTxFunc(ctx, n.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)

		authorization, err := queries.ResolveAuthorization(ctx, sqlcgen.ResolveAuthorizationParams{
			ID: pgUUID(authorizationID), State: "captured",
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrNoLiveHold, authorizationID)
		}
		if err != nil {
			return fmt.Errorf("resolving the hold: %w", err)
		}

		if finalAmountMinor <= 0 || finalAmountMinor > authorization.AmountMinor {
			// Also enforced by the database. Checked here so the caller gets
			// a sentence rather than a constraint name, and so the
			// transaction does not have to fail to say so.
			return fmt.Errorf("%w: cannot capture %d against an authorization for %d",
				ErrRefused, finalAmountMinor, authorization.AmountMinor)
		}

		row, err := queries.InsertCapture(ctx, sqlcgen.InsertCaptureParams{
			ID:                    pgUUID(uuid.New()),
			AuthorizationID:       authorization.ID,
			AuthorizedAmountMinor: authorization.AmountMinor,
			AmountMinor:           finalAmountMinor,
			ReceiptID:             receiptID,
		})
		if err != nil {
			return fmt.Errorf("recording the capture: %w", err)
		}

		voucher, err := queries.GetVoucher(ctx, authorization.VoucherID)
		if err != nil {
			return fmt.Errorf("reading the voucher: %w", err)
		}

		remaining, state := afterCapture(
			voucher.PartialRedemptionPolicy, voucher.RemainingValueIdr, finalAmountMinor)

		if _, err := issue.Move(ctx, queries, issue.MoveRequest{
			VoucherID:      asUUID(voucher.ID),
			To:             state,
			RemainingMinor: remaining,
			Version:        voucher.Version,
			EventType:      chain.TypeCaptured,
			Detail: chain.Detail(
				"authorization_id", authorizationID.String(),
				"receipt_id", receiptID,
				"amount_minor", chain.Amount(finalAmountMinor),
				"remaining_minor", chain.Amount(remaining),
				"policy", voucher.PartialRedemptionPolicy,
			),
			At: n.now(),
		}); err != nil {
			return err
		}

		captured = Capture{
			ID:             asUUID(row.ID),
			ReceiptID:      receiptID,
			AmountMinor:    finalAmountMinor,
			RemainingMinor: remaining,
			VoucherID:      asUUID(voucher.ID),
		}
		return nil
	})

	if err != nil {
		return Capture{}, err
	}
	return captured, nil
}

// Capture is what a merchant gets back.
type Capture struct {
	ID             uuid.UUID
	VoucherID      uuid.UUID
	ReceiptID      string
	AmountMinor    int64
	RemainingMinor int64
}

// afterCapture applies the per-batch partial-redemption policy.
//
// docs/09 §8.2 gives three, and all three are legitimate:
//
//   - balance_carrying — a gift card. What is left stays spendable.
//   - single_use_forfeit — a coupon. The remainder is lost, and the user was
//     told so before they spent their points.
//   - minimum_spend — a promo code. The threshold governs WHEN it can be
//     used; on use it is consumed like a coupon, because a promo code with a
//     floor that also carried a balance would be two policies at once and
//     docs/09 offers them as alternatives.
//
// The user was shown which of these applies before committing any points.
// "A user who loses IDR 20,000 they did not expect to lose will never trust
// the store again — and they will be right not to."
func afterCapture(policy string, remaining, captured int64) (int64, lifecycle.State) {
	switch policy {
	case "balance_carrying":
		left := remaining - captured
		if left <= 0 {
			return 0, lifecycle.Redeemed
		}
		return left, lifecycle.Active
	default:
		// single_use_forfeit and minimum_spend both consume the voucher.
		return 0, lifecycle.Redeemed
	}
}

// Void releases a hold. YT-0151.
//
// Only ever applies to an authorization, never to a capture — which is how
// docs/09 §8.1's "once settled, a transaction can only be refunded, never
// voided" is expressed: there is no code path from a receipt to a void.
func (n *Network) Void(ctx context.Context, authorizationID uuid.UUID) error {
	return pgx.BeginTxFunc(ctx, n.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)

		authorization, err := queries.ResolveAuthorization(ctx, sqlcgen.ResolveAuthorizationParams{
			ID: pgUUID(authorizationID), State: "voided",
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrNoLiveHold, authorizationID)
		}
		if err != nil {
			return fmt.Errorf("voiding the hold: %w", err)
		}

		voucher, err := queries.GetVoucher(ctx, authorization.VoucherID)
		if err != nil {
			return fmt.Errorf("reading the voucher: %w", err)
		}

		// Back to active with its value untouched. A void takes nothing.
		_, err = issue.Move(ctx, queries, issue.MoveRequest{
			VoucherID:      asUUID(voucher.ID),
			To:             lifecycle.Active,
			RemainingMinor: voucher.RemainingValueIdr,
			Version:        voucher.Version,
			EventType:      chain.TypeVoided,
			Detail: chain.Detail(
				"authorization_id", authorizationID.String(),
				"released_minor", chain.Amount(authorization.AmountMinor),
			),
			At: n.now(),
		})
		return err
	})
}

// Refund restores value after a capture. YT-0151.
func (n *Network) Refund(
	ctx context.Context, captureID uuid.UUID, amountMinor int64, reason string,
) error {
	if amountMinor <= 0 {
		return fmt.Errorf("%w: a refund needs a positive amount", ErrRefused)
	}

	return pgx.BeginTxFunc(ctx, n.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)

		capture, err := queries.GetCapture(ctx, pgUUID(captureID))
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: capture %s", ErrNotFound, captureID)
		}
		if err != nil {
			return fmt.Errorf("reading the capture: %w", err)
		}

		authorization, err := queries.GetAuthorization(ctx, capture.AuthorizationID)
		if err != nil {
			return fmt.Errorf("reading the authorization: %w", err)
		}

		voucher, err := queries.GetVoucher(ctx, authorization.VoucherID)
		if err != nil {
			return fmt.Errorf("reading the voucher: %w", err)
		}

		// The collision between YT-0142 and docs/09 §8.1. See the note on
		// ErrRefundNeedsReplacement — refused rather than guessed at.
		if lifecycle.State(voucher.State) == lifecycle.Redeemed {
			return fmt.Errorf("%w: voucher %s", ErrRefundNeedsReplacement, asUUID(voucher.ID))
		}

		// The total is bounded by a deferred constraint trigger, which fires
		// at COMMIT — so this insert can succeed and the transaction still
		// fail, correctly, if the refunds together exceed the capture.
		if err := queries.InsertRefund(ctx, sqlcgen.InsertRefundParams{
			ID: pgUUID(uuid.New()), CaptureID: capture.ID,
			AmountMinor: amountMinor, Reason: reason,
		}); err != nil {
			return fmt.Errorf("recording the refund: %w", err)
		}

		restored := voucher.RemainingValueIdr + amountMinor
		if restored > voucher.FaceValueIdr {
			// A voucher cannot be refunded to more than it was ever worth.
			// The database says so too (`vouchers_remaining_within_face`);
			// catching it here names the number instead of the constraint.
			return fmt.Errorf("%w: refunding %d would take the voucher to %d above its face value",
				ErrRefused, amountMinor, restored-voucher.FaceValueIdr)
		}

		_, err = issue.Move(ctx, queries, issue.MoveRequest{
			VoucherID:      asUUID(voucher.ID),
			To:             lifecycle.State(voucher.State),
			RemainingMinor: restored,
			Version:        voucher.Version,
			EventType:      chain.TypeRefunded,
			Detail: chain.Detail(
				"capture_id", captureID.String(),
				"amount_minor", chain.Amount(amountMinor),
				"remaining_minor", chain.Amount(restored),
				"reason", reason,
			),
			At: n.now(),
		})
		return err
	})
}

func constraintIs(err error, name string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.ConstraintName == name
}
