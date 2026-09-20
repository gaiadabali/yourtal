package redeem_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/code"
	"github.com/yourtal/services/voucher/internal/redeem"
)

// The refusals. Every one of these is money if it stops working, and each is
// driven rather than reasoned about — `docs/13c-lessons.md`: prove a check by
// breaking what it is meant to catch.

// docs/09 §10's amount binding and merchant scoping. Comparing on
// `merchant_id` rather than on `merchant_name` is what stops two shops that
// share a name redeeming each other's vouchers.
func TestAnotherMerchantCannotRedeemYourVoucher(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000_00, nil)

	_, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: uuid.New(), AmountMinor: 10_000_00,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if !errors.Is(err, redeem.ErrRefused) {
		t.Fatalf("a stranger redeemed somebody else's voucher: %v", err)
	}

	// And the refusal is the SAME message an unknown code gets. Two
	// distinguishable answers here would tell a prober "this code is real,
	// keep going" — the oracle docs/09 §8.1 refuses to provide.
	_, unknownErr := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: mintedButUnknownCode(t), MerchantID: uuid.New(), AmountMinor: 10_000_00,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if err.Error() != unknownErr.Error() {
		t.Errorf("a wrong-merchant refusal is distinguishable from an unknown code:\n  %v\n  %v",
			err, unknownErr)
	}
}

// YT-0150: "concurrent authorize on one voucher is serialised."
func TestOneVoucherCannotBeHeldTwice(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000_00, nil)

	if _, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000_00,
		Currency: "IDR", OrderRef: orderRef(),
	}); err != nil {
		t.Fatalf("the first authorize failed: %v", err)
	}

	// A DIFFERENT order reference, so this collides on the voucher rather
	// than on the order — otherwise the test would pass while exercising the
	// other index entirely.
	_, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 5_000_00,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if !errors.Is(err, redeem.ErrAlreadyHeld) {
		t.Fatalf("a voucher was held twice at once: %v", err)
	}
}

// A retried authorize for the same cart returns the hold it already has. The
// alternative is a duplicate-key error the merchant has to interpret, and the
// tempting interpretation is "use a different order reference" — which places
// a second hold on the same purchase.
func TestRetryingAnAuthorizeReturnsTheSameHold(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000_00, nil)
	order := orderRef()

	first, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000_00,
		Currency: "IDR", OrderRef: order,
	})
	if err != nil {
		t.Fatalf("Authorize: %v", err)
	}

	second, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000_00,
		Currency: "IDR", OrderRef: order,
	})
	if err != nil {
		t.Fatalf("the retry failed: %v", err)
	}
	if second.ID != first.ID {
		t.Errorf("a retry produced a second hold: %s then %s", first.ID, second.ID)
	}
	if !second.AlreadyExisted {
		t.Error("the retry did not report itself as a replay")
	}
}

// YT-0151: "capture cannot exceed the authorized amount; enforced
// server-side." The database enforces it too; this proves the service does
// not get there first with a larger number.
func TestCaptureCannotExceedItsAuthorization(t *testing.T) {
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

	if _, err := f.network.Capture(ctx, authorization.ID, f.merchantID, 10_000_01, orderRef()); err == nil {
		t.Fatal("a capture one sen above its authorization succeeded")
	}

	// And the hold survives the refused capture, so the merchant can capture
	// the correct amount. A failed capture that consumed the hold would
	// strand a customer at the till.
	if _, err := f.network.Capture(ctx, authorization.ID, f.merchantID, 10_000_00, orderRef()); err != nil {
		t.Errorf("the hold did not survive a refused capture: %v", err)
	}
}

// An amount above the voucher's remaining value is refused at authorize, not
// discovered at capture — otherwise a merchant rings up a sale it cannot
// complete.
func TestAuthorizeRefusesMoreThanTheVoucherHolds(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000_00, nil)

	_, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 50_000_01,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if !errors.Is(err, redeem.ErrRefused) {
		t.Fatalf("authorized more than the voucher was worth: %v", err)
	}
}

// A well-formed code that was never minted. Generated rather than
// hard-coded, so it carries a valid check symbol and reaches the lookup —
// a malformed constant would be rejected by `code.Parse` and would never
// exercise the path this is aimed at.
func mintedButUnknownCode(t *testing.T) string {
	t.Helper()
	generated, err := code.Mint()
	if err != nil {
		t.Fatalf("minting a probe code: %v", err)
	}
	return generated
}

func (f *fixture) remainingOf(t *testing.T, voucherID uuid.UUID) int64 {
	t.Helper()
	var remaining int64
	if err := f.pool.QueryRow(context.Background(),
		`SELECT remaining_value_idr FROM voucher.vouchers WHERE id = $1`,
		voucherID).Scan(&remaining); err != nil {
		t.Fatalf("reading remaining value: %v", err)
	}
	return remaining
}

// The sweeper's actual responsibility, checked rather than claimed.
//
// Safety does not depend on it — an expired hold cannot be captured, which
// `TestAnExpiredHoldCannotBeCaptured` proves. AVAILABILITY does: the
// one-live-hold index is `WHERE state = 'held'` and a partial index cannot
// reference `now()`, so an expired-but-unswept hold still occupies the slot
// and blocks a fresh authorize.
//
// This is the difference between the doc's "an abandoned cart cannot lock a
// voucher forever" and what the code does, and it is worth a test because it
// would otherwise be discovered by a customer whose first attempt timed out.
func TestAnExpiredHoldBlocksANewAuthorizeUntilItIsSwept(t *testing.T) {
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

	if _, err := f.pool.Exec(ctx,
		`UPDATE voucher.authorization
		    SET created_at = now() - interval '20 minutes',
		        expires_at = now() - interval '5 minutes'
		  WHERE id = $1`, authorization.ID); err != nil {
		t.Fatalf("ageing the hold: %v", err)
	}

	// Still blocked, even though the hold is dead. This is the gap.
	_, err = f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000_00,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if !errors.Is(err, redeem.ErrAlreadyHeld) {
		t.Fatalf("expected the stale hold to still block; got %v", err)
	}

	// The sweeper is what clears it.
	swept, err := f.network.SweepExpiredHolds(ctx)
	if err != nil {
		t.Fatalf("SweepExpiredHolds: %v", err)
	}
	if swept < 1 {
		t.Fatalf("the sweeper released %d holds; it should have released at least this one", swept)
	}

	if _, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000_00,
		Currency: "IDR", OrderRef: orderRef(),
	}); err != nil {
		t.Errorf("after sweeping, the voucher is still locked: %v", err)
	}
}
