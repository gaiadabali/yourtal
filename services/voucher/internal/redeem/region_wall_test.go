package redeem_test

import (
	"context"
	"strings"
	"testing"
)

// 4.10: a voucher never crosses AU/ID, in the database as well as in Go
// (F2). The voucher role writes the crossing row directly, skipping every
// Go check, and a constraint refuses it.
func TestAVoucherCannotMoveRegion(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	voucherID, _ := f.mintAUD(t, 2_000)

	for _, c := range []struct {
		name, update, constraint string
	}{
		{"an AUD voucher relabelled ID", `UPDATE voucher.vouchers SET region = 'ID' WHERE id = $1`, "vouchers_cash_in_its_region"},
		{"an AU listing's voucher moved to IDR", `UPDATE voucher.vouchers SET region = 'ID', currency = 'IDR' WHERE id = $1`,
			"vouchers_in_their_listings_currency"},
	} {
		if _, err := f.pool.Exec(ctx, c.update, voucherID); err == nil || !strings.Contains(err.Error(), c.constraint) {
			t.Errorf("%s: %v, want %s", c.name, err, c.constraint)
		}
	}
	var region, currency string
	if err := f.pool.QueryRow(ctx, `SELECT region, currency FROM voucher.vouchers WHERE id = $1`, voucherID).
		Scan(&region, &currency); err != nil {
		t.Fatal(err)
	}
	if region != "AU" || currency != "AUD" {
		t.Errorf("the voucher is %s/%s, want AU/AUD", region, currency)
	}
}
