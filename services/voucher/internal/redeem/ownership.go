package redeem

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// A finding, not a feature: Capture and Void (settle.go, release.go) resolve
// an authorization by its id ALONE — `sqlcgen.ResolveAuthorizationParams{ID:
// ..., State: ...}` carries no merchant_id. That is the right query for the
// invariant those files are tested against (an authorization id is only
// ever handed back to the merchant that placed the hold), but a client
// supplies the id over HTTP, and this is the layer where a cross-merchant
// guess — or a leaked id — gets caught rather than trusted. `controllers
// never trust client-supplied scope beyond validated route params` applies
// here exactly as it would to a tenant id.
//
// Both refuse with the SAME error a genuinely missing id produces, for the
// same enumeration reason as everywhere else in this package: telling a
// caller "that exists, but is not yours" is one bit more than "no such
// thing" ever needs to give up.

// requireOwnedAuthorization refuses unless authorizationID exists and
// belongs to merchantID.
func (n *Network) requireOwnedAuthorization(ctx context.Context, authorizationID, merchantID uuid.UUID) error {
	authorization, err := sqlcgen.New(n.pool).GetAuthorization(ctx, pgUUID(authorizationID))
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrNoLiveHold, authorizationID)
	}
	if err != nil {
		return fmt.Errorf("looking up the authorization: %w", err)
	}
	if authorization.MerchantID.Bytes != merchantID {
		return fmt.Errorf("%w: %s", ErrNoLiveHold, authorizationID)
	}
	return nil
}

// captureForReceipt resolves a merchant-visible receipt id to the capture it
// names, refusing unless the capture's own authorization belongs to
// merchantID. HTTP-only: docs/09 §8.1's refund call takes a receipt_id, but
// Refund (release.go) takes the capture's own id, which nothing outside
// this package's HTTP layer needs to know.
//
// YT-0571: GetCaptureByReceipt now carries its own merchant_id predicate, so
// this is defense in depth rather than the only thing standing between a
// stranger and somebody else's receipt — the boundary check stays, same as
// requireOwnedAuthorization above, and the redundant GetAuthorization
// fetch below still runs so a future change to either layer cannot
// silently drop the other's coverage.
func (n *Network) captureForReceipt(ctx context.Context, receiptID string, merchantID uuid.UUID) (uuid.UUID, error) {
	queries := sqlcgen.New(n.pool)

	capture, err := queries.GetCaptureByReceipt(ctx, sqlcgen.GetCaptureByReceiptParams{
		ReceiptID: receiptID, MerchantID: pgUUID(merchantID),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.UUID{}, fmt.Errorf("%w: receipt %s", ErrNotFound, receiptID)
	}
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("looking up the receipt: %w", err)
	}

	authorization, err := queries.GetAuthorization(ctx, capture.AuthorizationID)
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("looking up the authorization behind a receipt: %w", err)
	}
	if authorization.MerchantID.Bytes != merchantID {
		return uuid.UUID{}, fmt.Errorf("%w: receipt %s", ErrNotFound, receiptID)
	}

	return asUUID(capture.ID), nil
}
