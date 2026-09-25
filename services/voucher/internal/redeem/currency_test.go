package redeem_test

import (
	"context"
	"errors"
	"testing"

	"github.com/yourtal/services/voucher/internal/redeem"
)

// YT-0574 (0.3.d): a request whose currency does not match the voucher's own
// is refused as its own, distinct outcome — not folded into the generic
// ErrRefused every other lookup failure shares. The mismatch is a fact the
// merchant's own integration already knows (it chose both currencies), so
// naming it costs a prober nothing, unlike "insufficient value" or "wrong
// merchant" which stay behind ErrRefused on purpose.
func TestCurrencyMismatchOutcome(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	_, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000,
		Currency: "AUD", OrderRef: orderRef(),
	})
	if !errors.Is(err, redeem.ErrCurrencyMismatch) {
		t.Fatalf("a mismatched currency was not refused as ErrCurrencyMismatch: %v", err)
	}
	if errors.Is(err, redeem.ErrRefused) {
		t.Errorf("a currency mismatch must not also satisfy ErrRefused — it is its own outcome, " +
			"not the generic enumeration-safe one")
	}
	// Names both currencies. Unlike ErrRefused, this is not an enumeration
	// surface (see redeem.go's check()), so the detail is allowed to leave.
	if !contains(err.Error(), "IDR") || !contains(err.Error(), "AUD") {
		t.Errorf("the refusal does not name both currencies: %v", err)
	}

	// The matching currency still works on the same voucher.
	if _, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000,
		Currency: "IDR", OrderRef: orderRef(),
	}); err != nil {
		t.Fatalf("the correct currency was refused: %v", err)
	}
}

// The enumeration throttle counts every non-authorized outcome except
// `currency_mismatch` (CountFailedAttemptsSince, db/query/redeem.sql). A
// currency mismatch means the code was real, belonged to this merchant, and
// was otherwise redeemable — a client-side integration bug, not a probe —
// so it must never push a merchant toward ErrThrottled.
func TestCurrencyMismatchDoesNotThrottle(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	// Comfortably more than FailureThreshold, against the RIGHT merchant and
	// a REAL, live code — the only thing wrong with every one of these
	// requests is the currency. If that outcome counted toward the throttle,
	// this loop alone would trip it.
	for attempt := 0; attempt < redeem.FailureThreshold+5; attempt++ {
		_, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
			Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000,
			Currency: "AUD", OrderRef: orderRef(),
		})
		if !errors.Is(err, redeem.ErrCurrencyMismatch) {
			t.Fatalf("attempt %d: unexpected %v", attempt, err)
		}
	}

	// The voucher still authorizes normally afterwards — proof the merchant
	// was never throttled by the mismatches above.
	if _, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000,
		Currency: "IDR", OrderRef: orderRef(),
	}); err != nil {
		t.Fatalf("the merchant was throttled by currency mismatches alone: %v", err)
	}
}

// YT-0574 (0.3.d): a minted voucher carries its batch's own currency — set
// once at InsertVoucher time from `batch.currency` — not a value re-derived
// or defaulted at mint time.
func TestIssuanceCopiesCurrency(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	voucherID, _ := f.mintOne(t, "balance_carrying", 50_000, nil)

	var currency string
	if err := f.pool.QueryRow(ctx,
		`SELECT currency FROM voucher.vouchers WHERE id = $1`, voucherID).Scan(&currency); err != nil {
		t.Fatalf("reading currency: %v", err)
	}
	// mintOne (redeem_test.go) always requests the batch in IDR.
	if currency != "IDR" {
		t.Errorf("voucher currency = %q, want IDR (the batch's own currency)", currency)
	}
}
