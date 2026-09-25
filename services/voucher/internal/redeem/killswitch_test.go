package redeem_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/redeem"
)

// 4.6.b: the kill switch covers every scope and the capture, and the
// throttle counts only probes (engine-voucher.md D4, D13).

func (f *fixture) kill(t *testing.T, scope string, scopeID any) {
	t.Helper()
	id := uuid.New()
	if _, err := f.pool.Exec(context.Background(),
		`INSERT INTO voucher.kill_switch (id, scope, scope_id, reason, enabled_by) VALUES ($1, $2, $3, 'probe', 'probe')`,
		id, scope, scopeID); err != nil {
		t.Fatalf("enabling a %s kill switch: %v", scope, err)
	}
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(),
			`UPDATE voucher.kill_switch SET lifted_by = 'probe', lifted_at = now() WHERE id = $1`, id)
	})
}

// D4: batch scope passed a NULL batch id, so killing a leaked batch did nothing.
func TestAKilledBatchCannotBeRedeemed(t *testing.T) {
	f := newFixture(t)
	voucherID, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)
	var batchID uuid.UUID
	if err := f.pool.QueryRow(context.Background(), `SELECT batch_id FROM voucher.vouchers WHERE id = $1`, voucherID).Scan(&batchID); err != nil {
		t.Fatal(err)
	}
	f.kill(t, "batch", batchID)

	_, err := f.network.Authorize(context.Background(), redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000, Currency: "IDR", OrderRef: orderRef(),
	})
	if !errors.Is(err, redeem.ErrKilled) {
		t.Fatalf("a voucher from a killed batch authorized: err = %v", err)
	}
}

// D4: a stolen key's holds could still be captured after the merchant was killed.
func TestAKilledMerchantCannotCaptureAHoldPlacedBefore(t *testing.T) {
	f := newFixture(t)
	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)
	hold, err := f.network.Authorize(context.Background(), redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000, Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatal(err)
	}
	f.kill(t, "merchant", f.merchantID)

	if _, err := f.network.Capture(context.Background(), hold.ID, f.merchantID, 10_000, orderRef()); !errors.Is(err, redeem.ErrKilled) {
		t.Fatalf("a killed merchant captured: err = %v", err)
	}
}

// D13: every refusal counted, so honest minimum-spend refusals in a lunch
// rush throttled a legitimate till, and throttled retries kept it throttled.
func TestHonestRefusalsDoNotThrottleATill(t *testing.T) {
	f := newFixture(t)
	minimum := int64(100_000)
	_, plaintext := f.mintOne(t, "minimum_spend", 50_000, &minimum)
	merchant := f.merchantID

	for i := 0; i < redeem.FailureThreshold+2; i++ {
		_, err := f.network.Authorize(context.Background(), redeem.AuthorizeRequest{
			Code: plaintext, MerchantID: merchant, AmountMinor: 1_000, Currency: "IDR", OrderRef: orderRef(),
		})
		if errors.Is(err, redeem.ErrThrottled) {
			t.Fatalf("attempt %d: an honest minimum-spend refusal throttled the till", i)
		}
	}
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(),
			`DELETE FROM voucher.redemption_attempt WHERE merchant_id = $1 AND outcome <> 'authorized'`, merchant)
	})
}
