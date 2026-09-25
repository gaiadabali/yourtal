package redeem_test

import (
	"context"
	"testing"

	"github.com/yourtal/services/voucher/internal/redeem"
)

// 4.6.f: the capture transaction writes a capture_outbox row, in the same
// transaction as the capture itself — a worker job (10.1) posts unposted
// rows to the ledger with idempotency key = capture_id.
func TestCaptureWritesAnOutboxRow(t *testing.T) {
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

	captured, err := f.network.Capture(ctx, authorization.ID, f.merchantID, 30_000, "rcpt_outbox_test")
	if err != nil {
		t.Fatalf("Capture: %v", err)
	}

	var (
		region, currency string
		merchantID       string
		amountMinor      int64
		postedAt         *string
	)
	if err := f.pool.QueryRow(ctx,
		`SELECT region, merchant_id::text, amount_minor, currency, posted_at::text
		   FROM voucher.capture_outbox WHERE capture_id = $1`,
		captured.ID).Scan(&region, &merchantID, &amountMinor, &currency, &postedAt); err != nil {
		t.Fatalf("reading the outbox row: %v", err)
	}

	if region != "ID" {
		t.Errorf("region = %q, want ID", region)
	}
	if merchantID != f.merchantID.String() {
		t.Errorf("merchant_id = %s, want %s", merchantID, f.merchantID)
	}
	if amountMinor != 30_000 {
		t.Errorf("amount_minor = %d, want 30000", amountMinor)
	}
	if currency != "IDR" {
		t.Errorf("currency = %q, want IDR", currency)
	}
	if postedAt != nil {
		t.Errorf("posted_at = %v, want nil — nothing has posted this yet", *postedAt)
	}
}
