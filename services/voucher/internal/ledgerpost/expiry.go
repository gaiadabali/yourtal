package ledgerpost

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// errExpiryRefused mirrors errRefused (poster.go) for the expiry outbox: a
// 4xx means this row is wrong, not that the ledger is down, so it stays
// unposted and logged rather than blocking the rows behind it.
var errExpiryRefused = errors.New("ledgerpost: the ledger refused the voucher expiry")

// DrainExpiryOnce posts up to one batch of voucher.expiry_outbox rows to the
// ledger's /v1/vouchers/expire (10.2.b) and returns how many it marked
// posted. Same shape as DrainOnce, a separate outbox because a capture and
// an expiry are different ledger calls with different bodies.
func (p *Poster) DrainExpiryOnce(ctx context.Context) (int, error) {
	queries := sqlcgen.New(p.pool)
	rows, err := queries.ListUnpostedExpiryOutbox(ctx, batchSize)
	if err != nil {
		return 0, fmt.Errorf("reading the expiry outbox: %w", err)
	}
	posted := 0
	for _, row := range rows {
		if err := p.postExpiry(ctx, row); errors.Is(err, errExpiryRefused) {
			p.logger.Error("the ledger refused a voucher expiry; it stays in the outbox", "error", err)
			continue
		} else if err != nil {
			return posted, err
		}
		if err := queries.MarkExpiryOutboxPosted(ctx, row.VoucherID); err != nil {
			return posted, fmt.Errorf("marking voucher %s's expiry posted: %w", uuidString(row.VoucherID), err)
		}
		posted++
	}
	return posted, nil
}

func (p *Poster) postExpiry(ctx context.Context, row sqlcgen.ListUnpostedExpiryOutboxRow) error {
	voucherID := uuidString(row.VoucherID)
	body, err := json.Marshal(map[string]any{
		"voucherId": voucherID, "region": row.Region, "amountMinor": row.AmountMinor,
	})
	if err != nil {
		return err
	}
	status, answer, err := p.signedPost(ctx, "/v1/vouchers/expire", body)
	if err != nil {
		return fmt.Errorf("posting voucher expiry %s: %w", voucherID, err)
	}
	if status >= 400 && status < 500 {
		return fmt.Errorf("%w: %s answered %d %s", errExpiryRefused, voucherID, status, answer)
	}
	if status < 200 || status > 299 {
		return fmt.Errorf("posting voucher expiry %s: the ledger answered %d %s", voucherID, status, answer)
	}
	return nil
}
