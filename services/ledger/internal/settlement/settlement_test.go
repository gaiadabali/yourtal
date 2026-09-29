package settlement_test

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/capture"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/settlement"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
	"github.com/yourtal/services/ledger/internal/testdb"
)

var counter atomic.Uint64

func unique(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano(), counter.Add(1))
}

type fixture struct {
	settlement *settlement.Engine
	captures   *capture.Engine
	pool       *pgxpool.Pool
}

// newFixture mirrors internal/capture's own: the platform chart must exist
// for the posting rules' platform-side legs (voucher_liability, reserve, …).
func newFixture(t *testing.T) *fixture {
	t.Helper()
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testdb.URL(t, "LEDGER_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	for _, region := range []ledger.Region{ledger.RegionAU, ledger.RegionID} {
		for _, a := range ledger.PlatformChart(region) {
			if err := sqlcgen.New(pool).InsertAccount(ctx, sqlcgen.InsertAccountParams{
				ID: a.ID, OwnerType: string(a.OwnerType), OwnerID: a.OwnerID,
				Currency: string(a.Currency), Kind: string(a.Kind), Country: a.Country, Purpose: string(a.Purpose),
			}); err != nil {
				t.Fatal(err)
			}
		}
	}

	book := ledger.New(pool)
	return &fixture{settlement: settlement.New(pool, book), captures: capture.New(pool, book), pool: pool}
}

// window returns a [from, to) that covers "right now", fixed once so every
// call in a test agrees on the same period — GenerateOrGet's idempotency key
// is (business, region, from, to), and time.Now() moves between calls.
func window() (time.Time, time.Time) {
	now := time.Now().UTC()
	return now.Add(-time.Hour), now.Add(time.Hour)
}

func TestStatementComputesFromLedgerEntriesAndIsIdempotent(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	merchantID := unique("mer")
	from, to := window()

	if _, err := f.captures.Post(ctx, capture.Request{
		CaptureID: unique("cap"), Region: ledger.RegionAU, MerchantID: merchantID, AmountMinor: 5_000, Currency: "AUD",
	}); err != nil {
		t.Fatalf("Post: %v", err)
	}

	stmt, err := f.settlement.GenerateOrGet(ctx, merchantID, ledger.RegionAU, from, to)
	if err != nil {
		t.Fatalf("GenerateOrGet: %v", err)
	}
	if stmt.OpeningPayableMinor != 0 || stmt.CapturesMinor != 5_000 || stmt.RefundsMinor != 0 ||
		stmt.RecoveriesMinor != 0 || stmt.ClosingPayableMinor != 5_000 {
		t.Errorf("statement = %+v, want opening 0, captures 5000, closing 5000", stmt)
	}
	if stmt.Status != "open" {
		t.Errorf("status = %q, want open", stmt.Status)
	}

	again, err := f.settlement.GenerateOrGet(ctx, merchantID, ledger.RegionAU, from, to)
	if err != nil {
		t.Fatalf("GenerateOrGet (again): %v", err)
	}
	if again.ID != stmt.ID {
		t.Errorf("a second call for the same period generated a new statement: %s vs %s", again.ID, stmt.ID)
	}

	match, _, err := f.settlement.Recompute(ctx, stmt.ID)
	if err != nil {
		t.Fatalf("Recompute: %v", err)
	}
	if !match {
		t.Error("a fresh recomputation from ledger entries does not match the stored statement")
	}
}

func TestApprovePayoutRefusesInsideTheWindowThenMovesPayableAndReserve(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	merchantID := unique("mer")
	from, to := window()

	if _, err := f.captures.Post(ctx, capture.Request{
		CaptureID: unique("cap"), Region: ledger.RegionAU, MerchantID: merchantID, AmountMinor: 7_000, Currency: "AUD",
	}); err != nil {
		t.Fatalf("Post: %v", err)
	}
	stmt, err := f.settlement.GenerateOrGet(ctx, merchantID, ledger.RegionAU, from, to)
	if err != nil {
		t.Fatalf("GenerateOrGet: %v", err)
	}

	insideWindow := stmt.DisputeWindowEndsAt.Add(-time.Minute)
	if _, err := f.settlement.ApprovePayout(ctx, stmt.ID, "staff-1", insideWindow); !errors.Is(err, settlement.ErrDisputeWindowOpen) {
		t.Fatalf("approving inside the dispute window: %v, want ErrDisputeWindowOpen", err)
	}

	pastWindow := stmt.DisputeWindowEndsAt.Add(time.Minute)
	book := ledger.New(f.pool)
	payableBefore, _ := book.Balance(ctx, ledger.MerchantPayableID(merchantID, ledger.RegionAU))
	reserveBefore, _ := book.Balance(ctx, ledger.PlatformAccountID(ledger.RegionAU, ledger.RoleReserve))

	paid, err := f.settlement.ApprovePayout(ctx, stmt.ID, "staff-1", pastWindow)
	if err != nil {
		t.Fatalf("ApprovePayout: %v", err)
	}
	if paid.Status != "paid" || paid.PayoutTransferID == nil {
		t.Errorf("statement = %+v, want status paid with a transfer id", paid)
	}

	payableAfter, _ := book.Balance(ctx, ledger.MerchantPayableID(merchantID, ledger.RegionAU))
	reserveAfter, _ := book.Balance(ctx, ledger.PlatformAccountID(ledger.RegionAU, ledger.RoleReserve))
	if payableBefore-payableAfter != stmt.ClosingPayableMinor {
		t.Errorf("payable dropped by %d, want %d", payableBefore-payableAfter, stmt.ClosingPayableMinor)
	}
	if reserveBefore-reserveAfter != stmt.ClosingPayableMinor {
		t.Errorf("reserve dropped by %d, want %d", reserveBefore-reserveAfter, stmt.ClosingPayableMinor)
	}

	if _, err := f.settlement.ApprovePayout(ctx, stmt.ID, "staff-2", pastWindow); !errors.Is(err, settlement.ErrNotOpen) {
		t.Errorf("approving an already-paid statement: %v, want ErrNotOpen", err)
	}
}

func TestDisputeHoldsThePayoutUntilResolved(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	merchantID := unique("mer")
	from, to := window()

	if _, err := f.captures.Post(ctx, capture.Request{
		CaptureID: unique("cap"), Region: ledger.RegionAU, MerchantID: merchantID, AmountMinor: 4_000, Currency: "AUD",
	}); err != nil {
		t.Fatalf("Post: %v", err)
	}
	stmt, err := f.settlement.GenerateOrGet(ctx, merchantID, ledger.RegionAU, from, to)
	if err != nil {
		t.Fatalf("GenerateOrGet: %v", err)
	}
	pastWindow := stmt.DisputeWindowEndsAt.Add(time.Minute)

	disputed, err := f.settlement.Dispute(ctx, stmt.ID, "amount looks wrong")
	if err != nil {
		t.Fatalf("Dispute: %v", err)
	}
	if disputed.Status != "disputed" {
		t.Fatalf("status = %q, want disputed", disputed.Status)
	}

	if _, err := f.settlement.ApprovePayout(ctx, stmt.ID, "staff-1", pastWindow); !errors.Is(err, settlement.ErrNotOpen) {
		t.Errorf("approving a disputed statement past its window: %v, want ErrNotOpen", err)
	}
	if _, err := f.settlement.Dispute(ctx, stmt.ID, "again"); !errors.Is(err, settlement.ErrNotOpen) {
		t.Errorf("disputing an already-disputed statement: %v, want ErrNotOpen", err)
	}

	resolved, err := f.settlement.Resolve(ctx, stmt.ID, "recovery line posted; released")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if resolved.Status != "open" {
		t.Fatalf("status after resolving = %q, want open", resolved.Status)
	}

	if _, err := f.settlement.ApprovePayout(ctx, stmt.ID, "staff-1", pastWindow); err != nil {
		t.Errorf("approving a resolved statement past its window: %v", err)
	}
}

func TestPostCaptureRecoveryReversesOnceAndFeedsTheNextStatement(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	merchantID := unique("mer")
	captureID := unique("cap")
	from, to := window()

	if _, err := f.captures.Post(ctx, capture.Request{
		CaptureID: captureID, Region: ledger.RegionAU, MerchantID: merchantID, AmountMinor: 5_000, Currency: "AUD",
	}); err != nil {
		t.Fatalf("Post: %v", err)
	}

	recovery, err := f.settlement.PostCaptureRecovery(ctx, captureID, "K13: voucher not honoured")
	if err != nil {
		t.Fatalf("PostCaptureRecovery: %v", err)
	}
	if recovery.AmountMinor != 5_000 {
		t.Errorf("recovery amount = %d, want 5000 (the full capture)", recovery.AmountMinor)
	}

	// Idempotent: a second resolution of the same capture posts nothing more.
	again, err := f.settlement.PostCaptureRecovery(ctx, captureID, "K13: voucher not honoured")
	if err != nil {
		t.Fatalf("PostCaptureRecovery (again): %v", err)
	}
	if again.ID != recovery.ID {
		t.Errorf("recovering the same capture twice posted a second line: %s vs %s", again.ID, recovery.ID)
	}

	balance, err := ledger.New(f.pool).Balance(ctx, ledger.MerchantPayableID(merchantID, ledger.RegionAU))
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if balance != 0 {
		t.Errorf("merchant payable balance = %d, want 0 (5000 captured, 5000 recovered, once)", balance)
	}

	stmt, err := f.settlement.GenerateOrGet(ctx, merchantID, ledger.RegionAU, from, to)
	if err != nil {
		t.Fatalf("GenerateOrGet: %v", err)
	}
	if stmt.CapturesMinor != 5_000 || stmt.RecoveriesMinor != 5_000 || stmt.ClosingPayableMinor != 0 {
		t.Errorf("statement = %+v, want captures 5000, recoveries 5000, closing 0", stmt)
	}
}

func TestReleaseVoucherLiabilityUnwindsWithNoMerchantLegAndReplaysIdempotently(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	key := unique("expire")
	book := ledger.New(f.pool)
	accountID := ledger.PlatformAccountID(ledger.RegionAU, ledger.RoleVoucherLiability)

	// Delta, not an absolute balance: this account is shared platform-wide,
	// so other tests in this package post to it too (captures debit it,
	// recoveries credit it back).
	before, err := book.Balance(ctx, accountID)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}

	transferID, err := f.settlement.ReleaseVoucherLiability(ctx, key, ledger.RegionAU, 3_000)
	if err != nil {
		t.Fatalf("ReleaseVoucherLiability: %v", err)
	}
	if transferID == "" {
		t.Fatal("no transfer id recorded")
	}

	after, err := book.Balance(ctx, accountID)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	if before-after != 3_000 {
		t.Errorf("voucher_liability dropped by %d, want 3000 (nothing was ever paid to a merchant)", before-after)
	}

	replay, err := f.settlement.ReleaseVoucherLiability(ctx, key, ledger.RegionAU, 3_000)
	if err != nil {
		t.Fatalf("ReleaseVoucherLiability (replay): %v", err)
	}
	if replay != transferID {
		t.Errorf("replaying the same key posted a new transfer: %s vs %s", replay, transferID)
	}
	afterReplay, _ := book.Balance(ctx, accountID)
	if afterReplay != after {
		t.Errorf("a replay changed the balance: %d vs %d", afterReplay, after)
	}
}
