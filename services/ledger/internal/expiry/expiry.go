// Package expiry is TASKS.md 10.2: points expiry (F2), off by default per
// region. It reads the region's own `points_expiry` setting
// (`platform.region_setting`, seeded `{"enabled": false, "inactivityMonths":
// 12}`) and does nothing at all while it is off — the whole point of this
// package existing separately from reward.Engine is that a caller can wire
// it in, run it on a schedule, and it is STILL inert until a human turns it
// on for a region.
package expiry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/settings"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// Setting is platform.region_setting's own `points_expiry` shape (1.2.f).
type Setting struct {
	Enabled          bool `json:"enabled"`
	InactivityMonths int  `json:"inactivityMonths"`
}

// ReadSetting is exported so a caller (the worker job, a test) can decide
// whether it is even worth calling Run.
func ReadSetting(ctx context.Context, pool *pgxpool.Pool, region ledger.Region) (Setting, error) {
	raw, err := settings.New(pool).Get(ctx, string(region), "points_expiry")
	if err != nil {
		return Setting{}, fmt.Errorf("expiry: reading the %s points_expiry setting: %w", region, err)
	}
	if raw == nil {
		return Setting{}, nil // absent reads as off, same as every other F12 setting's "nothing configured yet"
	}
	var setting Setting
	if err := json.Unmarshal(raw, &setting); err != nil {
		return Setting{}, fmt.Errorf("expiry: %s points_expiry is %s: %w", region, raw, err)
	}
	return setting, nil
}

// Result is one call's own tally, for the worker job's log line.
type Result struct {
	Considered    int
	Expired       int
	SkippedEscrow int
	PointsExpired int64
	// Notices is how many NEW 30/7-day points_expiring warnings this run
	// wrote (10.2.d) — not how many total exist, and not how many
	// apps/worker has since announced.
	Notices int
}

// Run sweeps one region's inactive accounts. Off entirely unless the
// region's points_expiry setting says enabled=true (F2's own default).
func Run(ctx context.Context, pool *pgxpool.Pool, book *ledger.Ledger, region ledger.Region, limit int32) (Result, error) {
	setting, err := ReadSetting(ctx, pool, region)
	if err != nil {
		return Result{}, err
	}
	if !setting.Enabled {
		return Result{}, nil
	}
	months := setting.InactivityMonths
	if months <= 0 {
		months = 12 // the seeded default (1.2.f); a config typo should not mean "expire everything"
	}
	cutoff := time.Now().AddDate(0, -months, 0)

	q := sqlcgen.New(pool)
	candidates, err := q.ListInactiveUserAccounts(ctx, sqlcgen.ListInactiveUserAccountsParams{
		Region: string(region), Cutoff: pgtype.Timestamptz{Time: cutoff, Valid: true}, LimitCount: limit,
	})
	if err != nil {
		return Result{}, fmt.Errorf("expiry: listing inactive accounts: %w", err)
	}

	var result Result
	for _, candidate := range candidates {
		result.Considered++
		expired, points, err := expireOne(ctx, pool, book, region, candidate, cutoff)
		switch {
		case errors.Is(err, errSkippedEscrow):
			result.SkippedEscrow++
		case err != nil:
			return result, fmt.Errorf("expiry: account %s: %w", candidate.ID, err)
		case expired:
			result.Expired++
			result.PointsExpired += points
		}
	}

	for _, milestone := range []int32{30, 7} {
		notified, err := noticeApproaching(ctx, q, region, cutoff, months, milestone, limit)
		if err != nil {
			return result, err
		}
		result.Notices += notified
	}
	return result, nil
}

// noticeApproaching writes one ledger.points_expiry_notice row per account
// entering the milestone window (10.2.d), ON CONFLICT DO NOTHING so a
// re-discovered candidate on the next tick is not a second notice for the
// same (account, milestone, expiring_at).
func noticeApproaching(
	ctx context.Context, q *sqlcgen.Queries, region ledger.Region, cutoff time.Time, months int, milestoneDays, limit int32,
) (int, error) {
	candidates, err := q.ListAccountsApproachingExpiry(ctx, sqlcgen.ListAccountsApproachingExpiryParams{
		Region: string(region), Cutoff: pgtype.Timestamptz{Time: cutoff, Valid: true},
		LeadDays: milestoneDays, LimitCount: limit,
	})
	if err != nil {
		return 0, fmt.Errorf("expiry: listing accounts approaching a %d-day notice: %w", milestoneDays, err)
	}
	notified := 0
	for _, candidate := range candidates {
		// The date this account will actually expire on, if nothing about
		// it changes: its own last_activity_at plus the region's inactivity
		// window — the same arithmetic Run() uses to compute cutoff, just
		// forwards from the account's own clock instead of from now().
		expiringAt := candidate.LastActivityAt.Time.AddDate(0, months, 0)
		_, err := q.InsertPointsExpiryNotice(ctx, sqlcgen.InsertPointsExpiryNoticeParams{
			AccountID: candidate.ID, MilestoneDays: milestoneDays,
			ExpiringAt: pgtype.Timestamptz{Time: expiringAt, Valid: true},
		})
		switch {
		case err == nil:
			notified++
		case errors.Is(err, pgx.ErrNoRows):
			// ON CONFLICT DO NOTHING: this (account, milestone, expiring_at)
			// was already noticed on an earlier tick.
		default:
			return notified, fmt.Errorf("expiry: recording a %d-day notice for %s: %w", milestoneDays, candidate.ID, err)
		}
	}
	return notified, nil
}

var errSkippedEscrow = errors.New("expiry: the account's escrow is held")

// expireOne posts one account's breakage in its own Serializable
// transaction, under the same per-account advisory lock the reward engine
// takes before touching a balance — so a grant landing at the same instant
// cannot race this into expiring points that just became active again.
func expireOne(
	ctx context.Context, pool *pgxpool.Pool, book *ledger.Ledger, region ledger.Region,
	candidate sqlcgen.ListInactiveUserAccountsRow, cutoff time.Time,
) (expired bool, points int64, err error) {
	err = ledger.WithSerializableRetry(ctx, pool, func(tx pgx.Tx) error {
		q := sqlcgen.New(tx)
		if err := q.LockAccount(ctx, candidate.ID); err != nil {
			return fmt.Errorf("locking %s: %w", candidate.ID, err)
		}

		held, err := q.UserHasHeldEscrow(ctx, candidate.UserID)
		if err != nil {
			return fmt.Errorf("checking escrow: %w", err)
		}
		if held {
			return errSkippedEscrow
		}

		activity, err := q.GetAccountActivity(ctx, candidate.ID)
		if err != nil {
			return fmt.Errorf("re-reading activity: %w", err)
		}
		if !activity.Time.Before(cutoff) {
			return nil // a grant landed since this was listed; no longer due
		}

		balance, err := q.GetAccountBalance(ctx, candidate.ID)
		if err != nil {
			return fmt.Errorf("reading balance: %w", err)
		}
		if balance <= 0 {
			return nil // nothing to expire
		}

		// 10.2.a's own key: idempotent per (account, the exact last_activity_at
		// this run saw) — a retried tick or a re-run against the same
		// snapshot cannot double-post, and a later cycle (a fresh
		// last_activity_at, because the account woke up and went quiet
		// again) is legitimately a new breakage event.
		idempotencyKey := fmt.Sprintf("expire_%s_%s", candidate.ID, activity.Time.UTC().Format(time.RFC3339Nano))
		if _, err := book.TransferInTx(ctx, tx, ledger.TransferRequest{
			ID:             "led_txn_" + idempotencyKey,
			IdempotencyKey: idempotencyKey,
			ReasonCode:     "expire_points",
			Entries:        ledger.ExpirePoints(region, candidate.UserID, balance),
		}); err != nil {
			return fmt.Errorf("posting breakage: %w", err)
		}

		expired, points = true, balance
		return nil
	})
	if errors.Is(err, errSkippedEscrow) {
		return false, 0, errSkippedEscrow
	}
	return expired, points, err
}
