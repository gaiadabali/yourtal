package proof

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// 4.6.h (D6, F11): services/voucher anchors each voucher's chain head here,
// and a day's proof root covers that day's anchors.

var (
	// ErrBadAnchor: an anchor that is not a voucher id, seq, hash and region.
	ErrBadAnchor = errors.New("proof: malformed voucher head anchor")
	// ErrAnchorConflict: a different head was already anchored for this
	// voucher at this seq. The voucher's chain was rewritten; it pages.
	ErrAnchorConflict = errors.New("proof: a different head is already anchored at this seq")
)

var headHashPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// VoucherHeadLeaf is one voucher's chain head at one seq.
type VoucherHeadLeaf struct {
	VoucherID string
	Seq       int64
	HeadHash  string
	Region    string
}

// voucherHeadLeafHash is prefixed so a head can never hash like a ledger leaf.
func voucherHeadLeafHash(h VoucherHeadLeaf) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("voucher_head\x1F%s\x1F%d\x1F%s\x1F%s", h.VoucherID, h.Seq, h.HeadHash, h.Region)))
	return hex.EncodeToString(sum[:])
}

// VoucherHeadsRoot is the Merkle root over a day's anchors in id order, or
// "" for a day with none (which leaves the day's root the ledger-only root).
func VoucherHeadsRoot(heads []VoucherHeadLeaf) string {
	if len(heads) == 0 {
		return ""
	}
	level := make([]string, 0, len(heads))
	for _, head := range heads {
		level = append(level, voucherHeadLeafHash(head))
	}
	return treeRoot(level)
}

// combineRoots folds the heads into the ledger root. With no heads the result
// is exactly Root(leaves), so days recorded before 4.6.h verify unchanged.
func combineRoots(leaves []Leaf, heads []VoucherHeadLeaf) (combined, ledgerRoot, headsRoot string) {
	ledgerRoot = Root(leaves)
	if len(heads) == 0 {
		return ledgerRoot, ledgerRoot, ""
	}
	headsRoot = VoucherHeadsRoot(heads)
	return pairHash(ledgerRoot, headsRoot), ledgerRoot, headsRoot
}

// AnchorHeads records heads, in one transaction, and returns how many were
// new. Re-sending an anchored head is a no-op; a different head at the same
// seq is ErrAnchorConflict and pages.
func (c *Checker) AnchorHeads(ctx context.Context, heads []VoucherHeadLeaf) (int, error) {
	ids := make([]pgtype.UUID, len(heads))
	for i, head := range heads {
		if err := ids[i].Scan(head.VoucherID); err != nil || head.Seq <= 0 ||
			!headHashPattern.MatchString(head.HeadHash) || (head.Region != "AU" && head.Region != "ID") {
			return 0, fmt.Errorf("%w: %+v", ErrBadAnchor, head)
		}
	}

	added := 0
	var conflict error
	err := pgx.BeginFunc(ctx, c.pool, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)
		added = 0
		for i, head := range heads {
			n, err := queries.InsertVoucherHeadAnchor(ctx, sqlcgen.InsertVoucherHeadAnchorParams{
				VoucherID: ids[i], Seq: head.Seq, HeadHash: head.HeadHash, Region: head.Region,
			})
			if err != nil {
				return fmt.Errorf("anchoring voucher %s: %w", head.VoucherID, err)
			}
			if n == 1 {
				added++
				continue
			}
			existing, err := queries.GetVoucherHeadAnchor(ctx, sqlcgen.GetVoucherHeadAnchorParams{VoucherID: ids[i], Seq: head.Seq})
			if err != nil {
				return fmt.Errorf("reading the anchor for voucher %s: %w", head.VoucherID, err)
			}
			if existing.HeadHash != head.HeadHash || existing.Region != head.Region {
				conflict = fmt.Errorf("%w: voucher %s seq %d", ErrAnchorConflict, head.VoucherID, head.Seq)
				return conflict
			}
		}
		return nil
	})
	if conflict != nil {
		if pageErr := c.alerter.Page(ctx, "a voucher chain head changed after it was anchored", conflict.Error()); pageErr != nil {
			return 0, errors.Join(conflict, pageErr)
		}
	}
	return added, err
}

// headsFor reads one UTC day's anchors in id order.
func (c *Checker) headsFor(ctx context.Context, day time.Time) ([]VoucherHeadLeaf, error) {
	from := startOfDay(day)
	rows, err := sqlcgen.New(c.pool).ListVoucherHeadAnchorsForDay(ctx, sqlcgen.ListVoucherHeadAnchorsForDayParams{
		CreatedAt:   pgtype.Timestamptz{Time: from, Valid: true},
		CreatedAt_2: pgtype.Timestamptz{Time: from.AddDate(0, 0, 1), Valid: true},
	})
	if err != nil {
		return nil, fmt.Errorf("reading voucher head anchors for %s: %w", from.Format(time.DateOnly), err)
	}
	heads := make([]VoucherHeadLeaf, 0, len(rows))
	for _, row := range rows {
		b := row.VoucherID.Bytes
		heads = append(heads, VoucherHeadLeaf{
			VoucherID: fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]),
			Seq:       row.Seq, HeadHash: row.HeadHash, Region: row.Region,
		})
	}
	return heads, nil
}
