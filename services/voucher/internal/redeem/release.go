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

// The two ways a hold ends without value moving, plus the sweeper that
// tidies the ones nobody ended.
//
// Split from settle.go so each file stays under the 300-line limit docs/15
// rule 6 fixes. The seam is real rather than arbitrary: everything here
// RELEASES, and everything in settle.go COMMITS.

// Void releases a hold. YT-0151.
//
// Only ever applies to an authorization, never to a capture — which is how
// docs/09 §8.1's "once settled, a transaction can only be refunded, never
// voided" is expressed: there is no code path from a receipt to a void.
//
// merchantID (YT-0571): same reasoning as Capture. requireOwnedAuthorization
// stays as the boundary check; this is the query-level predicate that makes
// the data safe without it.
func (n *Network) Void(ctx context.Context, authorizationID, merchantID uuid.UUID) error {
	return pgx.BeginTxFunc(ctx, n.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)

		authorization, err := queries.ResolveAuthorization(ctx, sqlcgen.ResolveAuthorizationParams{
			ID: pgUUID(authorizationID), State: "voided", MerchantID: pgUUID(merchantID),
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
			RemainingMinor: voucher.RemainingValueMinor,
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

		restored := voucher.RemainingValueMinor + amountMinor
		if restored > voucher.FaceValueMinor {
			// A voucher cannot be refunded to more than it was ever worth.
			// The database says so too (`vouchers_remaining_within_face`);
			// catching it here names the number instead of the constraint.
			return fmt.Errorf("%w: refunding %d would take the voucher to %d above its face value",
				ErrRefused, amountMinor, restored-voucher.FaceValueMinor)
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

// SweepExpiredHolds releases abandoned authorizations, and reports how many.
//
// # What the sweeper is and is not responsible for
//
// It is NOT responsible for safety. `ResolveAuthorization` filters on
// `expires_at > now()`, so an expired hold cannot be captured or voided
// whatever its row still says — a sweeper that stops running cannot cause
// value to move.
//
// It IS responsible for availability, and this is the part worth stating
// plainly rather than glossing. The one-live-hold index is
// `UNIQUE (voucher_id) WHERE state = 'held'`, and a partial index cannot
// reference `now()` because the predicate must be immutable. So a hold that
// has expired but has not yet been swept still occupies that slot, and a NEW
// authorize on the same voucher is refused with ErrAlreadyHeld until the
// sweeper clears it.
//
// In other words docs/09 §8.1's "an abandoned cart cannot lock a voucher
// forever" is true, and "forever" bottoms out at the sweep interval rather
// than at the hold's TTL. A customer whose first attempt timed out waits up
// to that long before they can try again, and if the sweeper is dead they
// wait indefinitely. That is a real dependency and it should have an alarm
// on it, which it does not yet — recorded here rather than left as a
// silence.
//
// The vouchers themselves are deliberately NOT moved back to `active` here.
// Doing so would be a second write racing whatever the customer is doing at
// that moment, and `Authorize` already accepts a voucher in `held`.
func (n *Network) SweepExpiredHolds(ctx context.Context) (int, error) {
	released, err := sqlcgen.New(n.pool).ExpireStaleHolds(ctx)
	if err != nil {
		return 0, fmt.Errorf("expiring stale holds: %w", err)
	}
	return len(released), nil
}
