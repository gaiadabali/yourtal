package redeem_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/yourtal/services/voucher/internal/lifecycle"
	"github.com/yourtal/services/voucher/internal/redeem"
)

// 4.6.a: the lifecycle table is enforced on every write (engine-voucher.md D3,
// D15), in Move and in the database.

// D3 scenario B: a voucher voided for fraud while held could still be
// captured, which brought it back to life with a settleable capture.
func TestAVoucherVoidedWhileHeldCannotBeCaptured(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	voucherID, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	hold, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000, Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.minter.Void(ctx, voucherID, lifecycle.ReasonFraud); err != nil {
		t.Fatalf("voiding a held voucher for fraud: %v", err)
	}
	if _, err := f.network.Capture(ctx, hold.ID, f.merchantID, 10_000, orderRef()); !errors.Is(err, redeem.ErrNoLiveHold) {
		t.Fatalf("a fraud-voided voucher was captured: err = %v", err)
	}
	if state := f.stateOf(t, voucherID); state != "voided" {
		t.Errorf("state = %s, want voided", state)
	}
	if err := f.network.Void(ctx, hold.ID, f.merchantID); !errors.Is(err, redeem.ErrNoLiveHold) {
		t.Errorf("releasing a hold on a voided voucher revived it: err = %v", err)
	}
}

// D15 and D3 scenario A: the sweeper expired the hold but left the voucher
// `held`, so the next authorize ran the illegal move held -> held.
func TestSweepingAStaleHoldReturnsTheVoucherToActive(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	voucherID, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	hold, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000, Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE voucher.authorization
		SET created_at = now() - interval '20 minutes', expires_at = now() - interval '5 minutes'
		WHERE id = $1`, hold.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.network.SweepExpiredHolds(ctx); err != nil {
		t.Fatal(err)
	}
	if state := f.stateOf(t, voucherID); state != "active" {
		t.Fatalf("after the sweep the voucher is %s, want active", state)
	}
	if f.remainingOf(t, voucherID) != 50_000 {
		t.Errorf("the sweep changed the value to %d", f.remainingOf(t, voucherID))
	}
}

// The database refuses a move the table does not have, whoever writes it.
func TestTheDatabaseRefusesAnIllegalTransition(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	voucherID, plaintext := f.mintOne(t, "single_use_forfeit", 50_000, nil)

	hold, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 50_000, Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.network.Capture(ctx, hold.ID, f.merchantID, 50_000, orderRef()); err != nil {
		t.Fatal(err)
	}
	_, err = f.pool.Exec(ctx, `UPDATE voucher.vouchers SET state = 'active', remaining_value_minor = 50000,
		version = version + 1 WHERE id = $1`, voucherID)
	if err == nil || !strings.Contains(err.Error(), "illegal voucher transition") {
		t.Fatalf("a redeemed voucher was revived by a direct write: %v", err)
	}
}

// A refund restores value only to a live voucher: refunding onto a voided
// one would make the kill switch advisory.
func TestARefundCannotReviveAVoidedVoucher(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	voucherID, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	hold, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000, Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatal(err)
	}
	captured, err := f.network.Capture(ctx, hold.ID, f.merchantID, 10_000, orderRef())
	if err != nil {
		t.Fatal(err)
	}
	if err := f.minter.Void(ctx, voucherID, lifecycle.ReasonFraud); err != nil {
		t.Fatal(err)
	}
	if err := f.network.Refund(ctx, captured.ID, 5_000, "probe"); err == nil {
		t.Fatal("a refund restored value to a voided voucher")
	}
	if f.remainingOf(t, voucherID) != 40_000 {
		t.Errorf("remaining = %d, want 40000", f.remainingOf(t, voucherID))
	}
}

// The database's transition table and lifecycle.Transitions are one fact in
// two places; this keeps them from drifting.
func TestTheDatabaseTransitionTableMatchesTheGoOne(t *testing.T) {
	f := newFixture(t)
	for _, from := range lifecycle.States {
		for _, to := range lifecycle.States {
			var allowed bool
			if err := f.pool.QueryRow(context.Background(),
				`SELECT voucher.transition_allowed($1, $2)`, string(from), string(to)).Scan(&allowed); err != nil {
				t.Fatal(err)
			}
			if allowed != lifecycle.CanTransition(from, to) {
				t.Errorf("%s -> %s: database says %v, lifecycle says %v", from, to, allowed, !allowed)
			}
		}
	}
}
