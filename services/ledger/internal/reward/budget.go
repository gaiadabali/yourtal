package reward

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// A campaign's total budget and daily cap (14.2), in points. The total is
// reward_config.max_points_for_campaign; the cap is daily_cap_points, a day
// on the region's clock (F16).
//
// Both are admitted under the campaign's lock, in the same transaction as the
// hold or grant they admit. A live session hold counts as spent, in all and
// today, so a viewer who was admitted at session start is paid at the end:
// with granted + live holds kept within the cap at every admission, a grant
// that consumes its own hold always fits.

// ErrCampaignDailyCap — the campaign has given out its cap for today.
var ErrCampaignDailyCap = errors.New("reward: the campaign's daily cap is reached for today")

// CampaignBudget is how much a campaign can still pay.
type CampaignBudget struct {
	CampaignID      string
	RemainingPoints int64
	// RemainingTodayPoints is nil when the campaign has no daily cap.
	RemainingTodayPoints *int64
}

func budgetOf(row sqlcgen.CampaignBudgetUseRow) CampaignBudget {
	budget := CampaignBudget{
		CampaignID:      uuidText(row.CampaignID),
		RemainingPoints: max(0, row.MaxPointsForCampaign-row.GrantedPoints-row.HeldPoints),
	}
	if row.DailyCapPoints != nil {
		today := max(0, *row.DailyCapPoints-row.GrantedTodayPoints-row.HeldPoints)
		budget.RemainingTodayPoints = &today
	}
	return budget
}

// checkCampaignBudget admits points against the campaign's budget and
// today's cap. ownHold is left out of the live holds: it is the reservation
// the caller is about to consume.
func (e *Engine) checkCampaignBudget(ctx context.Context, q *sqlcgen.Queries, campaignID, ownHold string, points int64) error {
	if err := q.LockCampaignGrants(ctx, campaignID); err != nil {
		return fmt.Errorf("locking the campaign's grants: %w", err)
	}
	rows, err := q.CampaignBudgetUse(ctx, sqlcgen.CampaignBudgetUseParams{
		Tz: e.region.TimeZone(), ExcludeHoldID: ownHold,
		CampaignIds: []pgtype.UUID{optionalUUID(campaignID)}, Region: string(e.region),
	})
	if err != nil {
		return fmt.Errorf("reading the campaign's spend: %w", err)
	}
	if len(rows) == 0 {
		return fmt.Errorf("%w: campaign %s has no reward config in %s", ErrWrongFunder, campaignID, e.region)
	}
	budget := budgetOf(rows[0])
	if points > budget.RemainingPoints {
		return fmt.Errorf("%w: %d more would pass the budget of %d (%d left)",
			ErrOverCampaignMax, points, rows[0].MaxPointsForCampaign, budget.RemainingPoints)
	}
	if budget.RemainingTodayPoints != nil && points > *budget.RemainingTodayPoints {
		return fmt.Errorf("%w: %d more would pass today's cap of %d (%d left)",
			ErrCampaignDailyCap, points, *rows[0].DailyCapPoints, *budget.RemainingTodayPoints)
	}
	return nil
}

// lockCampaignSession takes the campaign's lock on the connection before a
// transaction begins, so the transaction's snapshot already includes the
// previous hold or grant (see Engine.issue's note on the user lock). The
// returned func releases it.
func lockCampaignSession(ctx context.Context, session *sqlcgen.Queries, campaignID string) (func(), error) {
	if err := session.LockCampaignGrantsSession(ctx, campaignID); err != nil {
		return nil, fmt.Errorf("locking the campaign's grants: %w", err)
	}
	return func() { _ = session.UnlockCampaignGrantsSession(context.WithoutCancel(ctx), campaignID) }, nil
}

// HoldForCampaign is Hold for a campaign's reward session: in one transaction
// under the campaign's lock it checks the budget and today's cap, holds the
// points on the campaign's allocation, and records which campaign the hold
// reserves. Refused with ErrOverCampaignMax or ErrCampaignDailyCap, so the
// session starts non-earning with that reason rather than failing at the end.
// A replay of the same hold id is admitted without counting itself twice.
func (e *Engine) HoldForCampaign(ctx context.Context, req HoldRequest, campaignID string) error {
	conn, err := e.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquiring a connection: %w", err)
	}
	defer conn.Release()
	unlock, err := lockCampaignSession(ctx, sqlcgen.New(conn), campaignID)
	if err != nil {
		return err
	}
	defer unlock()

	return ledger.WithSerializableRetry(ctx, conn, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		config, err := q.GetRewardConfig(ctx, optionalUUID(campaignID))
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: campaign %s has no reward config", ErrWrongFunder, campaignID)
		}
		if err != nil {
			return fmt.Errorf("reading the reward config: %w", err)
		}
		if config.AllocationID != req.AllocationID {
			return fmt.Errorf("%w: campaign %s is paid from %s, not %s",
				ErrWrongFunder, campaignID, config.AllocationID, req.AllocationID)
		}
		if err := e.checkCampaignBudget(ctx, q, campaignID, req.ID, req.Points); err != nil {
			return err
		}
		held, err := q.HoldAllocation(ctx, sqlcgen.HoldAllocationParams{
			HoldID: req.ID, AllocationID: req.AllocationID, Points: req.Points,
			TtlSeconds: int64(req.TTL / time.Second),
		})
		if err != nil {
			return fmt.Errorf("holding %d points on %s: %w", req.Points, req.AllocationID, err)
		}
		if !held {
			return fmt.Errorf("%w: %s cannot hold %d points", ErrAllocationExhausted, req.AllocationID, req.Points)
		}
		return q.InsertCampaignHold(ctx, sqlcgen.InsertCampaignHoldParams{
			HoldID: req.ID, CampaignID: optionalUUID(campaignID),
		})
	})
}

// CampaignBudgets is what each of this region's campaigns can still pay; a
// campaign with no reward config, or in the other region, is left out. The
// feed reads it to stop offering a campaign that could not pay a session.
func (e *Engine) CampaignBudgets(ctx context.Context, campaignIDs []string) ([]CampaignBudget, error) {
	ids := make([]pgtype.UUID, 0, len(campaignIDs))
	for _, id := range campaignIDs {
		if parsed := optionalUUID(id); parsed.Valid {
			ids = append(ids, parsed)
		}
	}
	rows, err := sqlcgen.New(e.pool).CampaignBudgetUse(ctx, sqlcgen.CampaignBudgetUseParams{
		Tz: e.region.TimeZone(), ExcludeHoldID: "", CampaignIds: ids, Region: string(e.region),
	})
	if err != nil {
		return nil, fmt.Errorf("reading campaign budgets: %w", err)
	}
	budgets := make([]CampaignBudget, 0, len(rows))
	for _, row := range rows {
		budgets = append(budgets, budgetOf(row))
	}
	return budgets, nil
}
