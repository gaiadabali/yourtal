package reward

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// ShiftAndReleaseUser is the dev/staging-only counterpart to ReleaseDue
// (release.go), scoped to one user — what TASKS.md 2.3.f's `/dev/clock`
// needs: a reviewer can make their own account's holdback due sooner, rather
// than only waiting for the ledger's own loop to catch up to the real clock.
//
// It does NOT write to ledger.grant.unlock_at — deliberately: yourtal_ledger
// has UPDATE revoked on that table (packages/db/migrations/
// 20260919000007_reward_engine.sql: "REVOKE UPDATE ON ledger.grant FROM
// yourtal_ledger"), grants being append-only once posted is part of the
// hardening, and widening that grant is a schema/privilege change for the
// senior-db seat, not something this dev endpoint should improvise around.
//
// It does not need to: releaseInTx (which this calls, same as ReleaseDue)
// never reads or writes unlock_at either — once a grant is released the
// row in ledger.grant_release is the durable record, and unlock_at is only
// ever used to decide ELIGIBILITY. So "shift by N days" / "release now" are
// answered as a read-side comparison instead of a write: a grant is treated
// as due now if `unlock_at <= now()` (releaseNow) or `unlock_at <= now() +
// N days` (advance days) — exactly the grants a real N-day wait, or an
// immediate unlock, would have made due — and then released for real.
//
// A held escrow keeps the user's pending points pending, exactly as
// ReleaseDue respects it (4.4.g); escrowHeld reports that back rather than
// silently doing nothing.
//
// The queries below are hand-written, parameterized pgx: sqlc's generator
// (sqlc.yaml) was not available in this worktree to add a generated one.
// docs/13a section 7 bans string-BUILT SQL (concatenation); a parameterized
// query written by hand is the same shape sqlc itself emits, not what that
// rule means to forbid.
func (e *Engine) ShiftAndReleaseUser(
	ctx context.Context, pool ledgerPool, userID string, days int32, releaseNow bool, limit int32,
) (shifted, released int, escrowHeld bool, err error) {
	if userID == "" {
		return 0, 0, false, fmt.Errorf("reward: userID is required")
	}

	type dueGrant struct {
		id     string
		points int64
	}
	var rows pgx.Rows
	if releaseNow {
		rows, err = pool.Query(ctx, `
			SELECT g.id, g.points
			FROM ledger.grant g
			LEFT JOIN ledger.grant_release r ON r.grant_id = g.id
			WHERE g.user_id = $1 AND g.unlock_at IS NOT NULL AND r.grant_id IS NULL
			ORDER BY g.unlock_at
			LIMIT $2`, userID, limit)
	} else {
		rows, err = pool.Query(ctx, `
			SELECT g.id, g.points
			FROM ledger.grant g
			LEFT JOIN ledger.grant_release r ON r.grant_id = g.id
			WHERE g.user_id = $1 AND g.unlock_at IS NOT NULL AND r.grant_id IS NULL
			  AND g.unlock_at <= now() + make_interval(days => $2)
			ORDER BY g.unlock_at
			LIMIT $3`, userID, days, limit)
	}
	if err != nil {
		return 0, 0, false, fmt.Errorf("listing %s's grants due for release: %w", userID, err)
	}
	var due []dueGrant
	for rows.Next() {
		var g dueGrant
		if scanErr := rows.Scan(&g.id, &g.points); scanErr != nil {
			rows.Close()
			return 0, 0, false, fmt.Errorf("reading a due grant for %s: %w", userID, scanErr)
		}
		due = append(due, g)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, 0, false, fmt.Errorf("listing %s's grants due for release: %w", userID, err)
	}
	shifted = len(due)

	for _, grant := range due {
		txErr := pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{IsoLevel: pgx.Serializable}, func(tx pgx.Tx) error {
			q := sqlcgen.New(tx)
			held, heldErr := q.UserHasHeldEscrow(ctx, userID)
			if heldErr != nil {
				return heldErr
			}
			if held {
				return errEscrowHeld
			}
			return e.releaseInTx(ctx, tx, q, grant.id, userID, grant.points)
		})
		switch {
		case errors.Is(txErr, errEscrowHeld):
			escrowHeld = true
		case txErr != nil:
			continue // left due; a later call retries it
		default:
			released++
		}
	}
	return shifted, released, escrowHeld, nil
}
