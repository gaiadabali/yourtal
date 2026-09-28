package redeem

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// TASKS.md 8.3.e (found by 8.3.c): this service is the single source for
// voucher.captured/refunded/expired -- a capture or refund made through the
// merchant HMAC API or the counter/device route each write one outbox row
// here, in the SAME transaction as the state change, the same shape
// voucher.capture_outbox (4.6.f) already uses for the ledger. apps/worker
// polls unposted rows through /internal/v1/webhook-events and hands each to
// the 8.3.c signer.
//
// Shared by package redeem (Capture, Refund) and package api's
// captureAsDevice (the counter/device path, a deliberately separate
// implementation from Capture -- device_routes.go's own header explains
// why), so a caller-supplied queries lets either package write inside its
// own transaction rather than each re-deriving pgUUID/json.Marshal.

// WebhookOutboxEvent is one row to record. Payload keys match what
// counter.controller.ts published before this ticket moved the source of
// truth here: captureId/voucherId/amountMinor/currency/capturedAt/orderRef
// for voucher.captured, the refund equivalents for voucher.refunded.
type WebhookOutboxEvent struct {
	EventType      string
	MerchantID     uuid.UUID
	IdempotencyKey string
	Payload        map[string]any
}

// RecordWebhookOutbox writes one outbox row. queries must be built from the
// SAME transaction as the state change this event names -- an outbox row
// with no capture, or a capture with no outbox row, is exactly the gap
// 4.6.f's own comment describes for the ledger outbox, and it applies here
// identically.
func RecordWebhookOutbox(ctx context.Context, queries *sqlcgen.Queries, event WebhookOutboxEvent) error {
	payload, err := json.Marshal(event.Payload)
	if err != nil {
		return fmt.Errorf("marshalling the webhook outbox payload: %w", err)
	}
	if err := queries.InsertWebhookOutbox(ctx, sqlcgen.InsertWebhookOutboxParams{
		EventType:      event.EventType,
		MerchantID:     pgUUID(event.MerchantID),
		IdempotencyKey: event.IdempotencyKey,
		Payload:        payload,
	}); err != nil {
		return fmt.Errorf("recording the webhook outbox row: %w", err)
	}
	return nil
}
