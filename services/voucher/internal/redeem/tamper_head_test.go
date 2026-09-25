package redeem_test

import (
	"context"
	"testing"

	"github.com/yourtal/services/voucher/internal/redeem"
)

// 4.6.e, D6: the chain alone cannot see its latest events deleted, nor an
// edit to the voucher row it describes. VerifyChain now can.

func TestDeletingTheLatestEventIsDetected(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	voucherID, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)
	if _, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 30_000, Currency: "IDR", OrderRef: orderRef(),
	}); err != nil {
		t.Fatal(err)
	}
	tag, err := f.asOwner(t).Exec(ctx, `DELETE FROM voucher.event WHERE voucher_id = $1
		AND seq = (SELECT max(seq) FROM voucher.event WHERE voucher_id = $1)`, voucherID)
	if err != nil || tag.RowsAffected() != 1 {
		t.Fatalf("deleting the latest event: %v, %d rows", err, tag.RowsAffected())
	}
	if err := f.minter.VerifyChain(ctx, voucherID); err == nil {
		t.Fatal("a chain missing its latest event verified")
	}
}

func TestRaisingTheValueOnTheVoucherRowIsDetected(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	voucherID, _ := f.mintOne(t, "balance_carrying", 50_000, nil)
	tag, err := f.asOwner(t).Exec(ctx, `UPDATE voucher.vouchers SET remaining_value_minor = 40000 WHERE id = $1`, voucherID)
	if err != nil || tag.RowsAffected() != 1 {
		t.Fatalf("editing the row: %v", err)
	}
	if err := f.minter.VerifyChain(ctx, voucherID); err == nil {
		t.Fatal("a voucher row whose value disagrees with its history verified")
	}
}
