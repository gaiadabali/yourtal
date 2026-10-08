package expiry

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
)

// Regions is every region the sweep visits. AU and ID are separate
// economies, so each is read and swept on its own setting.
var Regions = []ledger.Region{ledger.RegionAU, ledger.RegionID}

// SweepRegions runs `run` for each region whose points_expiry is enabled
// and skips the rest, so a region nobody has switched on (F2, the default)
// is never touched. One region failing does not stop the other; the errors
// come back joined. `run` must be idempotent, as Run is: a retried or
// overlapping tick cannot post a second breakage.
func SweepRegions(
	ctx context.Context,
	enabled func(context.Context, ledger.Region) (bool, error),
	run func(context.Context, ledger.Region) (Result, error),
) (map[ledger.Region]Result, error) {
	results := make(map[ledger.Region]Result, len(Regions))
	var errs []error
	for _, region := range Regions {
		on, err := enabled(ctx, region)
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", region, err))
			continue
		}
		if !on {
			continue
		}
		result, err := run(ctx, region)
		results[region] = result
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", region, err))
		}
	}
	return results, errors.Join(errs...)
}

// Sweep is SweepRegions wired to the real setting and the real sweep. It is
// what the ledger's scheduler calls on every tick.
func Sweep(ctx context.Context, pool *pgxpool.Pool, book *ledger.Ledger, limit int32) (map[ledger.Region]Result, error) {
	return SweepRegions(ctx,
		func(ctx context.Context, region ledger.Region) (bool, error) {
			setting, err := ReadSetting(ctx, pool, region)
			return setting.Enabled, err
		},
		func(ctx context.Context, region ledger.Region) (Result, error) {
			return Run(ctx, pool, book, region, limit)
		},
	)
}
