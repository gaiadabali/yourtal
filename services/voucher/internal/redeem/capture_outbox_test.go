package redeem_test

import (
	"context"
	"testing"

	"github.com/yourtal/services/voucher/internal/redeem"
)

// 4.6.f/10.1.a: the capture transaction writes a capture_outbox row, in the
// same transaction as the capture itself — internal/ledgerpost posts
// unposted rows to the ledger with idempotency key = capture_id, at the
// voucher's settlement value S scaled by how much of its face value this
// capture drew down (F12), not at the raw captured amount.
func TestCaptureWritesAnOutboxRow(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	// listingFor sets settlement_value_minor = faceMinor/3 (50_000/3 =
	// 16_666). Capturing 30_000 of 50_000 owes ceil(16_666 * 30_000 /
	// 50_000) = 10_000, not the 30_000 captured.
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
	if amountMinor != 10_000 {
		t.Errorf("amount_minor = %d, want 10000 (the payable share of S, not the 30000 captured)", amountMinor)
	}
	if currency != "IDR" {
		t.Errorf("currency = %q, want IDR", currency)
	}
	if postedAt != nil {
		t.Errorf("posted_at = %v, want nil — nothing has posted this yet", *postedAt)
	}
}

// 10.1.a's cap: "capped so the total never exceeds S". Five equal partial
// captures fully draining a balance-carrying voucher must telescope to
// exactly S in total, however the ceil rounding falls on each step, and
// never a cent past it.
func TestPartialCapturesTelescopeToSAndNeverExceedIt(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	// face 50_000, so settlement_value_minor = 50_000/3 = 16_666 (S).
	const face, S = int64(50_000), int64(16_666)
	_, plaintext := f.mintOne(t, "balance_carrying", face, nil)

	var total int64
	for i := 0; i < 5; i++ {
		authorization, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
			Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000,
			Currency: "IDR", OrderRef: orderRef(),
		})
		if err != nil {
			t.Fatalf("Authorize %d: %v", i, err)
		}
		captured, err := f.network.Capture(ctx, authorization.ID, f.merchantID, 10_000, orderRef())
		if err != nil {
			t.Fatalf("Capture %d: %v", i, err)
		}

		var amountMinor int64
		err = f.pool.QueryRow(ctx,
			`SELECT amount_minor FROM voucher.capture_outbox WHERE capture_id = $1`,
			captured.ID).Scan(&amountMinor)
		if err != nil {
			t.Fatalf("reading the outbox row for capture %d: %v", i, err)
		}
		total += amountMinor
		if total > S {
			t.Fatalf("after capture %d, total payable %d exceeds S %d", i, total, S)
		}
	}

	if total != S {
		t.Errorf("total payable across all captures = %d, want exactly S = %d", total, S)
	}
}
