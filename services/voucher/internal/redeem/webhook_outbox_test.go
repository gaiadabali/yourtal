package redeem_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/yourtal/services/voucher/internal/redeem"
)

// 8.3.e: a capture or refund the merchant HMAC network settles writes a
// voucher.webhook_outbox row in the SAME transaction, exactly like
// capture_outbox_test.go proves for the ledger outbox (4.6.f) — this is the
// business's own notification, not the ledger's.

func TestCaptureWritesAWebhookOutboxRow(t *testing.T) {
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

	captured, err := f.network.Capture(ctx, authorization.ID, f.merchantID, 30_000, "rcpt_webhook_outbox_test")
	if err != nil {
		t.Fatalf("Capture: %v", err)
	}

	var (
		eventType, idempotencyKey, merchantID string
		payload                                []byte
		postedAt                               *string
	)
	if err := f.pool.QueryRow(ctx,
		`SELECT event_type, merchant_id::text, idempotency_key, payload, posted_at::text
		   FROM voucher.webhook_outbox WHERE idempotency_key = $1`,
		captured.ID.String()).Scan(&eventType, &merchantID, &idempotencyKey, &payload, &postedAt); err != nil {
		t.Fatalf("reading the webhook outbox row: %v", err)
	}

	if eventType != "voucher.captured" {
		t.Errorf("event_type = %q, want voucher.captured", eventType)
	}
	if merchantID != f.merchantID.String() {
		t.Errorf("merchant_id = %s, want %s", merchantID, f.merchantID)
	}
	if idempotencyKey != captured.ID.String() {
		t.Errorf("idempotency_key = %q, want the capture id %s", idempotencyKey, captured.ID)
	}
	if postedAt != nil {
		t.Errorf("posted_at = %v, want nil — apps/worker has not drained this yet", *postedAt)
	}

	var body struct {
		CaptureID   string `json:"captureId"`
		VoucherID   string `json:"voucherId"`
		AmountMinor int64  `json:"amountMinor"`
		Currency    string `json:"currency"`
		OrderRef    string `json:"orderRef"`
	}
	if err := json.Unmarshal(payload, &body); err != nil {
		t.Fatalf("payload does not parse: %v", err)
	}
	if body.CaptureID != captured.ID.String() || body.AmountMinor != 30_000 || body.Currency != "IDR" {
		t.Errorf("payload = %+v", body)
	}

	// Exactly one row — a business that both captures once and receives one
	// notification, never a duplicate from the same commit.
	var count int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM voucher.webhook_outbox WHERE idempotency_key = $1`,
		captured.ID.String()).Scan(&count); err != nil {
		t.Fatalf("counting outbox rows: %v", err)
	}
	if count != 1 {
		t.Errorf("%d webhook_outbox rows for one capture, want 1", count)
	}
}

func TestRefundWritesAWebhookOutboxRow(t *testing.T) {
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
	captured, err := f.network.Capture(ctx, authorization.ID, f.merchantID, 30_000, "rcpt_refund_webhook_test")
	if err != nil {
		t.Fatalf("Capture: %v", err)
	}

	refundRef := orderRef()
	if err := f.network.Refund(ctx, captured.ID, 10_000, "customer change of mind", refundRef); err != nil {
		t.Fatalf("Refund: %v", err)
	}

	var (
		eventType, merchantID string
		payload                []byte
	)
	if err := f.pool.QueryRow(ctx,
		`SELECT event_type, merchant_id::text, payload FROM voucher.webhook_outbox
		  WHERE event_type = 'voucher.refunded' AND payload->>'captureId' = $1`,
		captured.ID.String()).Scan(&eventType, &merchantID, &payload); err != nil {
		t.Fatalf("reading the refund webhook outbox row: %v", err)
	}
	if eventType != "voucher.refunded" {
		t.Errorf("event_type = %q, want voucher.refunded", eventType)
	}
	if merchantID != f.merchantID.String() {
		t.Errorf("merchant_id = %s, want %s", merchantID, f.merchantID)
	}

	var body struct {
		RefundID    string `json:"refundId"`
		CaptureID   string `json:"captureId"`
		AmountMinor int64  `json:"amountMinor"`
		Reason      string `json:"reason"`
	}
	if err := json.Unmarshal(payload, &body); err != nil {
		t.Fatalf("payload does not parse: %v", err)
	}
	if body.CaptureID != captured.ID.String() || body.AmountMinor != 10_000 || body.Reason == "" {
		t.Errorf("payload = %+v", body)
	}

	// A replayed refund (same refundRef) is a no-op at the Refund layer
	// (release.go's own inserted==0 branch) — no second outbox row.
	if err := f.network.Refund(ctx, captured.ID, 10_000, "customer change of mind", refundRef); err != nil {
		t.Fatalf("replaying the same refund ref: %v", err)
	}
	var count int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM voucher.webhook_outbox WHERE event_type = 'voucher.refunded' AND payload->>'captureId' = $1`,
		captured.ID.String()).Scan(&count); err != nil {
		t.Fatalf("counting refund outbox rows: %v", err)
	}
	if count != 1 {
		t.Errorf("%d voucher.refunded rows after a replayed refund, want 1", count)
	}
}
