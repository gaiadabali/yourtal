package ledgerpost

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// AnchorOnce sends the chain head of up to one batch of vouchers that moved
// since they were last anchored (4.6.h, D6), then advances each watermark.
// The watermark moves only after the ledger answered 2xx. It returns how
// many vouchers it brought up to date.
func (p *Poster) AnchorOnce(ctx context.Context) (int, error) {
	queries := sqlcgen.New(p.pool)
	rows, err := queries.ListVouchersNeedingHeadAnchor(ctx, batchSize)
	if err != nil {
		return 0, fmt.Errorf("reading vouchers to anchor: %w", err)
	}
	if len(rows) == 0 {
		return 0, nil
	}

	heads := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		head, err := queries.LatestEvent(ctx, row.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			// No chain to anchor: nothing for the ledger, just the watermark.
			p.logger.Warn("a voucher has no events to anchor", "voucher", uuidString(row.ID))
			continue
		}
		if err != nil {
			return 0, fmt.Errorf("reading the chain head of %s: %w", uuidString(row.ID), err)
		}
		if head.Seq != row.Version {
			p.logger.Warn("a voucher's version is not its chain's last seq", "voucher", uuidString(row.ID),
				"version", row.Version, "seq", head.Seq)
		}
		heads = append(heads, map[string]any{
			"voucherId": uuidString(row.ID), "seq": head.Seq, "headHash": head.Hash, "region": row.Region,
		})
	}

	if len(heads) > 0 {
		body, err := json.Marshal(map[string]any{"heads": heads})
		if err != nil {
			return 0, err
		}
		status, answer, err := p.signedPost(ctx, "/v1/proof/voucher-heads", body)
		if err != nil {
			return 0, fmt.Errorf("anchoring chain heads: %w", err)
		}
		if status < 200 || status > 299 {
			return 0, fmt.Errorf("anchoring chain heads: the ledger answered %d %s", status, answer)
		}
	}

	for _, row := range rows {
		if err := queries.MarkHeadAnchored(ctx, sqlcgen.MarkHeadAnchoredParams{ID: row.ID, HeadAnchoredVersion: row.Version}); err != nil {
			return 0, fmt.Errorf("advancing the anchor watermark of %s: %w", uuidString(row.ID), err)
		}
	}
	return len(rows), nil
}
