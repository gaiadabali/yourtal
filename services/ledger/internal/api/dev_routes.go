package api

import (
	"fmt"
	"net/http"

	"github.com/yourtal/services/ledger/internal/httpx"
	"github.com/yourtal/services/ledger/internal/ledger"
)

// Dev/staging only: apps/api's `/dev/clock` (TASKS.md 2.3.d) needs an
// admin-triggered early release the ledger's own loop
// (internal/reward/release.go's ReleaseDue) does not otherwise expose —
// ReleaseDue runs on the ledger's schedule, releasing whatever is due; there
// was no way for a reviewer to make a *specific* grant due sooner. Refused
// with 404 unless EnableDevRoutes(true) was called (cmd/ledger/main.go does
// that only when APP_ENV is "dev" or "staging"), the same fail-closed shape
// serviceauth already uses for a missing secret: a production deployment
// does not even reveal the route exists.
//
// One endpoint covers both of apps/api's dev-clock actions: "release my
// pending points now" sends releaseNow, "advance N days" sends days. Either
// way it releases whichever of the caller's own not-yet-released grants a
// real wait of that length would have made due, through
// `(*reward.Engine).ShiftAndReleaseUser` — the same `releaseInTx` ReleaseDue
// posts through, so the double-entry stays the engine's, never this
// handler's. See that function's own comment for why this never writes to
// ledger.grant.unlock_at (yourtal_ledger has UPDATE revoked on it, on
// purpose).

// maxHoldbackDays mirrors apps/api's AdvanceDaysDto (1..3650): the ledger
// enforces its own bound rather than trusting the caller's, but keeps it
// wide enough that "advance N days" never sees two different ceilings.
const maxHoldbackDays = 3650

// devReleaseLimit bounds one call's release pass, same order of magnitude as
// the other release routes' maxReleasePage (release_routes.go). A reviewer's
// own account will never come close to it.
const devReleaseLimit = 500

type advanceHoldbackRequest struct {
	UserID     string `json:"userId"`
	Days       int32  `json:"days,omitempty"`
	ReleaseNow bool   `json:"releaseNow,omitempty"`
}

type advanceHoldbackResponse struct {
	Shifted    int  `json:"shifted"`
	Released   int  `json:"released"`
	EscrowHeld bool `json:"escrowHeld"`
}

func (a *API) advanceHoldback(w http.ResponseWriter, r *http.Request) {
	if !a.devEnabled {
		httpx.WriteError(w, a.logger, http.StatusNotFound, "invalid_request_error", "not_found", "no such endpoint")
		return
	}

	var body advanceHoldbackRequest
	if !a.decode(w, r, &body) {
		return
	}
	if body.UserID == "" {
		a.fail(w, fmt.Errorf("%w: userId is required", errBadRequest))
		return
	}
	if !body.ReleaseNow && (body.Days < 1 || body.Days > maxHoldbackDays) {
		a.fail(w, fmt.Errorf("%w: days must be 1..%d unless releaseNow is set", errBadRequest, maxHoldbackDays))
		return
	}

	// Either region's engine releases the same way: ShiftAndReleaseUser (and
	// the releaseInTx it calls) never reads the engine's own region, only
	// e.ledger — so which of the two per-region engines runs this is
	// immaterial. Every query inside is scoped `WHERE user_id = $1`, and a
	// user belongs to exactly one region's rows, which is what keeps this
	// call from ever touching the other economy's grants.
	engine := a.rewards[ledger.RegionAU]
	shifted, released, escrowHeld, err := engine.ShiftAndReleaseUser(
		r.Context(), a.pool, body.UserID, body.Days, body.ReleaseNow, devReleaseLimit)
	if err != nil {
		a.fail(w, err)
		return
	}
	a.logger.Info("dev: advanced a user's holdback", "userId", body.UserID, "days", body.Days,
		"releaseNow", body.ReleaseNow, "shifted", shifted, "released", released, "escrowHeld", escrowHeld)
	httpx.WriteJSON(w, a.logger, http.StatusOK, advanceHoldbackResponse{
		Shifted: shifted, Released: released, EscrowHeld: escrowHeld,
	})
}
