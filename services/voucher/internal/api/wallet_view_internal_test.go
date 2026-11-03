package api

import (
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func giftSource(mutate func(*walletVoucherSource)) walletVoucherSource {
	row := walletVoucherSource{
		State: "active", FaceValueMinor: 600, RemainingValueMinor: 600, Transferable: true,
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(30 * 24 * time.Hour), Valid: true},
	}
	if mutate != nil {
		mutate(&row)
	}
	return row
}

// A voucher that cannot change hands says which rule stops it, so the page can
// tell its owner in plain words instead of showing no Gift control and no reason.
func TestWalletViewNamesTheRuleThatBlocksAGift(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*walletVoucherSource)
		giftOK bool
		block  string
	}{
		{"an unused transferable voucher", nil, true, ""},
		{"won at auction or gifted in", func(r *walletVoucherSource) { r.ReceivedAsGift = true }, false, "received_as_gift"},
		{"a listing that forbids it", func(r *walletVoucherSource) { r.Transferable = false }, false, "not_transferable"},
		{"partly spent", func(r *walletVoucherSource) { r.RemainingValueMinor = 100 }, false, "not_unused"},
		{"already redeemed", func(r *walletVoucherSource) { r.State = "redeemed"; r.RemainingValueMinor = 0 }, false, "not_unused"},
		{"expired", func(r *walletVoucherSource) {
			r.ExpiresAt = pgtype.Timestamptz{Time: time.Now().Add(-time.Hour), Valid: true}
		}, false, "not_unused"},
		// Unused wins over the one-hop rule: a spent voucher is not "already passed on".
		{"spent and received", func(r *walletVoucherSource) { r.ReceivedAsGift = true; r.State = "redeemed" }, false, "not_unused"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			view := toWalletVoucherView(giftSource(c.mutate))
			if view.Giftable != c.giftOK || view.GiftBlock != c.block {
				t.Fatalf("giftable=%v block=%q, want giftable=%v block=%q", view.Giftable, view.GiftBlock, c.giftOK, c.block)
			}
		})
	}
}
