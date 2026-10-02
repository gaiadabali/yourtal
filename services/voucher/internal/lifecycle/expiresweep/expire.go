// Package expiresweep is TASKS.md 10.2.b's own sweep, kept OUT of package
// lifecycle itself: lifecycle is a leaf both issue and redeem import for the
// transition table, so a file here that also imports issue and redeem (to
// call Move and RecordWebhookOutbox) would close an import cycle if it
// lived in lifecycle's own package. Still under lifecycle/ on disk, per
// TASKS.md 10.2.b's own file boundary — just not literally `package
// lifecycle`.
package expiresweep

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/chain"
	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/lifecycle"
	"github.com/yourtal/services/voucher/internal/redeem"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// TASKS.md 10.2.b: active vouchers past their own expires_at become Expired.
// A dead hold gets there too, one tick later, once release.go's own
// SweepExpiredHolds has already put it back to Active — this package does
// not duplicate that release, only the Active -> Expired half.
//
// Each voucher is moved in its own transaction: the state change,
// `voucher.event`, `voucher.webhook_outbox` (`voucher.expired` — 8.3.e's
// existing drain delivers it, unchanged by this task) and
// `voucher.expiry_outbox` (this task's own outbox to the ledger, drained
// in-process by ledgerpost.Poster, the same "capture_outbox is drained
// in-process" shape 4.6.f already settled) all land together — the same
// "no state change without its outbox row" rule 4.6.f and 8.3.e state for
// capture and refund.
const expireBatchSize = 200

// Sweeper expires due vouchers. A struct (not a bare function) for the same
// reason redeem.Network carries its own clock: WithClock is the test seam.
type Sweeper struct {
	pool *pgxpool.Pool
	now  func() time.Time
}

func NewSweeper(pool *pgxpool.Pool) *Sweeper {
	return &Sweeper{pool: pool, now: func() time.Time { return time.Now().UTC() }}
}

// WithClock replaces the clock. Test seam only.
func (s *Sweeper) WithClock(now func() time.Time) *Sweeper {
	s.now = now
	return s
}

// SweepDue expires up to one batch of active-but-overdue vouchers and
// returns how many it moved. A voucher whose version has moved since it was
// listed (ErrStaleVersion) is skipped, not fatal — a genuine race (a
// last-second redemption) means it is no longer this sweep's to expire.
func (s *Sweeper) SweepDue(ctx context.Context) (int, error) {
	due, err := sqlcgen.New(s.pool).ListVouchersDueForExpiry(ctx, expireBatchSize)
	if err != nil {
		return 0, fmt.Errorf("lifecycle: listing vouchers due for expiry: %w", err)
	}
	expired := 0
	for _, id := range due {
		ok, err := s.expireOne(ctx, id)
		if err != nil {
			return expired, err
		}
		if ok {
			expired++
		}
	}
	return expired, nil
}

func (s *Sweeper) expireOne(ctx context.Context, voucherID pgtype.UUID) (bool, error) {
	moved := false
	err := pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)
		voucher, err := queries.GetVoucher(ctx, voucherID)
		if err != nil {
			return fmt.Errorf("reading %s: %w", uuidString(voucherID), err)
		}
		if voucher.State != string(lifecycle.Active) {
			return nil // raced with a redemption, a void, or a previous sweep tick
		}

		_, err = issue.Move(ctx, queries, issue.MoveRequest{
			VoucherID: asUUID(voucherID), From: lifecycle.Active, To: lifecycle.Expired,
			RemainingMinor: voucher.RemainingValueMinor, Version: voucher.Version,
			EventType: chain.TypeExpired, At: s.now(),
		})
		if errors.Is(err, issue.ErrStaleVersion) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("expiring %s: %w", uuidString(voucherID), err)
		}

		if err := redeem.RecordWebhookOutbox(ctx, queries, redeem.WebhookOutboxEvent{
			EventType:      "voucher.expired",
			MerchantID:     asUUID(voucher.MerchantID),
			IdempotencyKey: "voucher_expired_" + uuidString(voucherID),
			Payload: map[string]any{
				"voucherId":           uuidString(voucherID),
				"merchantId":          uuidString(voucher.MerchantID),
				"remainingValueMinor": voucher.RemainingValueMinor,
				"currency":            voucher.Currency,
				"expiredAt":           s.now().UTC().Format(time.RFC3339),
			},
		}); err != nil {
			return fmt.Errorf("recording the webhook outbox row for %s: %w", uuidString(voucherID), err)
		}

		// 13.3.c: the ledger releases what it still owes for this voucher, the
		// settlement share of the unredeemed remainder (a burn put only S into
		// voucher_liability), never the face value of what is left.
		settlement, err := redeem.SettlementOf(ctx, queries, voucher.BatchID, voucher.ListingID)
		if err != nil {
			return fmt.Errorf("expiring %s: %w", uuidString(voucherID), err)
		}
		owedMinor := redeem.PayableShare(settlement, voucher.FaceValueMinor,
			voucher.FaceValueMinor-voucher.RemainingValueMinor, voucher.FaceValueMinor)
		if owedMinor > 0 {
			if err := queries.InsertExpiryOutbox(ctx, sqlcgen.InsertExpiryOutboxParams{
				VoucherID: voucherID, Region: voucher.Region,
				AmountMinor: owedMinor, Currency: voucher.Currency,
			}); err != nil {
				return fmt.Errorf("recording the expiry outbox row for %s: %w", uuidString(voucherID), err)
			}
		}
		moved = true
		return nil
	})
	return moved, err
}

func asUUID(value pgtype.UUID) uuid.UUID { return value.Bytes }
func uuidString(id pgtype.UUID) string   { return asUUID(id).String() }
