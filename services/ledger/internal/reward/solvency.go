package reward

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/settings"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// ErrSolvencyBlocked — coverage is too low for points nobody has paid for
// (4.9.c, EM-10). Partner-funded grants still pay: their cash is in.
var ErrSolvencyBlocked = errors.New("reward: coverage is too low for marketing-funded points")

// checkSolvency refuses a marketing-funded grant while the region's coverage
// is below its pause threshold (F12: 1.1), and in any case below 1.0. It is
// measured inside the grant's transaction, so it sees the state it guards.
func (e *Engine) checkSolvency(ctx context.Context, q *sqlcgen.Queries) error {
	thresholdBps := int64(pricing.CoverageFloorBps)
	raw, err := settings.New(e.pool).Get(ctx, string(e.region), "streak_coverage_pause_threshold")
	if err != nil {
		return err
	}
	if raw != nil {
		ratio, ok := new(big.Rat).SetString(string(raw))
		if !ok {
			return fmt.Errorf("reward: streak_coverage_pause_threshold is %s, not a number", raw)
		}
		bps := new(big.Rat).Mul(ratio, big.NewRat(10_000, 1))
		if !bps.IsInt() {
			return fmt.Errorf("reward: streak_coverage_pause_threshold %s is finer than a basis point", raw)
		}
		if b := bps.Num().Int64(); b > thresholdBps {
			thresholdBps = b
		}
	}

	coverage, err := pricing.CoverageNow(ctx, q, e.region)
	if err != nil {
		return err
	}
	if !coverage.NoPointsOutstanding && coverage.RatioBps < thresholdBps {
		return fmt.Errorf("%w: %s coverage is %d bps, below %d", ErrSolvencyBlocked, e.region, coverage.RatioBps, thresholdBps)
	}
	return nil
}
