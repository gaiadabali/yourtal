package reward

import (
	"context"
	"errors"
	"fmt"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// ErrEarnCapReached — the user has earned the daily or monthly maximum (F12).
var ErrEarnCapReached = errors.New("reward: earn cap reached")

// Caps are a region's earn caps in points (F12): per calendar day and per
// calendar month on the region's clock.
type Caps struct {
	DailyPoints   int64
	MonthlyPoints int64
}

// DefaultCaps are the F12 staging defaults. They move to the 1.2.f settings
// view (4.4.k) once it exists, so staff can change them without a deploy.
func DefaultCaps(region ledger.Region) Caps {
	daily := int64(500)
	if region == ledger.RegionID {
		daily = 5_000
	}
	return Caps{DailyPoints: daily, MonthlyPoints: 30 * daily}
}

// WithCaps replaces the engine's caps.
func (e *Engine) WithCaps(caps Caps) *Engine {
	e.caps = caps
	return e
}

// checkCaps runs inside the grant's transaction, after LockUserGrants, so
// the counts it reads cannot change before the grant is written (EM-06,
// EW-11). Every count uses the database's now(), never the caller's.
func (e *Engine) checkCaps(ctx context.Context, q *sqlcgen.Queries, req GrantRequest, def ActionDefinition) error {
	perUser, err := q.CountRecentGrantsForUser(ctx, sqlcgen.CountRecentGrantsForUserParams{
		UserID: req.UserID, ActionType: string(req.Action),
	})
	if err != nil {
		return fmt.Errorf("counting user grants: %w", err)
	}
	if perUser >= int64(def.MaxPerUserPerDay) {
		return fmt.Errorf("%w: %d of %d for %s", ErrUserCapReached, perUser, def.MaxPerUserPerDay, req.Action)
	}

	// Device and IP caps span every action: several different actions from
	// one farm defeat a per-action cap alone (docs/14 §3).
	if req.DeviceID != "" {
		count, err := q.CountRecentGrantsForDevice(ctx, &req.DeviceID)
		if err != nil {
			return fmt.Errorf("counting device grants: %w", err)
		}
		if count >= DeviceGrantsPerDay {
			return fmt.Errorf("%w: %d today", ErrDeviceCapReached, count)
		}
	}
	if req.IPAddress != "" {
		count, err := q.CountRecentGrantsForIp(ctx, &req.IPAddress)
		if err != nil {
			return fmt.Errorf("counting ip grants: %w", err)
		}
		if count >= IPGrantsPerDay {
			return fmt.Errorf("%w: %d today", ErrIPCapReached, count)
		}
	}

	for _, period := range []struct {
		name  string
		limit int64
	}{{"day", e.caps.DailyPoints}, {"month", e.caps.MonthlyPoints}} {
		earned, err := q.SumPointsEarnedThisPeriod(ctx, sqlcgen.SumPointsEarnedThisPeriodParams{
			UserID: req.UserID, Period: period.name, Tz: e.region.TimeZone(),
		})
		if err != nil {
			return fmt.Errorf("summing points earned this %s: %w", period.name, err)
		}
		if earned+def.Points > period.limit {
			return fmt.Errorf("%w: %d + %d over the %s cap of %d",
				ErrEarnCapReached, earned, def.Points, period.name, period.limit)
		}
	}
	return nil
}
