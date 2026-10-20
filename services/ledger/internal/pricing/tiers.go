package pricing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"regexp"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/settings"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// Point packages (F121/F122): each region sells points in tiers, a size and a
// discount off P_issue, set as the point_package_tiers region setting. The
// ledger prices every tier itself and refuses one whose price per point would
// fall below B (K6), whatever the setting says.

const (
	// TierCatalogueKey is the region setting that holds the catalogue.
	TierCatalogueKey = "point_package_tiers"
	// MaxTierDiscountBps caps a tier's discount at 50%.
	MaxTierDiscountBps = 5_000
	maxTiers           = 10
	// maxTierPoints keeps a tier's price far inside int64.
	maxTierPoints = 100_000_000
)

var (
	// ErrNoTierCatalogue — the region has no approved package tiers.
	ErrNoTierCatalogue = errors.New("pricing: no package tiers are set for this region")
	// ErrTierCatalogue — the catalogue's shape breaks a rule below.
	ErrTierCatalogue = errors.New("pricing: the package tier catalogue is not valid")
	// ErrUnknownTier — no tier has that key.
	ErrUnknownTier = errors.New("pricing: no such package tier")
	// ErrTierBelowBacking — the tier would sell a point for less than B (K6).
	ErrTierBelowBacking = errors.New("pricing: the tier would sell points below the backing rate")
	// ErrTierPointsMismatch — a purchase names a tier but a different size.
	ErrTierPointsMismatch = errors.New("pricing: the points are not the tier's size")
)

var tierKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)

// Tier is one package size and its discount off P_issue, in basis points.
type Tier struct {
	Key         string `json:"key"`
	Points      int64  `json:"points"`
	DiscountBps int64  `json:"discountBps"`
}

// TierQuote is a tier priced at the rate in force now. AmountMinor is what
// the business pays (ex-GST, F118); UndiscountedMinor is the same points at
// P_issue, so a caller can show the saving without knowing the rate.
type TierQuote struct {
	Tier
	AmountMinor       int64
	UndiscountedMinor int64
	Currency          string
	RateID            string
}

// ParseTiers reads a catalogue strictly: every field present, no others.
func ParseTiers(raw []byte) ([]Tier, error) {
	var fields []struct {
		Key         *string `json:"key"`
		Points      *int64  `json:"points"`
		DiscountBps *int64  `json:"discountBps"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&fields); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrTierCatalogue, err)
	}
	if decoder.More() {
		return nil, fmt.Errorf("%w: trailing data", ErrTierCatalogue)
	}
	tiers := make([]Tier, 0, len(fields))
	for i, f := range fields {
		if f.Key == nil || f.Points == nil || f.DiscountBps == nil {
			return nil, fmt.Errorf("%w: tier %d needs key, points and discountBps", ErrTierCatalogue, i)
		}
		tiers = append(tiers, Tier{Key: *f.Key, Points: *f.Points, DiscountBps: *f.DiscountBps})
	}
	return tiers, ValidateTiers(tiers)
}

// ValidateTiers checks the catalogue's shape; the B floor needs a rate and is
// CheckTierFloor's.
func ValidateTiers(tiers []Tier) error {
	if len(tiers) == 0 || len(tiers) > maxTiers {
		return fmt.Errorf("%w: %d tiers, want 1 to %d", ErrTierCatalogue, len(tiers), maxTiers)
	}
	seen := make(map[string]bool, len(tiers))
	for _, tier := range tiers {
		switch {
		case !tierKeyPattern.MatchString(tier.Key):
			return fmt.Errorf("%w: key %q is not a lower-case identifier", ErrTierCatalogue, tier.Key)
		case seen[tier.Key]:
			return fmt.Errorf("%w: key %q appears twice", ErrTierCatalogue, tier.Key)
		case tier.Points <= 0 || tier.Points > maxTierPoints || tier.Points%PackPoints != 0:
			return fmt.Errorf("%w: %s is %d points, not a positive multiple of %d",
				ErrTierCatalogue, tier.Key, tier.Points, PackPoints)
		case tier.DiscountBps < 0 || tier.DiscountBps > MaxTierDiscountBps:
			return fmt.Errorf("%w: %s's discount of %d bps is outside 0..%d",
				ErrTierCatalogue, tier.Key, tier.DiscountBps, MaxTierDiscountBps)
		}
		seen[tier.Key] = true
	}
	return nil
}

// CheckTierFloor is K6 for a tier: P_issue × (1 − discount) ≥ B, compared
// exactly as P_issue × (10,000 − bps) ≥ B × 10,000.
func CheckTierFloor(tier Tier, issueMicrosPerPoint, backingMicrosPerPoint int64) error {
	price := new(big.Int).Mul(big.NewInt(issueMicrosPerPoint), big.NewInt(bpsScale-tier.DiscountBps))
	floor := new(big.Int).Mul(big.NewInt(backingMicrosPerPoint), big.NewInt(bpsScale))
	if price.Cmp(floor) < 0 {
		return fmt.Errorf("%w: %s at %d bps off", ErrTierBelowBacking, tier.Key, tier.DiscountBps)
	}
	return nil
}

// TierAmountMinor is ceil(points × P_issue × (10,000 − bps) ÷ (1e6 × 10,000)):
// rounded up, like every purchase quote, so a tier never undercharges.
func TierAmountMinor(points, issueMicrosPerPoint, discountBps int64) (int64, error) {
	amount := new(big.Int).Mul(big.NewInt(points), big.NewInt(issueMicrosPerPoint))
	amount.Mul(amount, big.NewInt(bpsScale-discountBps))
	scale := big.NewInt(MicrosPerMinorUnit * bpsScale)
	amount.Add(amount, new(big.Int).Sub(scale, big.NewInt(1)))
	amount.Quo(amount, scale)
	if !amount.IsInt64() {
		return 0, fmt.Errorf("%w: %d points", ErrPriceOutOfRange, points)
	}
	return amount.Int64(), nil
}

// readTiersIn reads the region's approved catalogue on the caller's pool or
// transaction. A stored catalogue that fails validation is refused, never
// partly used.
func readTiersIn(ctx context.Context, db settings.Querier, region ledger.Region) ([]Tier, error) {
	raw, err := settings.GetIn(ctx, db, string(region), TierCatalogueKey)
	if err != nil {
		return nil, err
	}
	if raw == nil {
		return nil, fmt.Errorf("%w: %s", ErrNoTierCatalogue, region)
	}
	return ParseTiers(raw)
}

// quoteTier prices one tier at a rate, after the B floor.
func quoteTier(tier Tier, rate sqlcgen.GetBackingRateInForceRow) (TierQuote, error) {
	if err := CheckTierFloor(tier, rate.IssuePriceMicrosPerPoint, rate.MicrosPerPoint); err != nil {
		return TierQuote{}, err
	}
	amount, err := TierAmountMinor(tier.Points, rate.IssuePriceMicrosPerPoint, tier.DiscountBps)
	if err != nil {
		return TierQuote{}, err
	}
	undiscounted, err := priceAtIssueRate(tier.Points, rate.IssuePriceMicrosPerPoint)
	if err != nil {
		return TierQuote{}, err
	}
	return TierQuote{Tier: tier, AmountMinor: amount, UndiscountedMinor: undiscounted,
		Currency: rate.Currency, RateID: rate.ID}, nil
}

// QuoteTierIn prices the named tier inside the caller's transaction: the
// catalogue and the rate are both read there, at the database's now().
func QuoteTierIn(ctx context.Context, q *sqlcgen.Queries, db settings.Querier, region ledger.Region, key string) (TierQuote, error) {
	tiers, err := readTiersIn(ctx, db, region)
	if err != nil {
		return TierQuote{}, err
	}
	rate, err := rateInForce(ctx, q, string(region.Currency()))
	if err != nil {
		return TierQuote{}, err
	}
	for _, tier := range tiers {
		if tier.Key == key {
			return quoteTier(tier, rate)
		}
	}
	return TierQuote{}, fmt.Errorf("%w: %q in %s", ErrUnknownTier, key, region)
}

// QuoteTier is QuoteTierIn on the engine's pool.
func (e *Engine) QuoteTier(ctx context.Context, region ledger.Region, key string) (TierQuote, error) {
	return QuoteTierIn(ctx, sqlcgen.New(e.pool), e.pool, region, key)
}

// PackageTiers prices every tier on sale now, smallest first as stored. A
// tier under the B floor is left out rather than sold; the rest still sell.
func (e *Engine) PackageTiers(ctx context.Context, region ledger.Region) ([]TierQuote, error) {
	tiers, err := readTiersIn(ctx, e.pool, region)
	if err != nil {
		return nil, err
	}
	rate, err := rateInForce(ctx, sqlcgen.New(e.pool), string(region.Currency()))
	if err != nil {
		return nil, err
	}
	quotes := make([]TierQuote, 0, len(tiers))
	for _, tier := range tiers {
		quote, err := quoteTier(tier, rate)
		if errors.Is(err, ErrTierBelowBacking) {
			continue
		}
		if err != nil {
			return nil, err
		}
		quotes = append(quotes, quote)
	}
	return quotes, nil
}

// CheckTiers is what staff's propose and approve ask before a catalogue is
// stored or put in force: its shape, and every tier above B at the rate in
// force now. B itself never leaves the ledger; only the refusal does.
func (e *Engine) CheckTiers(ctx context.Context, region ledger.Region, raw []byte) error {
	tiers, err := ParseTiers(raw)
	if err != nil {
		return err
	}
	rate, err := rateInForce(ctx, sqlcgen.New(e.pool), string(region.Currency()))
	if err != nil {
		return err
	}
	for _, tier := range tiers {
		if err := CheckTierFloor(tier, rate.IssuePriceMicrosPerPoint, rate.MicrosPerPoint); err != nil {
			return err
		}
	}
	return nil
}
