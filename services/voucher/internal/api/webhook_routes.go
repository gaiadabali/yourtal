package api

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// TASKS.md 8.3.e (found by 8.3.c): apps/worker's own version of
// release_routes.go's unnotifiedReleases/releasesNotified pair — a
// list-then-acknowledge poll over voucher.webhook_outbox (8.3.e's own
// migration), the outbox redeem.Capture/Refund and captureAsDevice all
// write into inside their own transaction. This service never talks to
// pg-boss itself; apps/worker enqueues what it reads here onto the 8.3.c
// delivery queue and acknowledges only after every send succeeds.

const (
	defaultWebhookEventPage = 100
	maxWebhookEventPage     = 500
)

type webhookOutboxEventView struct {
	ID             string          `json:"id"`
	EventType      string          `json:"eventType"`
	MerchantID     string          `json:"merchantId"`
	IdempotencyKey string          `json:"idempotencyKey"`
	Payload        json.RawMessage `json:"payload"`
	CreatedAt      string          `json:"createdAt"`
}

func (a *API) unpostedWebhookEvents(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Limit int32 `json:"limit,omitempty"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if body.Limit < 0 || body.Limit > maxWebhookEventPage {
		a.fail(w, fmt.Errorf("%w: limit must be 1..%d", errBadRequest, maxWebhookEventPage))
		return
	}
	if body.Limit == 0 {
		body.Limit = defaultWebhookEventPage
	}
	rows, err := sqlcgen.New(a.pool).ListUnpostedWebhookOutbox(r.Context(), body.Limit)
	if err != nil {
		a.fail(w, err)
		return
	}
	views := make([]webhookOutboxEventView, 0, len(rows))
	for _, row := range rows {
		views = append(views, webhookOutboxEventView{
			ID:             asUUID(row.ID).String(),
			EventType:      row.EventType,
			MerchantID:     asUUID(row.MerchantID).String(),
			IdempotencyKey: row.IdempotencyKey,
			Payload:        json.RawMessage(row.Payload),
			CreatedAt:      iso(row.CreatedAt.Time),
		})
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{"events": views})
}

func (a *API) webhookEventsPosted(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if len(body.IDs) == 0 || len(body.IDs) > maxWebhookEventPage {
		a.fail(w, fmt.Errorf("%w: ids must hold 1..%d ids", errBadRequest, maxWebhookEventPage))
		return
	}
	ids := make([]pgtype.UUID, 0, len(body.IDs))
	for _, raw := range body.IDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			a.fail(w, fmt.Errorf("%w: %q is not a uuid", errBadRequest, raw))
			return
		}
		ids = append(ids, pgUUID(id))
	}
	acknowledged, err := sqlcgen.New(a.pool).MarkWebhookOutboxPosted(r.Context(), ids)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{"acknowledged": acknowledged})
}
