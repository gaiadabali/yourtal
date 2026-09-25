package redeem_test

import (
	"context"
	"errors"
	"testing"

	"github.com/yourtal/services/voucher/internal/redeem"
)

// 4.6.c: minimum spend is a floor on the order total (D5), and an authorize
// replay must be the same request (D7).

// D5 scenario 1: a IDR 50,000 voucher with a IDR 100,000 minimum could never
// be redeemed, because the draw was compared with the minimum.
func TestAMinimumSpendVoucherRedeemsAgainstABigEnoughOrder(t *testing.T) {
	f := newFixture(t)
	minimum := int64(100_000)
	_, plaintext := f.mintOne(t, "minimum_spend", 50_000, &minimum)

	hold, err := f.network.Authorize(context.Background(), redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 50_000, OrderTotalMinor: 120_000,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatalf("50,000 off a 120,000 order against a 100,000 minimum: %v", err)
	}
	if _, err := f.network.Capture(context.Background(), hold.ID, f.merchantID, 50_000, orderRef()); err != nil {
		t.Fatalf("capture: %v", err)
	}
}

func TestAMinimumSpendVoucherRefusesASmallOrderTotal(t *testing.T) {
	f := newFixture(t)
	minimum := int64(100_000)
	_, plaintext := f.mintOne(t, "minimum_spend", 50_000, &minimum)

	_, err := f.network.Authorize(context.Background(), redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 50_000, OrderTotalMinor: 90_000,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if !errors.Is(err, redeem.ErrBelowMinimumSpend) {
		t.Fatalf("a 90,000 order against a 100,000 minimum: err = %v", err)
	}
}

// The draw can never exceed the order it pays for.
func TestTheDrawCannotExceedTheOrder(t *testing.T) {
	f := newFixture(t)
	_, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)
	_, err := f.network.Authorize(context.Background(), redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 30_000, OrderTotalMinor: 20_000,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if !errors.Is(err, redeem.ErrRefused) {
		t.Fatalf("30,000 drawn for a 20,000 order: err = %v", err)
	}
}

// D7: a retry of order O-17 with a different voucher got the first
// voucher's hold, and the till charged the wrong one.
func TestAReplayWithADifferentVoucherOrAmountIsADuplicateOrder(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	_, first := f.mintOne(t, "balance_carrying", 50_000, nil)
	_, second := f.mintOne(t, "balance_carrying", 50_000, nil)
	order := orderRef()
	req := redeem.AuthorizeRequest{Code: first, MerchantID: f.merchantID, AmountMinor: 10_000, Currency: "IDR", OrderRef: order}

	if _, err := f.network.Authorize(ctx, req); err != nil {
		t.Fatal(err)
	}
	same, err := f.network.Authorize(ctx, req)
	if err != nil || !same.AlreadyExisted {
		t.Fatalf("an exact replay: %+v, %v", same, err)
	}

	other := req
	other.Code = second
	if _, err := f.network.Authorize(ctx, other); !errors.Is(err, redeem.ErrDuplicateOrder) {
		t.Errorf("same order, another voucher: err = %v, want ErrDuplicateOrder", err)
	}
	more := req
	more.AmountMinor = 20_000
	if _, err := f.network.Authorize(ctx, more); !errors.Is(err, redeem.ErrDuplicateOrder) {
		t.Errorf("same order, another amount: err = %v, want ErrDuplicateOrder", err)
	}
}
