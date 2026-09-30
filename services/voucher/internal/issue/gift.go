package issue

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// 13.20 (F86): gift an unused voucher once to another verified adult in the
// same region. Who counts as a verified adult is apps/api's to decide; this
// package holds the voucher rules (docs/09 §7): void-and-remint, one hop,
// transferable listings only, a holdback and velocity caps.

// GiftPolicy is the tunable half of the transfer rules.
type GiftPolicy struct {
	// Holdback: how long a voucher must have been in its owner's wallet.
	Holdback time.Duration
	// AcceptWindow: how long the recipient has before it goes back.
	AcceptWindow   time.Duration
	SentPerDay     int64
	SentPerMonth   int64
	ReceivedPerDay int64
}

// DefaultGiftPolicy is what production runs.
var DefaultGiftPolicy = GiftPolicy{
	Holdback: 24 * time.Hour, AcceptWindow: 7 * 24 * time.Hour,
	SentPerDay: 3, SentPerMonth: 10, ReceivedPerDay: 5,
}

var (
	ErrNotTransferable  = errors.New("issue: this voucher's listing does not allow gifting")
	ErrAlreadyGifted    = errors.New("issue: a voucher received as a gift cannot be gifted again")
	ErrHoldback         = errors.New("issue: this voucher reached the wallet too recently to gift")
	ErrGiftVelocity     = errors.New("issue: too many gifts in this period")
	ErrGiftRegion       = errors.New("issue: a gift stays in the voucher's own region")
	ErrGiftToSelf       = errors.New("issue: a voucher cannot be gifted to its own owner")
	ErrGiftNotPending   = errors.New("issue: this gift has already been accepted or returned")
	ErrGiftWindowClosed = errors.New("issue: this gift's acceptance window has closed")
)

// WithGiftPolicy replaces the gift policy. cmd/voucher reads the holdback
// from the environment; tests shorten it.
func (m *Minter) WithGiftPolicy(policy GiftPolicy) *Minter {
	m.gifts = policy
	return m
}

// GiftRequest is a sender asking to give one of their vouchers away.
type GiftRequest struct {
	VoucherID       uuid.UUID
	SenderID        uuid.UUID
	RecipientID     uuid.UUID
	RecipientRegion string
}

// Gift voids the sender's voucher and mints its replacement for the
// recipient to accept. A retry of a gift that already happened returns it.
func (m *Minter) Gift(ctx context.Context, req GiftRequest) (uuid.UUID, error) {
	if req.SenderID == req.RecipientID {
		return uuid.Nil, ErrGiftToSelf
	}
	var giftID uuid.UUID
	err := pgx.BeginTxFunc(ctx, m.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)
		source, err := queries.LockOwnedVoucher(ctx, sqlcgen.LockOwnedVoucherParams{
			ID: pgUUID(req.VoucherID), OwnerID: pgUUID(req.SenderID),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: voucher %s", ErrNotFound, req.VoucherID)
		}
		if err != nil {
			return fmt.Errorf("locking voucher %s: %w", req.VoucherID, err)
		}

		if replay, err := queries.GetGiftBySource(ctx, source.ID); err == nil {
			if asUUID(replay.RecipientID) == req.RecipientID {
				giftID = asUUID(replay.ID)
				return nil
			}
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("reading an earlier gift: %w", err)
		}

		if err := m.checkGiftable(ctx, queries, source, req); err != nil {
			return err
		}

		giftID = uuid.New()
		newID, err := m.remint(ctx, queries, source, "gift:"+giftID.String(), "gift_id", giftID.String())
		if err != nil {
			return err
		}
		return queries.InsertGift(ctx, sqlcgen.InsertGiftParams{
			ID: pgUUID(giftID), SourceVoucherID: source.ID, VoucherID: pgUUID(newID),
			SenderID: pgUUID(req.SenderID), RecipientID: pgUUID(req.RecipientID),
			Region: source.Region, ExpiresAt: pgTime(m.now().Add(m.gifts.AcceptWindow)),
		})
	})
	if err != nil {
		return uuid.Nil, err
	}
	return giftID, nil
}

func (m *Minter) checkGiftable(
	ctx context.Context, queries *sqlcgen.Queries, source sqlcgen.LockOwnedVoucherRow, req GiftRequest,
) error {
	now := m.now()
	if source.Region != req.RecipientRegion {
		return fmt.Errorf("%w: voucher in %s, recipient in %s", ErrGiftRegion, source.Region, req.RecipientRegion)
	}
	if err := checkUnused(source, now); err != nil {
		return err
	}
	if !source.Transferable {
		return ErrNotTransferable
	}
	received, err := queries.ReceivedByTransfer(ctx, source.ID)
	if err != nil {
		return fmt.Errorf("checking the gift hop: %w", err)
	}
	if received {
		return ErrAlreadyGifted
	}
	activated, err := queries.LastActivatedAt(ctx, source.ID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("reading the activation time: %w", err)
	}
	if err == nil && now.Sub(activated.Time) < m.gifts.Holdback {
		return fmt.Errorf("%w: giftable from %s", ErrHoldback, activated.Time.Add(m.gifts.Holdback).Format(time.RFC3339))
	}
	return m.checkGiftVelocity(ctx, queries, req, now)
}

func (m *Minter) checkGiftVelocity(ctx context.Context, queries *sqlcgen.Queries, req GiftRequest, now time.Time) error {
	caps := []struct {
		count func() (int64, error)
		limit int64
		what  string
	}{
		{func() (int64, error) {
			return queries.CountGiftsSentSince(ctx, sqlcgen.CountGiftsSentSinceParams{SenderID: pgUUID(req.SenderID), CreatedAt: pgTime(now.Add(-24 * time.Hour))})
		}, m.gifts.SentPerDay, "sent today"},
		{func() (int64, error) {
			return queries.CountGiftsSentSince(ctx, sqlcgen.CountGiftsSentSinceParams{SenderID: pgUUID(req.SenderID), CreatedAt: pgTime(now.Add(-30 * 24 * time.Hour))})
		}, m.gifts.SentPerMonth, "sent in 30 days"},
		{func() (int64, error) {
			return queries.CountGiftsReceivedSince(ctx, sqlcgen.CountGiftsReceivedSinceParams{RecipientID: pgUUID(req.RecipientID), CreatedAt: pgTime(now.Add(-24 * time.Hour))})
		}, m.gifts.ReceivedPerDay, "received today"},
	}
	for _, c := range caps {
		count, err := c.count()
		if err != nil {
			return fmt.Errorf("counting gifts: %w", err)
		}
		if count >= c.limit {
			return fmt.Errorf("%w: %d %s", ErrGiftVelocity, count, c.what)
		}
	}
	return nil
}

// AcceptGift puts a pending gift's voucher in the recipient's wallet.
func (m *Minter) AcceptGift(ctx context.Context, giftID, recipientID uuid.UUID) error {
	return m.resolveGift(ctx, giftID, func(queries *sqlcgen.Queries, gift sqlcgen.VoucherGift) error {
		if asUUID(gift.RecipientID) != recipientID {
			return fmt.Errorf("%w: gift %s", ErrNotFound, giftID)
		}
		if !gift.ExpiresAt.Time.After(m.now()) {
			return ErrGiftWindowClosed
		}
		return m.settleGift(ctx, queries, gift, "accepted", recipientID)
	})
}

// DeclineGift sends a pending gift back to its sender.
func (m *Minter) DeclineGift(ctx context.Context, giftID, recipientID uuid.UUID) error {
	return m.resolveGift(ctx, giftID, func(queries *sqlcgen.Queries, gift sqlcgen.VoucherGift) error {
		if asUUID(gift.RecipientID) != recipientID {
			return fmt.Errorf("%w: gift %s", ErrNotFound, giftID)
		}
		return m.settleGift(ctx, queries, gift, "returned", asUUID(gift.SenderID))
	})
}

// SweepGifts returns every pending gift whose window has closed, and says
// which, so apps/api can tell each sender.
func (m *Minter) SweepGifts(ctx context.Context) ([]uuid.UUID, error) {
	due, err := sqlcgen.New(m.pool).ListDueGifts(ctx, 100)
	if err != nil {
		return nil, fmt.Errorf("listing due gifts: %w", err)
	}
	var returned []uuid.UUID
	for _, id := range due {
		err := m.resolveGift(ctx, asUUID(id), func(queries *sqlcgen.Queries, gift sqlcgen.VoucherGift) error {
			return m.settleGift(ctx, queries, gift, "returned", asUUID(gift.SenderID))
		})
		if errors.Is(err, ErrGiftNotPending) {
			continue
		}
		if err != nil {
			return returned, err
		}
		returned = append(returned, asUUID(id))
	}
	return returned, nil
}

func (m *Minter) resolveGift(
	ctx context.Context, giftID uuid.UUID, act func(*sqlcgen.Queries, sqlcgen.VoucherGift) error,
) error {
	return pgx.BeginTxFunc(ctx, m.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)
		gift, err := queries.LockGift(ctx, pgUUID(giftID))
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: gift %s", ErrNotFound, giftID)
		}
		if err != nil {
			return fmt.Errorf("locking gift %s: %w", giftID, err)
		}
		if gift.State != "pending" {
			return fmt.Errorf("%w: gift %s is %s", ErrGiftNotPending, giftID, gift.State)
		}
		return act(queries, gift)
	})
}

func (m *Minter) settleGift(
	ctx context.Context, queries *sqlcgen.Queries, gift sqlcgen.VoucherGift, outcome string, owner uuid.UUID,
) error {
	if err := m.handOver(ctx, queries, asUUID(gift.VoucherID), owner,
		"gift_id", asUUID(gift.ID).String(), "outcome", outcome); err != nil {
		return err
	}
	if _, err := queries.ResolveGift(ctx, sqlcgen.ResolveGiftParams{ID: gift.ID, State: outcome}); err != nil {
		return fmt.Errorf("resolving gift: %w", err)
	}
	return nil
}
