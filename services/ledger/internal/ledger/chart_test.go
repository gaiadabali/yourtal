package ledger_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// 4.2: the posting rules, one per row of the table in TASKS.md. A pattern
// written in prose is one every caller re-derives, and re-derivation is where
// a sign flips, so each rule's debit and credit are asserted here.

const au, id = ledger.RegionAU, ledger.RegionID

func plat(r ledger.Region, role ledger.Role) string { return ledger.PlatformAccountID(r, role) }

func usr(p ledger.Purpose) string { return ledger.UserAccountID("u1", p) }

func TestEveryPostingRuleDebitsAndCreditsTheRightAccounts(t *testing.T) {
	cases := []struct {
		name          string
		entries       []ledger.Entry
		debit, credit string
		currency      ledger.Currency
	}{
		{"purchase", ledger.Purchase(au, 700), plat(au, ledger.RoleReserve), plat(au, ledger.RolePartnerFunding), ledger.CurrencyAUD},
		{"fund marketing", ledger.FundMarketing(id, 900), plat(id, ledger.RoleMarketingCash), plat(id, ledger.RolePlatformEquity), ledger.CurrencyIDR},
		{"marketing backing", ledger.MarketingBacking(au, 15), plat(au, ledger.RoleReserve), plat(au, ledger.RoleMarketingCash), ledger.CurrencyAUD},
		{"partner grant", ledger.GrantPartner(au, "u1", 100), plat(au, ledger.RolePointsIssued), usr(ledger.PurposePending), ledger.CurrencyPoints},
		{"marketing grant", ledger.GrantMarketing(au, "u1", 5), plat(au, ledger.RoleMarketingExpense), usr(ledger.PurposePending), ledger.CurrencyPoints},
		{"release", ledger.Release("u1", 100), usr(ledger.PurposePending), usr(ledger.PurposeAvailable), ledger.CurrencyPoints},
		{"burn points", ledger.BurnPoints(au, "u1", 400), usr(ledger.PurposeAvailable), plat(au, ledger.RolePointsRedeemed), ledger.CurrencyPoints},
		{"burn liability", ledger.BurnLiability(au, 1_200), plat(au, ledger.RoleRedemptionClearing), plat(au, ledger.RoleVoucherLiability), ledger.CurrencyAUD},
		{"capture", ledger.Capture(au, "m1", 1_200), plat(au, ledger.RoleVoucherLiability), ledger.MerchantPayableID("m1", au), ledger.CurrencyAUD},
		{"refund", ledger.RefundCapture(au, "m1", 200), ledger.MerchantPayableID("m1", au), plat(au, ledger.RoleVoucherLiability), ledger.CurrencyAUD},
		{"payout", ledger.Payout(id, "m1", 30_000), ledger.MerchantPayableID("m1", id), plat(id, ledger.RoleReserve), ledger.CurrencyIDR},
		{"voucher expiry", ledger.VoucherExpiry(au, 300), plat(au, ledger.RoleVoucherLiability), plat(au, ledger.RoleRedemptionClearing), ledger.CurrencyAUD},
		{"points expiry", ledger.ExpirePoints(id, "u1", 50), usr(ledger.PurposeAvailable), plat(id, ledger.RoleBreakageRevenue), ledger.CurrencyPoints},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if len(c.entries) != 2 {
				t.Fatalf("%d entries, want 2", len(c.entries))
			}
			if amountOn(c.entries, c.debit) >= 0 {
				t.Errorf("%+v: want a debit (negative) on %s", c.entries, c.debit)
			}
			if amountOn(c.entries, c.credit) <= 0 {
				t.Errorf("%+v: want a credit (positive) on %s", c.entries, c.credit)
			}
			for _, e := range c.entries {
				if e.Currency != string(c.currency) {
					t.Errorf("entry on %s is %s, want %s", e.AccountID, e.Currency, c.currency)
				}
			}
			if sum(c.entries) != 0 {
				t.Errorf("sums to %d", sum(c.entries))
			}
		})
	}
}

func TestSuspendMovesBothBalancesToEscrowAndSkipsZeroLegs(t *testing.T) {
	both := ledger.Suspend("u1", 300, 200)
	if amountOn(both, usr(ledger.PurposeEscrow)) != 500 || sum(both) != 0 || len(both) != 3 {
		t.Errorf("suspend(300, 200) = %+v", both)
	}
	if onlyPending := ledger.Suspend("u1", 0, 200); len(onlyPending) != 2 {
		t.Errorf("a zero leg was kept: %+v", onlyPending)
	}
	if none := ledger.Suspend("u1", 0, 0); none != nil {
		t.Errorf("nothing to suspend produced %+v", none)
	}
}

func TestReverseIsTheExactInverse(t *testing.T) {
	original := ledger.Suspend("u1", 300, 200)
	back := ledger.Reverse(original)
	for i := range original {
		if back[i].AccountID != original[i].AccountID || back[i].AmountMinor != -original[i].AmountMinor {
			t.Errorf("entry %d: %+v does not invert %+v", i, back[i], original[i])
		}
	}
}

// Every account a rule names is one the chart creates, in the same region.
func TestPostingRulesOnlyReferenceTheChart(t *testing.T) {
	for _, region := range []ledger.Region{au, id} {
		known := map[string]string{}
		accounts := append(ledger.PlatformChart(region), ledger.UserAccounts("u1", region)...)
		accounts = append(accounts, ledger.MerchantPayable("m1", region))
		for _, a := range accounts {
			known[a.ID] = string(a.Currency)
		}
		for _, entries := range [][]ledger.Entry{
			ledger.Purchase(region, 1), ledger.FundMarketing(region, 1), ledger.MarketingBacking(region, 1),
			ledger.GrantPartner(region, "u1", 1), ledger.GrantMarketing(region, "u1", 1), ledger.Release("u1", 1),
			ledger.BurnPoints(region, "u1", 1), ledger.BurnLiability(region, 1), ledger.Capture(region, "m1", 1),
			ledger.Payout(region, "m1", 1), ledger.VoucherExpiry(region, 1), ledger.ExpirePoints(region, "u1", 1),
			ledger.Suspend("u1", 1, 1), ledger.ToSuspense(region, usr(ledger.PurposeAvailable), 1),
		} {
			for _, e := range entries {
				currency, ok := known[e.AccountID]
				if !ok {
					t.Errorf("%s: a rule references %q, which the chart does not create", region, e.AccountID)
				} else if currency != e.Currency {
					t.Errorf("%s: entry on %s is %s but the account holds %s", region, e.AccountID, e.Currency, currency)
				}
			}
		}
	}
}

func TestPlatformChartIsPerRegion(t *testing.T) {
	for _, a := range ledger.PlatformChart(au) {
		if !strings.HasPrefix(a.ID, "plat_AU_") || a.Country != "AU" {
			t.Errorf("AU chart holds %s in %s", a.ID, a.Country)
		}
		if a.Currency != ledger.CurrencyPoints && a.Currency != ledger.CurrencyAUD {
			t.Errorf("AU chart holds %s in %s", a.ID, a.Currency)
		}
	}
}

// The chart has to be creatable in the real database, under its constraints.
func TestBothChartsAreAcceptedByPostgres(t *testing.T) {
	_, pool := newLedger(t)
	for _, region := range []ledger.Region{au, id} {
		for _, a := range append(ledger.PlatformChart(region), ledger.UserAccounts(unique("u"), region)...) {
			insert(t, pool, a)
		}
		insert(t, pool, ledger.MerchantPayable(unique("m"), region))
	}
}

func TestPostgresRejectsAccountsOutsideTheChart(t *testing.T) {
	_, pool := newLedger(t)
	cases := []struct{ name, sql, constraint string }{
		{"unknown kind", `VALUES ($1,'platform','platform','YTP','goodwill','ID','main')`, "account_kind_known"},
		{"unknown currency", `VALUES ($1,'platform','platform','USD','equity','ID','main')`, "check constraint"},
		{"AUD in ID", `VALUES ($1,'platform','platform','AUD','asset','ID','main')`, "account_cash_in_its_region"},
		{"IDR in AU", `VALUES ($1,'platform','platform','IDR','asset','AU','main')`, "account_cash_in_its_region"},
		{"user without a points purpose", `VALUES ($1,'user','u9','YTP','liability','AU','main')`, "account_user_purpose"},
		{"platform with a user purpose", `VALUES ($1,'platform','platform','YTP','equity','AU','pending')`, "account_user_purpose"},
		{"payable not a merchant", `VALUES ($1,'platform','platform','AUD','liability','AU','payable')`, "account_payable_is_merchant"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := pool.Exec(context.Background(),
				`INSERT INTO ledger.account (id, owner_type, owner_id, currency, kind, country, purpose) `+c.sql,
				unique("acc"))
			if err == nil || !strings.Contains(err.Error(), c.constraint) {
				t.Errorf("want a %s violation, got %v", c.constraint, err)
			}
		})
	}
}

// One account per user per purpose: three points accounts, never two pending.
func TestOneAccountPerUserPerPurpose(t *testing.T) {
	_, pool := newLedger(t)
	user := unique("usr")
	for _, a := range ledger.UserAccounts(user, au) {
		insert(t, pool, a)
	}
	_, err := pool.Exec(context.Background(),
		`INSERT INTO ledger.account (id, owner_type, owner_id, currency, kind, country, purpose)
		 VALUES ($1,'user',$2,'YTP','liability','AU','pending')`, unique("dup"), user)
	if err == nil {
		t.Error("Postgres allowed a second pending account for one user")
	}
}

func TestATransferCannotCrossRegions(t *testing.T) {
	book, pool := newLedger(t)
	ctx := context.Background()
	for _, a := range append(ledger.PlatformChart(au), ledger.PlatformChart(id)...) {
		insert(t, pool, a)
	}
	// Unguarded contra accounts, so only the region wall can refuse it.
	_, err := book.Transfer(ctx, ledger.TransferRequest{
		ID: unique("t"), IdempotencyKey: unique("k"), ReasonCode: "test",
		Entries: []ledger.Entry{
			{AccountID: plat(au, ledger.RolePointsIssued), AmountMinor: -10, Currency: "YTP"},
			{AccountID: plat(id, ledger.RolePointsIssued), AmountMinor: 10, Currency: "YTP"},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "crosses regions") {
		t.Fatalf("an AU-to-ID transfer was not refused: %v", err)
	}
}

func TestAReversalMustInvertItsOriginalAndHappensOnce(t *testing.T) {
	book, pool := newLedger(t)
	ctx := context.Background()
	user := unique("u")
	for _, a := range append(ledger.PlatformChart(au), ledger.UserAccounts(user, au)...) {
		insert(t, pool, a)
	}
	grant := ledger.GrantPartner(au, user, 100)
	original, err := book.Transfer(ctx, ledger.TransferRequest{
		ID: unique("t"), IdempotencyKey: unique("k"), ReasonCode: "grant", Entries: grant,
	})
	if err != nil {
		t.Fatal(err)
	}
	reverse := func(entries []ledger.Entry) error {
		_, err := book.Transfer(ctx, ledger.TransferRequest{
			ID: unique("t"), IdempotencyKey: unique("k"), ReasonCode: "reversal",
			Entries: entries, Reverses: original.TransferID,
		})
		return err
	}
	if err := reverse(ledger.GrantPartner(au, user, 60)); !errors.Is(err, ledger.ErrNotInverse) {
		t.Fatalf("a partial reversal: err = %v, want ErrNotInverse", err)
	}
	if err := reverse(ledger.Reverse(grant)); err != nil {
		t.Fatalf("the exact inverse: %v", err)
	}
	if err := reverse(ledger.Reverse(grant)); err == nil {
		t.Fatal("a transfer was reversed twice")
	}
	if b, _ := book.Balance(ctx, ledger.UserAccountID(user, ledger.PurposePending)); b != 0 {
		t.Errorf("pending = %d after the reversal, want 0", b)
	}
}

func insert(t *testing.T, pool *pgxpool.Pool, a ledger.Account) {
	t.Helper()
	if err := sqlcgen.New(pool).InsertAccount(context.Background(), sqlcgen.InsertAccountParams{
		ID: a.ID, OwnerType: string(a.OwnerType), OwnerID: a.OwnerID, Currency: string(a.Currency),
		Kind: string(a.Kind), Country: a.Country, Purpose: string(a.Purpose),
	}); err != nil {
		t.Fatalf("Postgres rejected %s: %v", a.ID, err)
	}
}

func sum(entries []ledger.Entry) int64 {
	var total int64
	for _, e := range entries {
		total += e.AmountMinor
	}
	return total
}

func amountOn(entries []ledger.Entry, accountID string) int64 {
	for _, e := range entries {
		if e.AccountID == accountID {
			return e.AmountMinor
		}
	}
	return 0
}
