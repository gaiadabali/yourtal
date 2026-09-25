// Package settings is the ledger's read side of 1.2.f's per-region economy
// settings (F12/F23): caps, holdback, coverage thresholds and marketing
// limits, set by staff through a two-person propose/approve flow that lives
// entirely outside this service.
//
// # Why a view, not the table
//
// `yourtal_ledger` is granted SELECT on `platform.ledger_setting`
// (packages/db/migrations/20260925193000_platform_region_setting.sql), a
// view over `platform.region_setting` scoped to the keys this engine
// actually needs -- the same least-privilege shape
// 20260922020000_ledger_reads_campaign_reward_config.sql uses for
// `campaign.reward_config`: one narrow read, not schema-wide access to a
// table this service must never propose or approve a change through.
//
// # No caching here, on purpose
//
// apps/api's reader caches for up to 60s (1.2.f) because a settings read
// sits on its request hot path. This package does not: every ledger write
// that consults a cap or a threshold already runs inside a Serializable
// transaction (see internal/ledger's header), so a read here is one more
// query on a path that is already paying for correctness over speed. A
// cache would also mean two services disagreeing about a just-approved
// change for up to two different TTLs, which is a harder bug to explain
// than one more SELECT.
package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Reader reads platform.ledger_setting for one region at a time.
type Reader struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Reader {
	return &Reader{pool: pool}
}

// Get returns the raw JSON value for key in region, or (nil, nil) if no such
// setting is currently effective and approved. The caller unmarshals into
// whatever shape that key is documented to hold (packages/db/migrations
// 20260925193000's seed comments) -- this package does not know, or need to
// know, what any individual key means.
func (r *Reader) Get(ctx context.Context, region, key string) (json.RawMessage, error) {
	var value json.RawMessage
	err := r.pool.QueryRow(
		ctx,
		`SELECT value FROM platform.ledger_setting WHERE region = $1 AND key = $2`,
		region, key,
	).Scan(&value)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("settings: reading %s/%s: %w", region, key, err)
	}
	return value, nil
}
