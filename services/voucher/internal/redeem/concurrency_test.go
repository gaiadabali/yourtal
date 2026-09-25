package redeem_test

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/yourtal/services/voucher/internal/redeem"
)

// 4.6.g: goroutine races on one voucher. The audit found every earlier
// "concurrency is serialised" claim resting on index design and sequential
// tests; these run the races.

func race(n int, fn func(i int) error) (ok int64) {
	var wg sync.WaitGroup
	var won atomic.Int64
	start := make(chan struct{})
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if fn(i) == nil {
				won.Add(1)
			}
		}()
	}
	close(start)
	wg.Wait()
	return won.Load()
}

func TestConcurrentAuthorizesPlaceOneHold(t *testing.T) {
	f := newFixture(t)
	voucherID, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	won := race(8, func(int) error {
		_, err := f.network.Authorize(context.Background(), redeem.AuthorizeRequest{
			Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000, Currency: "IDR", OrderRef: orderRef(),
		})
		return err
	})
	if won != 1 {
		t.Errorf("%d of 8 concurrent authorizes placed a hold, want 1", won)
	}
	if err := f.minter.VerifyChain(context.Background(), voucherID); err != nil {
		t.Errorf("the chain after the race: %v", err)
	}
}

func TestACaptureRacingAVoidEndsOneWay(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	voucherID, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)
	hold, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 10_000, Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatal(err)
	}

	won := race(2, func(i int) error {
		if i == 0 {
			_, err := f.network.Capture(ctx, hold.ID, f.merchantID, 10_000, orderRef())
			return err
		}
		return f.network.Void(ctx, hold.ID, f.merchantID)
	})
	if won != 1 {
		t.Fatalf("%d of capture and void both succeeded, want exactly 1", won)
	}
	remaining, state := f.remainingOf(t, voucherID), f.stateOf(t, voucherID)
	if state != "active" || (remaining != 40_000 && remaining != 50_000) {
		t.Errorf("after the race: %s holding %d", state, remaining)
	}
	if err := f.minter.VerifyChain(ctx, voucherID); err != nil {
		t.Errorf("the chain after the race: %v", err)
	}
}

// A refund and a new authorize race on the same active voucher. Either may
// lose (409, retry); what may not happen is value appearing or vanishing.
func TestARefundRacingAnAuthorizeKeepsTheValueExact(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	voucherID, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)
	hold, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 30_000, Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatal(err)
	}
	captured, err := f.network.Capture(ctx, hold.ID, f.merchantID, 30_000, orderRef())
	if err != nil {
		t.Fatal(err)
	}

	var refunded atomic.Bool
	race(2, func(i int) error {
		if i == 0 {
			err := f.network.Refund(ctx, captured.ID, 5_000, "race", "race-refund")
			refunded.Store(err == nil)
			return err
		}
		_, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
			Code: plaintext, MerchantID: f.merchantID, AmountMinor: 1_000, Currency: "IDR", OrderRef: orderRef(),
		})
		return err
	})

	want := int64(20_000)
	if refunded.Load() {
		want = 25_000
	}
	if got := f.remainingOf(t, voucherID); got != want {
		t.Errorf("remaining = %d, want %d (refund applied: %v)", got, want, refunded.Load())
	}
	if err := f.minter.VerifyChain(ctx, voucherID); err != nil {
		t.Errorf("the chain after the race: %v", err)
	}
}
