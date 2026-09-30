package issue_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/lifecycle"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// 13.20.a: gifting is void-and-remint, one hop, transferable listings only,
// same region, with a holdback and velocity caps.

var noHoldback = issue.GiftPolicy{AcceptWindow: issue.DefaultGiftPolicy.AcceptWindow, SentPerDay: 3, SentPerMonth: 10, ReceivedPerDay: 5}

// ownedTransferable mints one voucher on a transferable listing and puts it
// in a fresh owner's wallet.
func (f *fixture) ownedTransferable(t *testing.T, transferable bool) (voucherID, ownerID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	listingID, merchantID := f.seedListing(t)
	if _, err := f.owner.Exec(ctx, `UPDATE store.listings SET transferable = $2 WHERE id = $1`, listingID, transferable); err != nil {
		t.Fatalf("marking the listing transferable: %v", err)
	}
	batchID := uuid.New()
	if err := f.minter.RequestBatch(ctx, issue.BatchRequest{
		ID: batchID, ListingID: listingID, SupplierBusinessID: merchantID,
		RequestedBy: "staff-1", Quantity: 1, FundingReference: "test",
	}); err != nil {
		t.Fatalf("RequestBatch: %v", err)
	}
	if err := f.minter.Approve(ctx, batchID, "staff-2"); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	if _, err := f.minter.Mint(ctx, batchID); err != nil {
		t.Fatalf("Mint: %v", err)
	}
	saga := uuid.NewString()
	reserved, err := f.minter.Reserve(ctx, listingID, saga)
	if err != nil {
		t.Fatalf("Reserve: %v", err)
	}
	ownerID = uuid.New()
	if _, err := f.minter.ActivateReservation(ctx, saga, ownerID); err != nil {
		t.Fatalf("Activate: %v", err)
	}
	return reserved.VoucherID, ownerID
}

func (f *fixture) voucherState(t *testing.T, id uuid.UUID) (state string, owner *uuid.UUID, reason *string) {
	t.Helper()
	if err := f.owner.QueryRow(context.Background(),
		`SELECT state, owner_id, void_reason FROM voucher.vouchers WHERE id = $1`, id).Scan(&state, &owner, &reason); err != nil {
		t.Fatalf("reading voucher %s: %v", id, err)
	}
	return state, owner, reason
}

func (f *fixture) giftVoucher(t *testing.T, giftID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := f.owner.QueryRow(context.Background(), `SELECT voucher_id FROM voucher.gift WHERE id = $1`, giftID).Scan(&id); err != nil {
		t.Fatalf("reading gift %s: %v", giftID, err)
	}
	return id
}

func TestGiftVoidsAndRemintsThenTheRecipientAccepts(t *testing.T) {
	f := newFixture(t)
	f.minter.WithGiftPolicy(noHoldback)
	ctx := context.Background()
	source, sender := f.ownedTransferable(t, true)
	recipient := uuid.New()

	oldCode, err := f.minter.Reveal(ctx, source)
	if err != nil {
		t.Fatalf("Reveal: %v", err)
	}
	giftID, err := f.minter.Gift(ctx, issue.GiftRequest{VoucherID: source, SenderID: sender, RecipientID: recipient, RecipientRegion: "ID"})
	if err != nil {
		t.Fatalf("Gift: %v", err)
	}

	if state, _, reason := f.voucherState(t, source); state != "voided" || reason == nil || *reason != string(lifecycle.ReasonTransfer) {
		t.Fatalf("the old voucher is %s (%v), want voided by transfer", state, reason)
	}
	fresh := f.giftVoucher(t, giftID)
	if state, owner, _ := f.voucherState(t, fresh); state != "allocated" || owner != nil {
		t.Fatalf("the new voucher is %s owned by %v, want allocated to nobody", state, owner)
	}

	// A retry returns the same gift rather than refusing or gifting twice.
	if again, err := f.minter.Gift(ctx, issue.GiftRequest{VoucherID: source, SenderID: sender, RecipientID: recipient, RecipientRegion: "ID"}); err != nil || again != giftID {
		t.Fatalf("a retried gift = %s, %v; want %s", again, err, giftID)
	}

	if err := f.minter.AcceptGift(ctx, giftID, uuid.New()); !errors.Is(err, issue.ErrNotFound) {
		t.Fatalf("a stranger accepting = %v, want not found", err)
	}
	if err := f.minter.AcceptGift(ctx, giftID, recipient); err != nil {
		t.Fatalf("AcceptGift: %v", err)
	}
	if state, owner, _ := f.voucherState(t, fresh); state != "active" || owner == nil || *owner != recipient {
		t.Fatalf("after accepting, the new voucher is %s owned by %v", state, owner)
	}
	newCode, err := f.minter.Reveal(ctx, fresh)
	if err != nil || newCode == oldCode {
		t.Fatalf("the new code must differ from the old one (%v)", err)
	}
	for _, id := range []uuid.UUID{source, fresh} {
		if err := f.minter.VerifyChain(ctx, id); err != nil {
			t.Fatalf("VerifyChain(%s): %v", id, err)
		}
	}

	// One hop: the recipient cannot pass it on.
	if _, err := f.minter.Gift(ctx, issue.GiftRequest{VoucherID: fresh, SenderID: recipient, RecipientID: uuid.New(), RecipientRegion: "ID"}); !errors.Is(err, issue.ErrAlreadyGifted) {
		t.Fatalf("a second hop = %v, want ErrAlreadyGifted", err)
	}
	if err := f.minter.AcceptGift(ctx, giftID, recipient); !errors.Is(err, issue.ErrGiftNotPending) {
		t.Fatalf("accepting twice = %v, want ErrGiftNotPending", err)
	}
}

func TestGiftRefusals(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	f.minter.WithGiftPolicy(noHoldback)
	plain, owner := f.ownedTransferable(t, false)
	if _, err := f.minter.Gift(ctx, issue.GiftRequest{VoucherID: plain, SenderID: owner, RecipientID: uuid.New(), RecipientRegion: "ID"}); !errors.Is(err, issue.ErrNotTransferable) {
		t.Fatalf("a non-transferable voucher = %v", err)
	}

	source, sender := f.ownedTransferable(t, true)
	cases := map[string]struct {
		req  issue.GiftRequest
		want error
	}{
		"cross-region": {issue.GiftRequest{VoucherID: source, SenderID: sender, RecipientID: uuid.New(), RecipientRegion: "AU"}, issue.ErrGiftRegion},
		"to self":      {issue.GiftRequest{VoucherID: source, SenderID: sender, RecipientID: sender, RecipientRegion: "ID"}, issue.ErrGiftToSelf},
		"not theirs":   {issue.GiftRequest{VoucherID: source, SenderID: uuid.New(), RecipientID: uuid.New(), RecipientRegion: "ID"}, issue.ErrNotFound},
	}
	for name, c := range cases {
		if _, err := f.minter.Gift(ctx, c.req); !errors.Is(err, c.want) {
			t.Errorf("%s = %v, want %v", name, err, c.want)
		}
	}

	f.minter.WithGiftPolicy(issue.DefaultGiftPolicy)
	if _, err := f.minter.Gift(ctx, issue.GiftRequest{VoucherID: source, SenderID: sender, RecipientID: uuid.New(), RecipientRegion: "ID"}); !errors.Is(err, issue.ErrHoldback) {
		t.Fatalf("a voucher bought just now = %v, want ErrHoldback", err)
	}

	f.minter.WithGiftPolicy(issue.GiftPolicy{SentPerDay: 0, SentPerMonth: 10, ReceivedPerDay: 5, AcceptWindow: noHoldback.AcceptWindow})
	if _, err := f.minter.Gift(ctx, issue.GiftRequest{VoucherID: source, SenderID: sender, RecipientID: uuid.New(), RecipientRegion: "ID"}); !errors.Is(err, issue.ErrGiftVelocity) {
		t.Fatalf("over the daily cap = %v, want ErrGiftVelocity", err)
	}
}

func TestDeclinedAndExpiredGiftsGoBackToTheSender(t *testing.T) {
	f := newFixture(t)
	f.minter.WithGiftPolicy(noHoldback)
	ctx := context.Background()

	source, sender := f.ownedTransferable(t, true)
	recipient := uuid.New()
	giftID, err := f.minter.Gift(ctx, issue.GiftRequest{VoucherID: source, SenderID: sender, RecipientID: recipient, RecipientRegion: "ID"})
	if err != nil {
		t.Fatalf("Gift: %v", err)
	}
	if err := f.minter.DeclineGift(ctx, giftID, recipient); err != nil {
		t.Fatalf("DeclineGift: %v", err)
	}
	back := f.giftVoucher(t, giftID)
	if state, owner, _ := f.voucherState(t, back); state != "active" || owner == nil || *owner != sender {
		t.Fatalf("a declined gift is %s owned by %v, want active with the sender", state, owner)
	}

	// A returned gift was never received, so it can be gifted again.
	second, err := f.minter.Gift(ctx, issue.GiftRequest{VoucherID: back, SenderID: sender, RecipientID: recipient, RecipientRegion: "ID"})
	if err != nil {
		t.Fatalf("re-gifting a returned voucher: %v", err)
	}
	if _, err := f.owner.Exec(ctx, `UPDATE voucher.gift SET expires_at = now() - interval '1 minute' WHERE id = $1`, second); err != nil {
		t.Fatalf("ageing the gift: %v", err)
	}
	if err := f.minter.AcceptGift(ctx, second, recipient); !errors.Is(err, issue.ErrGiftWindowClosed) {
		t.Fatalf("accepting late = %v, want ErrGiftWindowClosed", err)
	}
	if n, err := f.minter.SweepGifts(ctx); err != nil || n < 1 {
		t.Fatalf("SweepGifts = %d, %v", n, err)
	}
	if state, owner, _ := f.voucherState(t, f.giftVoucher(t, second)); state != "active" || owner == nil || *owner != sender {
		t.Fatalf("an expired gift is %s owned by %v, want active with the sender", state, owner)
	}
}

func TestTwoGiftsOfOneVoucherRaceToOneWinner(t *testing.T) {
	f := newFixture(t)
	f.minter.WithGiftPolicy(noHoldback)
	ctx := context.Background()
	source, sender := f.ownedTransferable(t, true)

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = f.minter.Gift(ctx, issue.GiftRequest{VoucherID: source, SenderID: sender, RecipientID: uuid.New(), RecipientRegion: "ID"})
		}(i)
	}
	wg.Wait()
	ok := 0
	for _, err := range errs {
		if err == nil {
			ok++
		} else if !errors.Is(err, issue.ErrNotUnused) {
			t.Errorf("the losing gift failed with %v, want ErrNotUnused", err)
		}
	}
	if ok != 1 {
		t.Fatalf("%d gifts succeeded, want exactly 1 (%v)", ok, errs)
	}
}

// 13.10's count reads a gift as one transferred voucher and one active one.
func TestGiftCountsOnceInMerchantStatus(t *testing.T) {
	f := newFixture(t)
	f.minter.WithGiftPolicy(noHoldback)
	ctx := context.Background()
	source, sender := f.ownedTransferable(t, true)
	recipient := uuid.New()
	giftID, err := f.minter.Gift(ctx, issue.GiftRequest{VoucherID: source, SenderID: sender, RecipientID: recipient, RecipientRegion: "ID"})
	if err != nil {
		t.Fatalf("Gift: %v", err)
	}
	var merchant uuid.UUID
	if err := f.owner.QueryRow(ctx, `SELECT merchant_id FROM voucher.vouchers WHERE id = $1`, source).Scan(&merchant); err != nil {
		t.Fatalf("reading the merchant: %v", err)
	}
	count := func() map[string]int64 {
		rows, err := sqlcgen.New(f.pool).CountMerchantVouchersByStatus(ctx, sqlcgen.CountMerchantVouchersByStatusParams{
			MerchantID: pgtype.UUID{Bytes: merchant, Valid: true}, Region: "ID",
		})
		if err != nil {
			t.Fatalf("counting: %v", err)
		}
		got := map[string]int64{}
		for _, row := range rows {
			got[row.Status] = row.VoucherCount
		}
		return got
	}
	if got := count(); got["transferred"] != 1 || got["active"] != 0 {
		t.Fatalf("while pending: %v, want only the transferred one", got)
	}
	if err := f.minter.AcceptGift(ctx, giftID, recipient); err != nil {
		t.Fatalf("AcceptGift: %v", err)
	}
	if got := count(); got["transferred"] != 1 || got["active"] != 1 {
		t.Fatalf("after accepting: %v, want one transferred and one active", got)
	}
	rows, _ := sqlcgen.New(f.pool).CountMerchantVouchersByStatus(ctx, sqlcgen.CountMerchantVouchersByStatusParams{
		MerchantID: pgtype.UUID{Bytes: merchant, Valid: true}, Region: "AU",
	})
	if len(rows) != 0 {
		t.Fatalf("the other region sees %v", rows)
	}
}
