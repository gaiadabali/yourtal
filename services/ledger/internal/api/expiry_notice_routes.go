package api

import (
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

func parseISO(value string) (time.Time, error) {
	return time.Parse(time.RFC3339, value)
}

// TASKS.md 10.2.d: mirrors release_routes.go's unnotified/notified shape
// (20260926003000) — apps/worker polls a durable outbox rather than the
// ledger pushing anything, same reasoning points-unlocked.ts's own header
// gives.
const (
	defaultExpiryNoticePage = 100
	maxExpiryNoticePage     = 500
)

type expiryNoticeView struct {
	AccountID     string `json:"accountId"`
	UserID        string `json:"userId"`
	Region        string `json:"region"`
	MilestoneDays int32  `json:"milestoneDays"`
	ExpiringAt    string `json:"expiringAt"`
	Points        int64  `json:"points"`
}

func (a *API) unnotifiedPointsExpiry(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Limit int32 `json:"limit,omitempty"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if body.Limit < 0 || body.Limit > maxExpiryNoticePage {
		a.fail(w, fmt.Errorf("%w: limit must be 1..%d", errBadRequest, maxExpiryNoticePage))
		return
	}
	if body.Limit == 0 {
		body.Limit = defaultExpiryNoticePage
	}
	q := sqlcgen.New(a.pool)
	rows, err := q.ListUnnotifiedPointsExpiry(r.Context(), body.Limit)
	if err != nil {
		a.fail(w, err)
		return
	}
	views := make([]expiryNoticeView, 0, len(rows))
	for _, row := range rows {
		// Read fresh at announce time rather than stored at notice time: a
		// viewer who spends some points between the notice and the
		// announcement should be warned about what they are ABOUT to lose,
		// not a stale snapshot.
		points, err := q.GetAccountBalance(r.Context(), row.AccountID)
		if err != nil {
			a.fail(w, err)
			return
		}
		views = append(views, expiryNoticeView{
			AccountID: row.AccountID, UserID: row.UserID, Region: row.Region,
			MilestoneDays: row.MilestoneDays, ExpiringAt: iso(row.ExpiringAt.Time), Points: points,
		})
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{"notices": views})
}

func (a *API) pointsExpiryNotified(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Notices []struct {
			AccountID     string `json:"accountId"`
			MilestoneDays int32  `json:"milestoneDays"`
			ExpiringAt    string `json:"expiringAt"`
		} `json:"notices"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	q := sqlcgen.New(a.pool)
	for _, notice := range body.Notices {
		expiringAt, err := parseISO(notice.ExpiringAt)
		if err != nil {
			a.fail(w, fmt.Errorf("%w: %s", errBadRequest, err))
			return
		}
		if err := q.MarkPointsExpiryNotified(r.Context(), sqlcgen.MarkPointsExpiryNotifiedParams{
			AccountID: notice.AccountID, MilestoneDays: notice.MilestoneDays,
			ExpiringAt: pgtype.Timestamptz{Time: expiringAt, Valid: true},
		}); err != nil {
			a.fail(w, err)
			return
		}
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{"acknowledged": len(body.Notices)})
}
