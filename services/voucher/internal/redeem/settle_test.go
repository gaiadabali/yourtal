package redeem_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/redeem"
)

// What happens AFTER a hold: voiding, capturing, refunding, and the two
// expiry behaviours. Split from adversarial_test.go to stay under docs/15
// rule 6's 300 lines; the seam is that everything here needs a hold to
// already exist.

// A void releases the hold and takes nothing.
func TestVoidingReleasesTheHoldWithTheValueIntact(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	voucherID, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	authorization, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 30_000,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatalf("Authorize: %v", err)
	}
	if err := f.network.Void(ctx, authorization.ID, f.merchantID); err != nil {
		t.Fatalf("Void: %v", err)
	}

	if state := f.stateOf(t, voucherID); state != "active" {
		t.Errorf("after a void the voucher is %q, want active", state)
	}

	// The whole value is still there, and the voucher is spendable again.
	if _, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 50_000,
		Currency: "IDR", OrderRef: orderRef(),
	}); err != nil {
		t.Errorf("a voided hold did not release the value: %v", err)
	}

	// Voiding twice is refused: the second call has no live hold.
	if err := f.network.Void(ctx, authorization.ID, f.merchantID); !errors.Is(err, redeem.ErrNoLiveHold) {
		t.Errorf("a hold was voided twice: %v", err)
	}
}

// docs/09 §8.1: "once settled, a transaction can only be refunded, never
// voided." Expressed structurally — `Void` takes an authorization id, and a
// captured authorization has no live hold to release.
func TestACapturedAuthorizationCannotBeVoided(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	authorization, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 30_000,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatalf("Authorize: %v", err)
	}
	if _, err := f.network.Capture(ctx, authorization.ID, f.merchantID, 30_000, orderRef()); err != nil {
		t.Fatalf("Capture: %v", err)
	}

	if err := f.network.Void(ctx, authorization.ID, f.merchantID); !errors.Is(err, redeem.ErrNoLiveHold) {
		t.Errorf("a captured authorization was voided: %v", err)
	}
}

// A refund restores value to a voucher that is still active.
func TestARefundRestoresValueToAPartlySpentVoucher(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	voucherID, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	authorization, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 30_000,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatalf("Authorize: %v", err)
	}
	capture, err := f.network.Capture(ctx, authorization.ID, f.merchantID, 30_000, orderRef())
	if err != nil {
		t.Fatalf("Capture: %v", err)
	}

	if err := f.network.Refund(ctx, capture.ID, 10_000, "customer returned an item"); err != nil {
		t.Fatalf("Refund: %v", err)
	}

	if remaining := f.remainingOf(t, voucherID); remaining != 30_000 {
		t.Errorf("after refunding IDR 10,000 the voucher holds %d, want 30000", remaining)
	}

	// And it cannot be refunded past what was captured — the deferred
	// trigger fires at COMMIT.
	if err := f.network.Refund(ctx, capture.ID, 25_000, "too much"); err == nil {
		t.Error("refunds exceeding the capture succeeded")
	}
}

// The collision between YT-0142 and docs/09 §8.1, refused by name rather
// than guessed at. See the note on ErrRefundNeedsReplacement.
func TestRefundingAFullyRedeemedVoucherRefusesRatherThanGuessing(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	_, plaintext := f.mintOne(t, "single_use_forfeit", 50_000, nil)

	authorization, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 50_000,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatalf("Authorize: %v", err)
	}
	capture, err := f.network.Capture(ctx, authorization.ID, f.merchantID, 50_000, orderRef())
	if err != nil {
		t.Fatalf("Capture: %v", err)
	}

	err = f.network.Refund(ctx, capture.ID, 10_000, "customer returned an item")
	if !errors.Is(err, redeem.ErrRefundNeedsReplacement) {
		t.Fatalf("a spent voucher was quietly revived or silently failed: %v", err)
	}
	// The refusal names the ticket, so whoever hits it knows it is a pending
	// decision rather than a bug to work around.
	if !contains(err.Error(), "YT-0142") {
		t.Errorf("the refusal does not say where the decision lives: %v", err)
	}
}

// docs/09 §10's kill switch: "one call disables a compromised merchant's
// ability to redeem anything."
func TestTheKillSwitchStopsRedemption(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)
	switchID := uuid.New()

	if _, err := f.pool.Exec(ctx,
		`INSERT INTO voucher.kill_switch (id, scope, scope_id, reason, enabled_by)
		 VALUES ($1, 'merchant', $2, 'probe: suspected key compromise', 'probe')`,
		switchID, f.merchantID); err != nil {
		t.Fatalf("enabling the kill switch: %v", err)
	}
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(),
			`DELETE FROM voucher.kill_switch WHERE id = $1`, switchID)
	})

	_, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if !errors.Is(err, redeem.ErrKilled) {
		t.Fatalf("a killed merchant redeemed a voucher: %v", err)
	}

	// Lifting it restores service. A kill switch nobody can turn off is one
	// nobody dares turn on.
	if _, err := f.pool.Exec(ctx,
		`UPDATE voucher.kill_switch SET lifted_by = 'probe', lifted_at = now() WHERE id = $1`,
		switchID); err != nil {
		t.Fatalf("lifting: %v", err)
	}
	if _, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000,
		Currency: "IDR", OrderRef: orderRef(),
	}); err != nil {
		t.Errorf("lifting the kill switch did not restore redemption: %v", err)
	}
}

// YT-0153: repeated invalid codes auto-throttle the merchant.
func TestEnumerationIsThrottled(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	// A merchant of its own, so the throttle counts only this test's
	// failures and the assertion is about what this test caused.
	prober := uuid.New()

	for attempt := 0; attempt < redeem.FailureThreshold; attempt++ {
		_, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
			Code: mintedButUnknownCode(t), MerchantID: prober, AmountMinor: 1_000,
			Currency: "IDR", OrderRef: orderRef(),
		})
		if !errors.Is(err, redeem.ErrRefused) {
			t.Fatalf("probe %d: unexpected %v", attempt, err)
		}
	}
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(),
			`DELETE FROM voucher.redemption_attempt WHERE merchant_id = $1`, prober)
	})

	// The next one is throttled rather than merely refused — and the
	// difference matters: a refusal is per-code, a throttle is per-merchant
	// and is what actually stops a walk of the code space.
	_, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: mintedButUnknownCode(t), MerchantID: prober, AmountMinor: 1_000,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if !errors.Is(err, redeem.ErrThrottled) {
		t.Fatalf("after %d failed lookups the merchant was not throttled: %v",
			redeem.FailureThreshold, err)
	}
}

// An expired hold cannot be captured even before a sweeper has touched it.
// Expiry is applied at the moment of use, so a sweeper that stops running
// cannot silently turn every hold into a permanent one.
func TestAnExpiredHoldCannotBeCaptured(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	authorization, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatalf("Authorize: %v", err)
	}

	// Age the hold past its TTL without waiting fifteen minutes, and without
	// touching its state — so what refuses the capture is the expiry check
	// rather than a state somebody already resolved.
	//
	// BOTH timestamps move. Pushing only `expires_at` into the past is
	// refused by `authorization_expires_after_creation`, which is the
	// constraint doing its job: a hold that expired before it was created is
	// not a state the table will hold, not even for a test. So this
	// simulates a hold placed twenty minutes ago rather than one that was
	// born expired.
	if _, err := f.pool.Exec(ctx,
		`UPDATE voucher.authorization
		    SET created_at = now() - interval '20 minutes',
		        expires_at = now() - interval '5 minutes'
		  WHERE id = $1`,
		authorization.ID); err != nil {
		t.Fatalf("ageing the hold: %v", err)
	}

	if _, err := f.network.Capture(ctx, authorization.ID, f.merchantID, 10_000, orderRef()); !errors.Is(
		err, redeem.ErrNoLiveHold,
	) {
		t.Fatalf("an expired hold was captured: %v", err)
	}
}
