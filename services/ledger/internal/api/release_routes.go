package api

import (
	"fmt"
	"net/http"

	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// ledger-internal's release notices (4.4.g). The worker lists held grants
// the ledger has released, sends one `ledger.points_unlocked` event each,
// then acknowledges them. The ledger never talks to the queue itself.

const (
	defaultReleasePage = 100
	maxReleasePage     = 500
)

type releaseView struct {
	GrantID    string `json:"grantId"`
	UserID     string `json:"userId"`
	Region     string `json:"region"`
	Points     int64  `json:"points"`
	UnlockedAt string `json:"unlockedAt"`
}

func (a *API) unnotifiedReleases(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Limit int32 `json:"limit,omitempty"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if body.Limit < 0 || body.Limit > maxReleasePage {
		a.fail(w, fmt.Errorf("%w: limit must be 1..%d", errBadRequest, maxReleasePage))
		return
	}
	if body.Limit == 0 {
		body.Limit = defaultReleasePage
	}
	rows, err := sqlcgen.New(a.pool).ListUnnotifiedReleases(r.Context(), body.Limit)
	if err != nil {
		a.fail(w, err)
		return
	}
	views := make([]releaseView, 0, len(rows))
	for _, row := range rows {
		views = append(views, releaseView{GrantID: row.ID, UserID: row.UserID, Region: row.Region,
			Points: row.Points, UnlockedAt: iso(row.UnlockedAt.Time)})
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{"releases": views})
}

func (a *API) releasesNotified(w http.ResponseWriter, r *http.Request) {
	var body struct {
		GrantIDs []string `json:"grantIds"`
	}
	if !a.decode(w, r, &body) {
		return
	}
	if len(body.GrantIDs) == 0 || len(body.GrantIDs) > maxReleasePage {
		a.fail(w, fmt.Errorf("%w: grantIds must hold 1..%d ids", errBadRequest, maxReleasePage))
		return
	}
	recorded, err := sqlcgen.New(a.pool).InsertReleaseNotices(r.Context(), body.GrantIDs)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{"acknowledged": recorded})
}
