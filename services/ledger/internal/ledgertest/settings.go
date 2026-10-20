package ledgertest

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/testdb"
)

// F122Tiers is the seeded package catalogue, the same in both regions.
const F122Tiers = `[{"key": "starter", "points": 1000, "discountBps": 0},
	{"key": "grow", "points": 10000, "discountBps": 500},
	{"key": "scale", "points": 50000, "discountBps": 1000}]`

// SetRegionSetting proposes and approves a region setting as two people, on
// the owner's connection: platform.region_setting is apps/api's table, and
// the ledger's own role can only read it.
func SetRegionSetting(t *testing.T, region, key, value string) {
	t.Helper()
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, testdb.URL(t, "DATABASE_OWNER_URL"))
	if err != nil {
		t.Fatalf("connect as owner: %v", err)
	}
	defer owner.Close()
	var id string
	if err := owner.QueryRow(ctx,
		`INSERT INTO platform.region_setting (region, key, value, set_by)
		   VALUES ($1, $2, $3::jsonb, $4) RETURNING id`,
		region, key, value, unique("proposer")).Scan(&id); err != nil {
		t.Fatalf("proposing %s: %v", key, err)
	}
	if _, err := owner.Exec(ctx,
		`UPDATE platform.region_setting SET approved_by = $2 WHERE id = $1`, id, unique("approver")); err != nil {
		t.Fatalf("approving %s: %v", key, err)
	}
}

// WithTiers puts a package catalogue in force for one test and restores
// F122's when it ends, so later tests price the seeded tiers.
func WithTiers(t *testing.T, region, tiers string) {
	t.Helper()
	SetRegionSetting(t, region, "point_package_tiers", tiers)
	t.Cleanup(func() { SetRegionSetting(t, region, "point_package_tiers", F122Tiers) })
}
