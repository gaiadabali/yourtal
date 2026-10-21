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
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

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
	return GetIn(ctx, r.pool, region, key)
}

// Querier is a pool or a transaction.
type Querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// GetIn is Get on the caller's pool or transaction, so a purchase reads the
// setting it prices by inside its own Serializable transaction.
func GetIn(ctx context.Context, db Querier, region, key string) (json.RawMessage, error) {
	var value json.RawMessage
	err := db.QueryRow(
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

// Receipt funders (F127, docs/27 §3.1): `receipt_funder.<partnerId>` names,
// per region, the business that pays that partner's receipt points, as
// {"businessId":"<lowercase uuid>"}. Staff propose and approve it under the
// two-person rule; the view returns only approved rows in force.

// ReceiptFunderPrefix is the setting key's prefix; the partner id follows.
const ReceiptFunderPrefix = "receipt_funder."

// ErrReceiptFunderValue — a stored funder setting is not the documented shape.
var ErrReceiptFunderValue = errors.New("settings: a receipt_funder value is not {\"businessId\":\"<lowercase uuid>\"}")

var lowercaseUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// ParseReceiptFunder reads a funder setting strictly: businessId present, a
// lowercase uuid, and nothing else.
func ParseReceiptFunder(raw []byte) (string, error) {
	var value struct {
		BusinessID *string `json:"businessId"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return "", fmt.Errorf("%w: %v", ErrReceiptFunderValue, err)
	}
	if decoder.More() {
		return "", fmt.Errorf("%w: trailing data", ErrReceiptFunderValue)
	}
	if value.BusinessID == nil || !lowercaseUUID.MatchString(*value.BusinessID) {
		return "", ErrReceiptFunderValue
	}
	return *value.BusinessID, nil
}

// Lister is a pool or a transaction that can also return rows.
type Lister interface {
	Querier
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// IsReceiptFunderIn returns the partners whose receipts businessID funds in
// region, sorted; none means it is not a receipt funder there. A malformed
// setting names no business, so it never makes one a funder.
func IsReceiptFunderIn(ctx context.Context, db Lister, region, businessID string) ([]string, error) {
	rows, err := db.Query(ctx,
		`SELECT key, value FROM platform.ledger_setting
		  WHERE region = $1 AND starts_with(key, $2) ORDER BY key`,
		region, ReceiptFunderPrefix)
	if err != nil {
		return nil, fmt.Errorf("settings: reading %s receipt funders: %w", region, err)
	}
	defer rows.Close()
	var partners []string
	for rows.Next() {
		var key string
		var value json.RawMessage
		if err := rows.Scan(&key, &value); err != nil {
			return nil, fmt.Errorf("settings: reading %s receipt funders: %w", region, err)
		}
		if funder, err := ParseReceiptFunder(value); err == nil && funder == businessID {
			partners = append(partners, strings.TrimPrefix(key, ReceiptFunderPrefix))
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("settings: reading %s receipt funders: %w", region, err)
	}
	return partners, nil
}

// ReceiptFunderFor is the business that funds partnerID's receipts in
// region. ok is false when no approved setting names one; a malformed one is
// ErrReceiptFunderValue, so a bad setting is loud rather than a silent pause.
func ReceiptFunderFor(ctx context.Context, db Querier, region, partnerID string) (businessID string, ok bool, err error) {
	raw, err := GetIn(ctx, db, region, ReceiptFunderPrefix+partnerID)
	if err != nil || raw == nil {
		return "", false, err
	}
	businessID, err = ParseReceiptFunder(raw)
	if err != nil {
		return "", false, fmt.Errorf("%s %s%s: %w", region, ReceiptFunderPrefix, partnerID, err)
	}
	return businessID, true, nil
}
