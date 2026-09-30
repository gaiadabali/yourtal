package issue_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/issue"
)

// 13.22.a/c: listing escrows the voucher by void-and-remint; the close hands
// it on once, and the winner cannot pass it on.

func (f *fixture) escrowVoucher(t *testing.T, auctionID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := f.owner.QueryRow(context.Background(), `SELECT voucher_id FROM voucher.escrow WHERE auction_id = $1`, auctionID).Scan(&id); err != nil {
		t.Fatalf("reading escrow %s: %v", auctionID, err)
	}
	return id
}

func TestEscrowVoidsAtOnceAndHandsOverOnce(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	source, seller := f.ownedTransferable(t, true)
	auction := uuid.New()

	if err := f.minter.Escrow(ctx, issue.EscrowRequest{AuctionID: auction, VoucherID: source, SellerID: seller, Region: "AU"}); !errors.Is(err, issue.ErrGiftRegion) {
		t.Fatalf("a cross-region auction = %v, want ErrGiftRegion", err)
	}
	req := issue.EscrowRequest{AuctionID: auction, VoucherID: source, SellerID: seller, Region: "ID"}
	if err := f.minter.Escrow(ctx, req); err != nil {
		t.Fatalf("Escrow: %v", err)
	}
	if err := f.minter.Escrow(ctx, req); err != nil {
		t.Fatalf("a retried Escrow: %v", err)
	}
	if state, _, reason := f.voucherState(t, source); state != "voided" || reason == nil || *reason != "transfer" {
		t.Fatalf("the seller's voucher is %s (%v), want voided by transfer", state, reason)
	}
	held := f.escrowVoucher(t, auction)
	if state, owner, _ := f.voucherState(t, held); state != "allocated" || owner != nil {
		t.Fatalf("the escrowed voucher is %s owned by %v", state, owner)
	}

	winner := uuid.New()
	if err := f.minter.ReleaseEscrow(ctx, auction, winner); err != nil {
		t.Fatalf("ReleaseEscrow: %v", err)
	}
	if err := f.minter.ReleaseEscrow(ctx, auction, winner); err != nil {
		t.Fatalf("a retried release: %v", err)
	}
	if err := f.minter.ReleaseEscrow(ctx, auction, uuid.New()); !errors.Is(err, issue.ErrEscrowReleased) {
		t.Fatalf("a second release to someone else = %v", err)
	}
	if state, owner, _ := f.voucherState(t, held); state != "active" || owner == nil || *owner != winner {
		t.Fatalf("the won voucher is %s owned by %v", state, owner)
	}
	for _, id := range []uuid.UUID{source, held} {
		if err := f.minter.VerifyChain(ctx, id); err != nil {
			t.Fatalf("VerifyChain(%s): %v", id, err)
		}
	}

	f.minter.WithGiftPolicy(noHoldback)
	if _, err := f.minter.Gift(ctx, issue.GiftRequest{VoucherID: held, SenderID: winner, RecipientID: uuid.New(), RecipientRegion: "ID"}); !errors.Is(err, issue.ErrAlreadyGifted) {
		t.Fatalf("gifting a won voucher = %v, want ErrAlreadyGifted", err)
	}
	if err := f.minter.Escrow(ctx, issue.EscrowRequest{AuctionID: uuid.New(), VoucherID: held, SellerID: winner, Region: "ID"}); !errors.Is(err, issue.ErrAlreadyGifted) {
		t.Fatalf("re-auctioning a won voucher = %v, want ErrAlreadyGifted", err)
	}
}

func TestAnUnsoldOrCancelledAuctionReturnsAGiftableVoucher(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	source, seller := f.ownedTransferable(t, true)
	auction := uuid.New()
	if err := f.minter.Escrow(ctx, issue.EscrowRequest{AuctionID: auction, VoucherID: source, SellerID: seller, Region: "ID"}); err != nil {
		t.Fatalf("Escrow: %v", err)
	}
	if err := f.minter.ReleaseEscrow(ctx, auction, seller); err != nil {
		t.Fatalf("ReleaseEscrow to the seller: %v", err)
	}
	f.minter.WithGiftPolicy(noHoldback)
	back := f.escrowVoucher(t, auction)
	if _, err := f.minter.Gift(ctx, issue.GiftRequest{VoucherID: back, SenderID: seller, RecipientID: uuid.New(), RecipientRegion: "ID"}); err != nil {
		t.Fatalf("the seller gifting their returned voucher: %v", err)
	}

	plain, owner := f.ownedTransferable(t, false)
	if err := f.minter.Escrow(ctx, issue.EscrowRequest{AuctionID: uuid.New(), VoucherID: plain, SellerID: owner, Region: "ID"}); !errors.Is(err, issue.ErrNotTransferable) {
		t.Fatalf("a non-transferable voucher = %v", err)
	}
}
