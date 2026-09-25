package reward

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/yourtal/services/ledger/internal/settings"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

var (
	// ErrEarnCapReached — the user has earned the daily or monthly maximum (F12).
	ErrEarnCapReached = errors.New("reward: earn cap reached")
	// ErrCapsNotConfigured — no approved earn cap for the region. Refused
	// rather than defaulted: an economy number is a setting, never a constant.
	ErrCapsNotConfigured = errors.New("reward: earn caps are not configured for this region")
)

// Caps are a region's earn caps in points (F12): per calendar day and per
// calendar month on the region's clock.
type Caps struct {
	DailyPoints   int64
	MonthlyPoints int64
}

// Caps reads the region's approved earn caps from platform.ledger_setting
// (1.2.f), so staff change them without a deploy (4.4.k).
func (e *Engine) Caps(ctx context.Context) (Caps, error) {
	if e.capsOverride != nil {
		return *e.capsOverride, nil
	}
	reader := settings.New(e.pool)
	var caps Caps
	for key, dst := range map[string]*int64{"daily_earn_cap": &caps.DailyPoints, "monthly_earn_cap": &caps.MonthlyPoints} {
		raw, err := reader.Get(ctx, string(e.region), key)
		if err != nil {
			return Caps{}, err
		}
		if raw == nil {
			return Caps{}, fmt.Errorf("%w: %s %s", ErrCapsNotConfigured, e.region, key)
		}
		if err := json.Unmarshal(raw, dst); err != nil {
			return Caps{}, fmt.Errorf("%w: %s %s is %s", ErrCapsNotConfigured, e.region, key, raw)
		}
	}
	return caps, nil
}

// WithCaps fixes the engine's caps instead of reading them. Tests only.
func (e *Engine) WithCaps(caps Caps) *Engine {
	e.capsOverride = &caps
	return e
}

// checkCaps runs inside the grant's transaction, after LockUserGrants, so
// the counts it reads cannot change before the grant is written (EM-06,
// EW-11). Every count uses the database's now(), never the caller's.
func (e *Engine) checkCaps(ctx context.Context, q *sqlcgen.Queries, req GrantRequest, def ActionDefinition, caps Caps) error {
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
	}{{"day", caps.DailyPoints}, {"month", caps.MonthlyPoints}} {
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
