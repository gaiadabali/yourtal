package pricing

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// Stored quotes and the ledger-owned listing price (4.1.b, 4.9.a). A quote
// is priced at the database's now() only, never at a caller's instant
// (EM-19), and lives 15 minutes; locking it holds that price for checkout.

var (
	// ErrQuoteExpired — the quote's 15 minutes have passed.
	ErrQuoteExpired = errors.New("pricing: the quote has expired")
	// ErrQuoteNotFound — no such quote.
	ErrQuoteNotFound = errors.New("pricing: no such quote")
	// ErrRegionMismatch — a listing repriced into the other region.
	ErrRegionMismatch = errors.New("pricing: region mismatch")
	// ErrCurrencyMismatch — a currency that is not the region's.
	ErrCurrencyMismatch = errors.New("pricing: currency is not the region's")
)

// StoredQuote is a quote as the contract returns it.
type StoredQuote struct {
	ID              string
	Region          ledger.Region
	Currency        string
	SettlementMinor int64
	PricePoints     int64
	BackingRateID   string
	ExpiresAt       time.Time
	Locked          bool
}

// NewQuote prices S in the region's currency at the rate in force now and
// stores the quote.
func (e *Engine) NewQuote(ctx context.Context, region ledger.Region, currency string, settlementMinor int64) (StoredQuote, error) {
	if currency != string(region.Currency()) {
		return StoredQuote{}, fmt.Errorf("%w: %s in %s", ErrCurrencyMismatch, currency, region)
	}
	q := sqlcgen.New(e.pool)
	points, rateID, err := priceNow(ctx, q, currency, settlementMinor)
	if err != nil {
		return StoredQuote{}, err
	}
	row, err := q.InsertQuote(ctx, sqlcgen.InsertQuoteParams{
		ID: newUUID(), Region: string(region), Currency: currency,
		SettlementMinor: settlementMinor, PricePoints: points, BackingRateID: rateID,
	})
	if err != nil {
		return StoredQuote{}, fmt.Errorf("storing the quote: %w", err)
	}
	return StoredQuote{ID: uuidString(row.ID), Region: region, Currency: currency, SettlementMinor: settlementMinor,
		PricePoints: points, BackingRateID: rateID, ExpiresAt: row.ExpiresAt.Time}, nil
}

// LockQuote holds a live quote's price for checkout; an expired one is refused.
func (e *Engine) LockQuote(ctx context.Context, quoteID string) (StoredQuote, error) {
	q := sqlcgen.New(e.pool)
	row, err := q.GetQuote(ctx, parseUUID(quoteID))
	if errors.Is(err, pgx.ErrNoRows) {
		return StoredQuote{}, fmt.Errorf("%w: %s", ErrQuoteNotFound, quoteID)
	}
	if err != nil {
		return StoredQuote{}, fmt.Errorf("reading the quote: %w", err)
	}
	if row.Expired {
		return StoredQuote{}, fmt.Errorf("%w: %s", ErrQuoteExpired, quoteID)
	}
	if err := q.LockQuote(ctx, row.ID); err != nil {
		return StoredQuote{}, fmt.Errorf("locking the quote: %w", err)
	}
	return StoredQuote{ID: quoteID, Region: ledger.Region(row.Region), Currency: row.Currency,
		SettlementMinor: row.SettlementMinor, PricePoints: row.PricePoints, BackingRateID: row.BackingRateID,
		ExpiresAt: row.ExpiresAt.Time, Locked: true}, nil
}

// ListingPrice is the ledger's price for a listing.
type ListingPrice struct {
	ListingID       string
	Region          ledger.Region
	Currency        string
	SettlementMinor int64
	PricePoints     int64
	BackingRateID   string
}

// PriceListing is priceListing: the listing's points price at the rate in
// force now, stored so a burn reads S and the region from the ledger, never
// from its caller. A listing never moves region.
func (e *Engine) PriceListing(ctx context.Context, listingID string, region ledger.Region, currency string, settlementMinor int64) (ListingPrice, error) {
	if currency != string(region.Currency()) {
		return ListingPrice{}, fmt.Errorf("%w: %s in %s", ErrCurrencyMismatch, currency, region)
	}
	q := sqlcgen.New(e.pool)
	points, rateID, err := priceNow(ctx, q, currency, settlementMinor)
	if err != nil {
		return ListingPrice{}, err
	}
	row, err := q.UpsertListingPrice(ctx, sqlcgen.UpsertListingPriceParams{
		ListingID: parseUUID(listingID), Region: string(region), Currency: currency,
		SettlementMinor: settlementMinor, PricePoints: points, BackingRateID: rateID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ListingPrice{}, fmt.Errorf("%w: listing %s is priced in the other region", ErrRegionMismatch, listingID)
	}
	if err != nil {
		return ListingPrice{}, fmt.Errorf("storing the listing price: %w", err)
	}
	return ListingPrice{ListingID: listingID, Region: region, Currency: currency, SettlementMinor: row.SettlementMinor,
		PricePoints: row.PricePoints, BackingRateID: row.BackingRateID}, nil
}

// priceNow is ceil(S × 1e6 / B) at the rate in force now, multiplier 1.00.
func priceNow(ctx context.Context, q *sqlcgen.Queries, currency string, settlementMinor int64) (int64, string, error) {
	rate, err := q.GetBackingRateInForce(ctx, currency)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, "", fmt.Errorf("%w: %s", ErrNoRateInForce, currency)
	}
	if err != nil {
		return 0, "", fmt.Errorf("reading the rate in force: %w", err)
	}
	points, err := PriceInPoints(settlementMinor, rate.MicrosPerPoint, NeutralDemandBps)
	if err != nil {
		return 0, "", err
	}
	return points, rate.ID, nil
}

func newUUID() pgtype.UUID {
	var id [16]byte
	_, _ = rand.Read(id[:])
	id[6] = id[6]&0x0f | 0x40 // version 4
	id[8] = id[8]&0x3f | 0x80 // RFC 4122 variant
	return pgtype.UUID{Bytes: id, Valid: true}
}

func parseUUID(value string) pgtype.UUID {
	var id pgtype.UUID
	if id.Scan(value) != nil {
		return pgtype.UUID{}
	}
	return id
}

func uuidString(id pgtype.UUID) string {
	b := id.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
