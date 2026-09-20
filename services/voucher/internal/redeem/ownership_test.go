package redeem_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/redeem"
)

// YT-0571: "a boundary check protects the boundary; a WHERE clause protects
// the data." http_authz_test.go already proves the HTTP boundary
// (requireOwnedAuthorization) stops a stranger. These tests prove the
// query itself does too, by calling the DOMAIN methods directly — which is
// exactly what skips ownership.go's boundary check entirely, since that
// check lives in the HTTP handlers (routes.go, routes_release.go), not in
// Network.Capture or Network.Void.
//
// This is the sabotage proof docs/13c-lessons.md asks for, made permanent:
// with `merchant_id` removed from ResolveAuthorization's WHERE clause (as it
// was on `main` before YT-0571), a call shaped exactly like these two
// succeeds and returns a captured receipt / a released hold for a merchant
// that never placed the hold. Restoring the predicate is what turns that
// into ErrNoLiveHold.

// TestCaptureRefusesAnotherMerchantAtTheQueryLevel bypasses
// requireOwnedAuthorization by calling Capture directly, the way a second
// caller of this package — one that never goes through redeem.Routes —
// would. Before YT-0571 this succeeded: ResolveAuthorization matched on id
// alone.
func TestCaptureRefusesAnotherMerchantAtTheQueryLevel(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000_00, nil)

	authorization, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000_00,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatalf("Authorize: %v", err)
	}

	stranger := uuid.New()
	if _, err := f.network.Capture(ctx, authorization.ID, stranger, 10_000_00, orderRef()); !errors.Is(
		err, redeem.ErrNoLiveHold,
	) {
		t.Fatalf("a stranger captured another merchant's authorization at the domain layer: %v", err)
	}

	// The hold survives: a refused stranger's capture must not have
	// consumed it, or a wrong-merchant guess becomes a denial-of-service
	// against the real owner.
	if _, err := f.network.Capture(ctx, authorization.ID, f.merchantID, 10_000_00, orderRef()); err != nil {
		t.Errorf("the owning merchant's capture failed after a stranger was refused: %v", err)
	}
}

// TestVoidRefusesAnotherMerchantAtTheQueryLevel is the same proof for Void.
func TestVoidRefusesAnotherMerchantAtTheQueryLevel(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000_00, nil)

	authorization, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000_00,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatalf("Authorize: %v", err)
	}

	stranger := uuid.New()
	if err := f.network.Void(ctx, authorization.ID, stranger); !errors.Is(err, redeem.ErrNoLiveHold) {
		t.Fatalf("a stranger voided another merchant's authorization at the domain layer: %v", err)
	}

	// Still held, and the real owner can still void it.
	if err := f.network.Void(ctx, authorization.ID, f.merchantID); err != nil {
		t.Errorf("the owning merchant's void failed after a stranger was refused: %v", err)
	}
}
