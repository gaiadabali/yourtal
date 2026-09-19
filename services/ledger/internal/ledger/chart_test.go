package ledger_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// YT-0043. The posting rules are the part worth testing: a pattern written
// in prose is one every caller re-derives, and re-derivation is where a sign
// flips.

func sum(entries []ledger.Entry) int64 {
	var total int64
	for _, entry := range entries {
		total += entry.AmountMinor
	}
	return total
}

func TestEveryPostingRuleBalances(t *testing.T) {
	rules := map[string][]ledger.Entry{
		"earn":      ledger.EarnPoints("u1", 2_400),
		"burn":      ledger.BurnPoints("u1", 500),
		"expire":    ledger.ExpirePoints("u1", 120),
		"marketing": ledger.IssueMarketingPoints("u1", 1_000),
		"suspense":  ledger.ToSuspense("usr_pts_u1", 75),
	}

	for name, entries := range rules {
		t.Run(name, func(t *testing.T) {
			if len(entries) < 2 {
				t.Fatalf("%s produced %d entries; double-entry needs two sides", name, len(entries))
			}
			if got := sum(entries); got != 0 {
				t.Errorf("%s sums to %d, want 0", name, got)
			}
		})
	}
}

func TestEveryPostingRuleUsesPoints(t *testing.T) {
	// A transfer may not mix currencies (the YT-0518 trigger). These rules
	// all move points, so an entry tagged IDR here would be refused at
	// COMMIT — better to catch it as a unit test than as a 3am constraint
	// violation.
	for _, entries := range [][]ledger.Entry{
		ledger.EarnPoints("u1", 10),
		ledger.BurnPoints("u1", 10),
		ledger.ExpirePoints("u1", 10),
		ledger.IssueMarketingPoints("u1", 10),
	} {
		for _, entry := range entries {
			if entry.Currency != string(ledger.CurrencyPoints) {
				t.Errorf("entry on %s is %s, want YTP", entry.AccountID, entry.Currency)
			}
		}
	}
}

func TestEarningIncreasesTheUserAndBurningDecreasesIt(t *testing.T) {
	// The direction matters more than the balance: a rule that balanced but
	// moved value the wrong way would pass every structural check and steal
	// from the user.
	userAccount := ledger.UserPointsAccountID("u1")

	earn := ledger.EarnPoints("u1", 300)
	if amountOn(earn, userAccount) != 300 {
		t.Errorf("earn credited %d to the user, want +300", amountOn(earn, userAccount))
	}

	burn := ledger.BurnPoints("u1", 300)
	if amountOn(burn, userAccount) != -300 {
		t.Errorf("burn moved %d on the user, want -300", amountOn(burn, userAccount))
	}
}

func TestFundedAndMarketingIssuanceAreDistinguishable(t *testing.T) {
	// Both credit the user identically. If they also debited the same
	// account, marketing spend would be indistinguishable from
	// advertiser-funded issuance in every report that matters — which is the
	// whole reason these are two rules.
	funded := ledger.EarnPoints("u1", 500)
	marketing := ledger.IssueMarketingPoints("u1", 500)

	if amountOn(funded, ledger.AccountPointsIssued) == 0 {
		t.Error("funded issuance should touch the issued-points contra account")
	}
	if amountOn(marketing, ledger.AccountMarketingExpense) == 0 {
		t.Error("marketing issuance should touch the marketing expense account")
	}
	if amountOn(marketing, ledger.AccountPointsIssued) != 0 {
		t.Error("marketing issuance must not post to the funded-issuance account")
	}
}

func TestBurningRecognisesNoRevenue(t *testing.T) {
	// Spending points does not earn the platform anything: the obligation
	// changed shape (points owed becomes a voucher owed), it did not vanish.
	// Only expiry turns an obligation into income.
	burn := ledger.BurnPoints("u1", 400)
	if amountOn(burn, ledger.AccountBreakageRevenue) != 0 {
		t.Error("a burn posted to breakage revenue; only expiry recognises revenue")
	}

	expire := ledger.ExpirePoints("u1", 400)
	if amountOn(expire, ledger.AccountBreakageRevenue) != 400 {
		t.Error("expiry should recognise breakage revenue")
	}
}

func TestPostingRulesOnlyReferenceTheChart(t *testing.T) {
	known := map[string]bool{}
	for _, account := range ledger.PlatformChart("ID") {
		known[account.ID] = true
	}

	for _, entries := range [][]ledger.Entry{
		ledger.EarnPoints("u1", 1),
		ledger.BurnPoints("u1", 1),
		ledger.ExpirePoints("u1", 1),
		ledger.IssueMarketingPoints("u1", 1),
		ledger.ToSuspense(ledger.UserPointsAccountID("u1"), 1),
	} {
		for _, entry := range entries {
			if strings.HasPrefix(entry.AccountID, "usr_pts_") {
				continue
			}
			if !known[entry.AccountID] {
				t.Errorf("posting rule references %q, which PlatformChart does not create",
					entry.AccountID)
			}
		}
	}
}

// The chart has to be creatable in the real database, with the constraints
// the YT-0043 migration added. A taxonomy the schema rejects is a taxonomy
// that does not exist.
func TestPlatformChartIsAcceptedByPostgres(t *testing.T) {
	_, pool := newLedger(t)
	ctx := context.Background()
	queries := sqlcgen.New(pool)

	for _, account := range ledger.PlatformChart("ID") {
		if err := queries.InsertAccount(ctx, sqlcgen.InsertAccountParams{
			ID:        account.ID,
			OwnerType: string(account.OwnerType),
			OwnerID:   account.OwnerID,
			Currency:  string(account.Currency),
			Kind:      string(account.Kind),
			Country:   account.Country,
		}); err != nil {
			t.Errorf("Postgres rejected %s: %v", account.ID, err)
		}
	}
}

func TestPostgresRejectsAnUnknownAccountKind(t *testing.T) {
	_, pool := newLedger(t)

	_, err := pool.Exec(context.Background(),
		`INSERT INTO ledger.account (id, owner_type, owner_id, currency, kind, country)
		 VALUES ($1,'platform','platform','YTP','goodwill','ID')`, unique("acc_bad_kind"))

	if err == nil {
		t.Fatal("Postgres accepted an account kind outside docs/02 §6's five")
	}
	if !strings.Contains(err.Error(), "account_kind_known") {
		t.Errorf("rejected for the wrong reason: %v", err)
	}
}

func TestPostgresRejectsAnUnknownCurrency(t *testing.T) {
	_, pool := newLedger(t)

	_, err := pool.Exec(context.Background(),
		`INSERT INTO ledger.account (id, owner_type, owner_id, currency, kind, country)
		 VALUES ($1,'platform','platform','USD','equity','ID')`, unique("acc_bad_ccy"))

	if err == nil {
		t.Fatal("Postgres accepted a currency outside YTP/IDR/AUD")
	}
	if !strings.Contains(err.Error(), "account_currency_known") {
		t.Errorf("rejected for the wrong reason: %v", err)
	}
}

// YT-0518 made uniqueness (owner_type, owner_id, currency), which is right
// for a user and wrong for the platform. Both halves are asserted, because a
// correction that over-corrects is as bad as the original.
func TestOneAccountPerUserPerCurrency(t *testing.T) {
	_, pool := newLedger(t)
	ctx := context.Background()
	queries := sqlcgen.New(pool)

	userID := unique("usr")
	first := ledger.UserPointsAccount(userID, "ID")
	if err := queries.InsertAccount(ctx, sqlcgen.InsertAccountParams{
		ID: first.ID, OwnerType: string(first.OwnerType), OwnerID: first.OwnerID,
		Currency: string(first.Currency), Kind: string(first.Kind), Country: first.Country,
	}); err != nil {
		t.Fatalf("first user account: %v", err)
	}

	// A second points account for the same person would make "their balance"
	// an ambiguous question.
	_, err := pool.Exec(ctx,
		`INSERT INTO ledger.account (id, owner_type, owner_id, currency, kind, country)
		 VALUES ($1,'user',$2,'YTP','liability','ID')`, unique("usr_pts_dup"), userID)

	if err == nil {
		t.Error("Postgres allowed a second points account for one user")
	}
}

func TestThePlatformMayHoldManyPointsAccounts(t *testing.T) {
	// The half YT-0518 got wrong. A chart of accounts IS several accounts
	// for one owner in one currency; a rule forbidding that forbids the
	// chart.
	_, pool := newLedger(t)
	ctx := context.Background()
	queries := sqlcgen.New(pool)

	for _, account := range ledger.PlatformChart("ID") {
		if err := queries.InsertAccount(ctx, sqlcgen.InsertAccountParams{
			ID: account.ID, OwnerType: string(account.OwnerType), OwnerID: account.OwnerID,
			Currency: string(account.Currency), Kind: string(account.Kind),
			Country: account.Country,
		}); err != nil {
			t.Fatalf("%s: %v", account.ID, err)
		}
	}

	var platformPointsAccounts int
	if err := pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM ledger.account
		  WHERE owner_id = 'platform' AND currency = 'YTP'`).Scan(&platformPointsAccounts); err != nil {
		t.Fatalf("count: %v", err)
	}
	if platformPointsAccounts < 4 {
		t.Errorf("platform holds %d points accounts, want the whole chart", platformPointsAccounts)
	}
}

func amountOn(entries []ledger.Entry, accountID string) int64 {
	for _, entry := range entries {
		if entry.AccountID == accountID {
			return entry.AmountMinor
		}
	}
	return 0
}

var _ = pgxpool.Pool{}
