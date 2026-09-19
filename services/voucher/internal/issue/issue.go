// Package issue mints vouchers from an approved batch. YT-0140 / YT-0141.
//
// # Nothing is minted without a second person and a funding record
//
// Bulk issuance creates bearer instruments with face value. An approval you
// can give yourself is a form on a screen, so the two-person rule is a WHERE
// clause — `requested_by <> $approver` — and a self-approval matches no row
// rather than being caught by a check the caller remembered to run. Every
// batch also carries a funding reference, so the liability it creates is
// attributable to something rather than appearing from nowhere.
//
// # The code exists in memory once, and then never again
//
// A minted code is generated, hashed for lookup, sealed for display, and
// dropped. It is never logged, never returned from a bulk mint, and never
// stored in plaintext — docs/15's seventh rule. The only way back to it is
// `Reveal`, which decrypts one code for its owner and is the one function in
// this package that can put a code in memory again.
package issue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/chain"
	"github.com/yourtal/services/voucher/internal/code"
	"github.com/yourtal/services/voucher/internal/keyring"
	"github.com/yourtal/services/voucher/internal/lifecycle"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

var (
	// ErrSelfApproval — the requester tried to approve their own batch.
	ErrSelfApproval = errors.New("issue: a batch cannot be approved by the person who requested it")
	// ErrBatchNotApproved — minting was attempted on a batch that has not
	// cleared approval, or that is already being minted.
	ErrBatchNotApproved = errors.New("issue: only an approved batch can be minted, and only once")
	// ErrCodeCollision — a minted code already exists. At 80 bits this is
	// not something that happens; it is something that means the randomness
	// is broken, which is why it is a named error and not a retry.
	ErrCodeCollision = errors.New("issue: a minted code already existed")
	// ErrNotFound — no such voucher or batch.
	ErrNotFound = errors.New("issue: not found")
)

// Minter issues vouchers.
type Minter struct {
	pool *pgxpool.Pool
	keys *keyring.Keyring
	// now is injectable so the event chain's timestamps are deterministic
	// in tests. A hash chain over wall-clock time is otherwise impossible to
	// assert anything exact about.
	now func() time.Time
}

func New(pool *pgxpool.Pool, keys *keyring.Keyring) *Minter {
	return &Minter{pool: pool, keys: keys, now: func() time.Time { return time.Now().UTC() }}
}

// WithClock replaces the clock. Test seam only.
func (m *Minter) WithClock(now func() time.Time) *Minter {
	m.now = now
	return m
}

// BatchRequest is a supplier asking for inventory to be minted.
type BatchRequest struct {
	ID                   uuid.UUID
	ListingID            uuid.UUID
	SupplierBusinessID   uuid.UUID
	RequestedBy          uuid.UUID
	Quantity             int32
	FaceValueMinor       int64
	SettlementValueMinor int64
	Currency             string
	Transferable         bool
	PartialPolicy        string
	MinimumSpendMinor    *int64
	ExpiresAt            time.Time
	// FundingReference ties the batch to the money behind it (YT-0141).
	// Mandatory, and free text on purpose: at Phase 1 it is a partner
	// purchase id or a signed marketing authorisation, and a foreign key
	// would either block the batch or invent a purchase to point at.
	FundingReference string
}

// RequestBatch records the request. Nothing is minted yet.
func (m *Minter) RequestBatch(ctx context.Context, req BatchRequest) error {
	return sqlcgen.New(m.pool).InsertBatch(ctx, sqlcgen.InsertBatchParams{
		ID:                      pgUUID(req.ID),
		ListingID:               pgUUID(req.ListingID),
		SupplierBusinessID:      pgUUID(req.SupplierBusinessID),
		RequestedBy:             pgUUID(req.RequestedBy),
		Quantity:                req.Quantity,
		FaceValueMinor:          req.FaceValueMinor,
		SettlementValueMinor:    req.SettlementValueMinor,
		Currency:                req.Currency,
		Transferable:            req.Transferable,
		PartialRedemptionPolicy: req.PartialPolicy,
		MinimumSpendMinor:       req.MinimumSpendMinor,
		ExpiresAt:               pgTime(req.ExpiresAt),
		FundingReference:        req.FundingReference,
	})
}

// Approve is the second person. A self-approval matches no row.
func (m *Minter) Approve(ctx context.Context, batchID, approver uuid.UUID) error {
	_, err := sqlcgen.New(m.pool).ApproveBatch(ctx, sqlcgen.ApproveBatchParams{
		ID: pgUUID(batchID), ApprovedBy: pgUUID(approver),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Deliberately one error for two causes. Distinguishing "you cannot
		// approve your own" from "that batch is not awaiting approval" tells
		// a caller which of the two it hit, and neither changes what they
		// should do next: find the other person.
		return fmt.Errorf("%w (or the batch was not awaiting approval): %s",
			ErrSelfApproval, batchID)
	}
	if err != nil {
		return fmt.Errorf("approving batch %s: %w", batchID, err)
	}
	return nil
}

// MintResult reports what a batch produced. It deliberately carries no
// codes: a bulk mint that returned them would put every code of the batch
// into whatever logged, serialised or errored on the result.
type MintResult struct {
	BatchID    uuid.UUID
	VoucherIDs []uuid.UUID
	// ManifestSHA256 commits to exactly what was minted, so a later dispute
	// about "was this voucher in that batch" has an answer that does not
	// depend on the table being unedited.
	ManifestSHA256 string
}

// Mint issues the whole batch in one transaction.
//
// One transaction for the lot, rather than per voucher, because a partial
// mint is the worst outcome available: a batch is a unit of liability, and
// half of one is a number nobody has approved. The quantities here are
// hundreds to thousands — well inside what a single transaction holds.
func (m *Minter) Mint(ctx context.Context, batchID uuid.UUID) (MintResult, error) {
	var result MintResult

	err := pgx.BeginTxFunc(ctx, m.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)

		// Approved -> minting, once. A second caller matches no row, so
		// duplicate issuance is unrepresentable rather than merely alerted
		// on (YT-0141).
		claimed, err := queries.BeginMinting(ctx, pgUUID(batchID))
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrBatchNotApproved, batchID)
		}
		if err != nil {
			return fmt.Errorf("claiming batch %s: %w", batchID, err)
		}

		batch, err := queries.GetBatch(ctx, pgUUID(batchID))
		if err != nil {
			return fmt.Errorf("reading batch %s: %w", batchID, err)
		}

		listing, err := m.listingFor(ctx, queries, batch)
		if err != nil {
			return err
		}

		hashes := make([]string, 0, claimed.Quantity)
		for index := int32(0); index < claimed.Quantity; index++ {
			voucherID := uuid.New()
			hash, err := m.mintOne(ctx, queries, batch, listing, voucherID)
			if err != nil {
				return err
			}
			result.VoucherIDs = append(result.VoucherIDs, voucherID)
			hashes = append(hashes, hash)
		}

		result.BatchID = batchID
		result.ManifestSHA256 = manifest(result.VoucherIDs, hashes)

		return queries.CompleteMinting(ctx, sqlcgen.CompleteMintingParams{
			ID: pgUUID(batchID), ManifestSha256: &result.ManifestSHA256,
		})
	})

	if err != nil {
		return MintResult{}, err
	}
	return result, nil
}

// mintOne creates one voucher, its custody row and its genesis event.
// Returns the code hash, for the manifest.
func (m *Minter) mintOne(
	ctx context.Context, queries *sqlcgen.Queries,
	batch sqlcgen.VoucherBatch, listing listingTerms, voucherID uuid.UUID,
) (string, error) {
	plaintext, err := code.Mint()
	if err != nil {
		return "", fmt.Errorf("minting a code: %w", err)
	}

	digest := sha256.Sum256([]byte(plaintext))
	hash := hex.EncodeToString(digest[:])

	sealed, err := m.keys.Seal(keyring.PurposeVoucherCode, []byte(plaintext))
	if err != nil {
		return "", fmt.Errorf("sealing a code: %w", err)
	}

	if err := queries.InsertVoucher(ctx, sqlcgen.InsertVoucherParams{
		ID:                      pgUUID(voucherID),
		ListingID:               batch.ListingID,
		MerchantID:              listing.merchantID,
		MerchantName:            listing.merchantName,
		Title:                   listing.title,
		FaceValueIdr:            batch.FaceValueMinor,
		PartialRedemptionPolicy: batch.PartialRedemptionPolicy,
		MinimumSpendIdr:         batch.MinimumSpendMinor,
		Transferable:            batch.Transferable,
		ExpiresAt:               batch.ExpiresAt,
		LocationID:              listing.locationID,
		BatchID:                 batch.ID,
	}); err != nil {
		return "", fmt.Errorf("inserting voucher %s: %w", voucherID, err)
	}

	if err := queries.InsertCodeCustody(ctx, sqlcgen.InsertCodeCustodyParams{
		VoucherID:      pgUUID(voucherID),
		CodeHash:       hash,
		WrappedDataKey: sealed.WrappedDataKey,
		Nonce:          sealed.Nonce,
		Ciphertext:     sealed.Ciphertext,
		KeyPurpose:     string(sealed.Purpose),
		KeyVersion:     int32(sealed.Version),
	}); err != nil {
		if isUniqueViolation(err) {
			return "", fmt.Errorf("%w: %s", ErrCodeCollision, voucherID)
		}
		return "", fmt.Errorf("storing custody for %s: %w", voucherID, err)
	}

	// The genesis event. Note what is NOT in the detail: the code, and the
	// hash of the code. An audit trail holding either would be a second
	// custody surface with none of the custody.
	if err := appendEvent(ctx, queries, m.now(), voucherID, chain.GenesisHash, 1,
		chain.TypeMinted,
		chain.Detail(
			"batch_id", batch.ID.String(),
			"face_value_minor", chain.Amount(batch.FaceValueMinor),
			"policy", batch.PartialRedemptionPolicy,
		),
	); err != nil {
		return "", err
	}

	return hash, nil
}

// manifest commits to what was minted: the sorted pairs of voucher id and
// code hash, so the digest does not depend on the order they happened to be
// created in.
func manifest(ids []uuid.UUID, hashes []string) string {
	pairs := make([]string, len(ids))
	for index := range ids {
		pairs[index] = ids[index].String() + ":" + hashes[index]
	}
	sort.Strings(pairs)

	digest := sha256.New()
	for _, pair := range pairs {
		_, _ = digest.Write([]byte(pair))
		_, _ = digest.Write([]byte{0})
	}
	return hex.EncodeToString(digest.Sum(nil))
}

// Reveal decrypts one voucher's code, for its owner.
//
// The single function in this package that puts a code back in memory. The
// caller is responsible for having established that the requester owns the
// voucher; this package will not guess at that, because an authorisation
// decision made in the layer that holds the plaintext is one nobody reviews.
func (m *Minter) Reveal(ctx context.Context, voucherID uuid.UUID) (string, error) {
	custody, err := sqlcgen.New(m.pool).GetCodeCustody(ctx, pgUUID(voucherID))
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("%w: custody for %s", ErrNotFound, voucherID)
	}
	if err != nil {
		return "", fmt.Errorf("reading custody: %w", err)
	}

	plaintext, err := m.keys.Open(keyring.PurposeVoucherCode, keyring.Sealed{
		WrappedDataKey: custody.WrappedDataKey,
		Nonce:          custody.Nonce,
		Ciphertext:     custody.Ciphertext,
		Purpose:        keyring.Purpose(custody.KeyPurpose),
		Version:        int(custody.KeyVersion),
	})
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

// Allocate hands a minted voucher to a user: the step the redemption saga
// takes after debiting points.
func (m *Minter) Allocate(ctx context.Context, voucherID, owner uuid.UUID) error {
	return m.transition(ctx, voucherID, lifecycle.Allocated, "", &owner, chain.TypeAllocated)
}

// Activate puts an allocated voucher in the wallet.
func (m *Minter) Activate(ctx context.Context, voucherID uuid.UUID) error {
	return m.transition(ctx, voucherID, lifecycle.Active, "", nil, chain.TypeActivated)
}

func pgUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

// noUUID is SQL NULL for a uuid parameter. pgtype.UUID carries its own
// Valid flag, so a null is an invalid value rather than a nil pointer —
// which is why nothing here takes *uuid.UUID at the database boundary.
func noUUID() pgtype.UUID { return pgtype.UUID{} }

func pgTime(at time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: at, Valid: true}
}
