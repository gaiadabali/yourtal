package settings_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/settings"
	"github.com/yourtal/services/ledger/internal/testdb"
)

// Against real Postgres, migrated by `pnpm --filter @yourtal/ledger-service
// test` (with-test-db.mjs) before this runs -- 20260925193000's F12 seed is
// on this branch, so `daily_earn_cap` for AU is 500 here for the same reason
// 1.2.g's Check names it for apps/api's reader.
func TestReaderReadsSeededSettingsThroughTheView(t *testing.T) {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testdb.URL(t, "LEDGER_DATABASE_URL"))
	if err != nil {
		t.Fatalf("pgxpool.New: %v", err)
	}
	defer pool.Close()

	reader := settings.New(pool)

	value, err := reader.Get(ctx, "AU", "daily_earn_cap")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got := string(value); got != "500" {
		t.Errorf("AU daily_earn_cap = %s, want 500", got)
	}

	// AU and ID are separate economies (F2) -- the same key means a
	// different number per region.
	idValue, err := reader.Get(ctx, "ID", "daily_earn_cap")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got := string(idValue); got != "5000" {
		t.Errorf("ID daily_earn_cap = %s, want 5000", got)
	}

	// The view is scoped to the ledger's own keys (least privilege) -- a key
	// that exists in platform.region_setting but is not one of them, or
	// does not exist at all, both read as "nothing", not an error.
	missing, err := reader.Get(ctx, "AU", "not_a_real_setting")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if missing != nil {
		t.Errorf("Get(not_a_real_setting) = %s, want nil", missing)
	}
}
