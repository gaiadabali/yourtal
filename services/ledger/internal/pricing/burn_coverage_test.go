package pricing_test

import (
	"context"
	"testing"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/ledgertest"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// 4.9.c, D11: a burn moved points out of the liability and nowhere else, so
// the ratio ROSE while the platform still owed the voucher. Now the voucher's
// value is owed too, and a burn at S = points × B leaves coverage unchanged.
func TestABurnDoesNotFlatterCoverage(t *testing.T) {
	engine, pool := newEngine(t)
	ctx := context.Background()
	at := withRate(t, engine)
	book := ledger.New(pool)
	queries := sqlcgen.New(pool)

	user := unique("usr")
	for _, a := range append(ledger.PlatformChart(ledger.RegionAU), ledger.UserAccounts(user, ledger.RegionAU)...) {
		if err := queries.InsertAccount(ctx, sqlcgen.InsertAccountParams{ID: a.ID, OwnerType: string(a.OwnerType),
			OwnerID: a.OwnerID, Currency: string(a.Currency), Kind: string(a.Kind), Country: a.Country, Purpose: string(a.Purpose)}); err != nil {
			t.Fatal(err)
		}
	}
	post := func(entries []ledger.Entry) {
		t.Helper()
		if _, err := book.Transfer(ctx, ledger.TransferRequest{ID: unique("t"), IdempotencyKey: unique("k"),
			ReasonCode: "test", Entries: entries}); err != nil {
			t.Fatal(err)
		}
	}
	ledgertest.PartnerGrant(t, pool, ledger.RegionAU, user, 1_000)
	post(ledger.Release(user, 1_000))

	before, err := engine.Coverage(ctx, ledger.RegionAU, at)
	if err != nil {
		t.Fatal(err)
	}
	// 1,000 points at B = 3¢ burn into a voucher with S = AUD 30.00.
	post(ledger.BurnPoints(ledger.RegionAU, user, 1_000))
	post(ledger.BurnLiability(ledger.RegionAU, 3_000))
	after, err := engine.Coverage(ctx, ledger.RegionAU, at)
	if err != nil {
		t.Fatal(err)
	}
	if after.LiabilityMinor != before.LiabilityMinor || after.RatioBps != before.RatioBps {
		t.Errorf("a burn moved coverage: liability %d -> %d, ratio %d -> %d",
			before.LiabilityMinor, after.LiabilityMinor, before.RatioBps, after.RatioBps)
	}
}
