package issue

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// 13.22 (F86): a voucher listed in a charity auction. Listing voids the
// seller's code at once and remints the voucher into escrow (Allocated, no
// owner); the close hands it to the winner, the charity, or back to the
// seller. Same one-hop and transferable rules as a gift.

// ErrEscrowReleased — the auction's voucher has already been handed over.
var ErrEscrowReleased = errors.New("issue: this auction's voucher has already been handed over")

// EscrowRequest is a seller listing one of their vouchers.
type EscrowRequest struct {
	AuctionID uuid.UUID
	VoucherID uuid.UUID
	SellerID  uuid.UUID
	Region    string
}

// Escrow holds the seller's voucher for an auction. A retry for the same
// auction and voucher is a no-op.
func (m *Minter) Escrow(ctx context.Context, req EscrowRequest) error {
	return pgx.BeginTxFunc(ctx, m.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)
		if existing, err := queries.LockEscrow(ctx, pgUUID(req.AuctionID)); err == nil {
			if asUUID(existing.SourceVoucherID) == req.VoucherID && asUUID(existing.SellerID) == req.SellerID {
				return nil
			}
			return fmt.Errorf("%w: auction %s escrows another voucher", ErrNotUnused, req.AuctionID)
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("reading an earlier escrow: %w", err)
		}

		source, err := queries.LockOwnedVoucher(ctx, sqlcgen.LockOwnedVoucherParams{
			ID: pgUUID(req.VoucherID), OwnerID: pgUUID(req.SellerID),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: voucher %s", ErrNotFound, req.VoucherID)
		}
		if err != nil {
			return fmt.Errorf("locking voucher %s: %w", req.VoucherID, err)
		}
		if source.Region != req.Region {
			return fmt.Errorf("%w: voucher in %s, auction in %s", ErrGiftRegion, source.Region, req.Region)
		}
		if err := checkUnused(source, m.now()); err != nil {
			return err
		}
		if !source.Transferable {
			return ErrNotTransferable
		}
		received, err := queries.ReceivedByTransfer(ctx, source.ID)
		if err != nil {
			return fmt.Errorf("checking the transfer hop: %w", err)
		}
		if received {
			return ErrAlreadyGifted
		}

		newID, err := m.remint(ctx, queries, source, "auction:"+req.AuctionID.String(),
			"auction_id", req.AuctionID.String())
		if err != nil {
			return err
		}
		return queries.InsertEscrow(ctx, sqlcgen.InsertEscrowParams{
			AuctionID: pgUUID(req.AuctionID), SourceVoucherID: source.ID, VoucherID: pgUUID(newID),
			SellerID: pgUUID(req.SellerID), Region: source.Region,
		})
	})
}

// ReleaseEscrow hands the escrowed voucher to owner. Releasing again to the
// same owner is a no-op, so a retried settlement is safe.
func (m *Minter) ReleaseEscrow(ctx context.Context, auctionID, owner uuid.UUID) error {
	return pgx.BeginTxFunc(ctx, m.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)
		escrow, err := queries.LockEscrow(ctx, pgUUID(auctionID))
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: auction %s", ErrNotFound, auctionID)
		}
		if err != nil {
			return fmt.Errorf("locking escrow %s: %w", auctionID, err)
		}
		if escrow.State == "released" {
			if escrow.ReleasedTo.Valid && asUUID(escrow.ReleasedTo) == owner {
				return nil
			}
			return ErrEscrowReleased
		}
		if err := m.handOver(ctx, queries, asUUID(escrow.VoucherID), owner,
			"auction_id", auctionID.String()); err != nil {
			return err
		}
		return queries.ReleaseEscrow(ctx, sqlcgen.ReleaseEscrowParams{AuctionID: escrow.AuctionID, ReleasedTo: pgUUID(owner)})
	})
}
