package ledger

import "fmt"

// The chart of accounts. YT-0043.
//
// # Classification, not valuation
//
// This file says what an account IS. It never says what one is worth. Points
// liability is points liability whether an IDR integer turns out to be a
// rupiah or a sen (YT-0506) — but the moment anything here multiplied by a
// backing rate, it would be pricing, and pricing is where that open question
// actually bites. There is no rate, no coverage ratio and no currency-per-
// point arithmetic anywhere in this package, and that is deliberate.
//
// # Why points are a currency
//
// docs/02 §6 gives the ledger three currencies: YTP, IDR, AUD. Points being
// a first-class currency rather than a number in a different table is what
// makes "a transfer may not mix currencies" meaningful — an entry that moves
// points and an entry that moves Rupiah cannot accidentally sum together,
// because the trigger refuses the transfer outright.

// AccountKind is the accounting classification (docs/02 §6).
type AccountKind string

const (
	// KindAsset — something the platform holds. Advertiser pre-purchase cash
	// sits here until it is drawn down.
	KindAsset AccountKind = "asset"
	// KindLiability — something the platform owes. A user's points balance
	// is the central one: points are a claim on us, not our property.
	KindLiability AccountKind = "liability"
	// KindRevenue — income. Breakage lands here when points expire unspent.
	KindRevenue AccountKind = "revenue"
	// KindExpense — cost. Points the platform issues without an advertiser
	// funding them are marketing spend, and calling them anything else is
	// how a marketing budget hides inside a liability.
	KindExpense AccountKind = "expense"
	// KindEquity — the residual.
	KindEquity AccountKind = "equity"
)

// OwnerType is who an account belongs to (docs/02 §6).
type OwnerType string

const (
	OwnerUser     OwnerType = "user"
	OwnerMerchant OwnerType = "merchant"
	OwnerPlatform OwnerType = "platform"
	OwnerEscrow   OwnerType = "escrow"
	OwnerCharity  OwnerType = "charity"
	// OwnerSuspense holds a leg whose real counterparty is not yet known.
	// It has to exist: the alternative is a transfer that does not balance,
	// and an unbalanced transfer cannot be written at all. A suspense
	// balance is therefore a work queue, not an error state — but a
	// non-zero one at close of day is something finance must resolve.
	OwnerSuspense OwnerType = "suspense"
	// OwnerReserve holds funds backing points in circulation.
	OwnerReserve OwnerType = "reserve"
)

// Currency in the ledger sense. Points are one.
type Currency string

const (
	CurrencyPoints Currency = "YTP"
	CurrencyIDR    Currency = "IDR"
	CurrencyAUD    Currency = "AUD"
)

// Canonical platform account ids. Fixed strings rather than lookups, because
// a posting rule that has to search for its own account is a posting rule
// that can silently post to the wrong one.
const (
	// AccountPointsIssued is the contra account for every point that enters
	// circulation. Its balance mirrors the sum of all user balances with the
	// opposite sign — which is not a coincidence to be maintained but an
	// arithmetic consequence of double entry.
	AccountPointsIssued = "plat_points_issued"
	// AccountPointsRedeemed absorbs points burned in the store.
	AccountPointsRedeemed = "plat_points_redeemed"
	// AccountBreakageRevenue absorbs points that expired unspent.
	AccountBreakageRevenue = "plat_breakage_revenue"
	// AccountMarketingExpense funds points the platform issues itself.
	AccountMarketingExpense = "plat_marketing_expense"
	// AccountSuspense is the landing place described on OwnerSuspense.
	AccountSuspense = "plat_suspense"
)

// Cash accounts are per-currency, so their ids carry it. A single
// `plat_reserve` holding two currencies would be an account whose balance
// is a number with no unit — and the ledger already refuses to mix
// currencies inside a transfer for the same reason.
func ReserveAccountID(currency string) string { return fmt.Sprintf("plat_reserve_%s", currency) }

// PartnerFundingAccountID is the source side of a pre-purchase: the claim
// a partner has paid in, against which points are later issued.
func PartnerFundingAccountID(currency string) string {
	return fmt.Sprintf("plat_partner_funding_%s", currency)
}

// Account is one row of the chart.
type Account struct {
	ID        string
	OwnerType OwnerType
	OwnerID   string
	Kind      AccountKind
	Currency  Currency
	Country   string
}

// PlatformChart is every platform-owned account the posting rules below
// reference. A deployment creates these once; the rules assume they exist,
// and `TestPostingRulesOnlyReferenceTheChart` asserts none references an
// account that is not here.
func PlatformChart(country string) []Account {
	platform := func(id string, kind AccountKind) Account {
		return Account{
			ID: id, OwnerType: OwnerPlatform, OwnerID: "platform",
			Kind: kind, Currency: CurrencyPoints, Country: country,
		}
	}

	return []Account{
		platform(AccountPointsIssued, KindEquity),
		platform(AccountPointsRedeemed, KindEquity),
		platform(AccountBreakageRevenue, KindRevenue),
		platform(AccountMarketingExpense, KindExpense),
		{
			ID: AccountSuspense, OwnerType: OwnerSuspense, OwnerID: "platform",
			Kind: KindEquity, Currency: CurrencyPoints, Country: country,
		},
	}
}

// UserPointsAccount is a user's points balance — a LIABILITY, because points
// are a claim the user holds on the platform and not the platform's own
// money. Classifying them as anything else is how a growing obligation reads
// as a growing asset.
func UserPointsAccount(userID, country string) Account {
	return Account{
		ID:        UserPointsAccountID(userID),
		OwnerType: OwnerUser,
		OwnerID:   userID,
		Kind:      KindLiability,
		Currency:  CurrencyPoints,
		Country:   country,
	}
}

func UserPointsAccountID(userID string) string {
	return fmt.Sprintf("usr_pts_%s", userID)
}

// --- posting rules -------------------------------------------------------
//
// Each returns the entries for one flow. They are functions rather than
// documentation because a posting pattern written in prose is one every
// caller re-derives, and re-derivation is where a sign flips.
//
// Convention: a POSITIVE amount increases the account's balance. For a user
// points account (a liability) positive means the user holds more; for the
// contra accounts, the mirror. Every rule returns entries summing to zero,
// which the database then re-checks at COMMIT — belt and braces, in the one
// place where being wrong is money.

// EarnPoints — a user completed a campaign and is credited.
//
// The user's liability grows; the issued-points contra account moves the
// other way. Whether an advertiser funded this is NOT recorded here: the
// funding is a separate cash-side transfer, and conflating them is how you
// get a points ledger that cannot be reconciled against a bank statement.
func EarnPoints(userID string, points int64) []Entry {
	return []Entry{
		{AccountID: UserPointsAccountID(userID), AmountMinor: points, Currency: string(CurrencyPoints)},
		{AccountID: AccountPointsIssued, AmountMinor: -points, Currency: string(CurrencyPoints)},
	}
}

// BurnPoints — a user spent points in the store.
//
// The liability shrinks. Note what does NOT happen here: no revenue is
// recognised. The platform owes a voucher now instead of owing points; the
// obligation changed shape, it did not disappear.
func BurnPoints(userID string, points int64) []Entry {
	return []Entry{
		{AccountID: UserPointsAccountID(userID), AmountMinor: -points, Currency: string(CurrencyPoints)},
		{AccountID: AccountPointsRedeemed, AmountMinor: points, Currency: string(CurrencyPoints)},
	}
}

// ExpirePoints — breakage. Points expired unspent, so the liability is
// extinguished and the platform recognises revenue.
//
// This is the one flow that turns an obligation into income, which is
// exactly why it is a named posting rule and not an ad-hoc adjustment
// somebody writes at month end.
func ExpirePoints(userID string, points int64) []Entry {
	return []Entry{
		{AccountID: UserPointsAccountID(userID), AmountMinor: -points, Currency: string(CurrencyPoints)},
		{AccountID: AccountBreakageRevenue, AmountMinor: points, Currency: string(CurrencyPoints)},
	}
}

// IssueMarketingPoints — points the platform grants itself, with no
// advertiser funding them: a signup bonus, a goodwill credit, a promotion.
//
// Separate from EarnPoints on purpose. Both credit the user identically, but
// one is a cost the platform chose to incur and the other is a cost an
// advertiser paid for. Posting both to the same contra account would make
// marketing spend indistinguishable from funded issuance in every report
// that matters.
func IssueMarketingPoints(userID string, points int64) []Entry {
	return []Entry{
		{AccountID: UserPointsAccountID(userID), AmountMinor: points, Currency: string(CurrencyPoints)},
		{AccountID: AccountMarketingExpense, AmountMinor: -points, Currency: string(CurrencyPoints)},
	}
}

// ToSuspense parks a leg whose counterparty is not yet known, so the
// transfer can balance and be written now rather than held in memory.
func ToSuspense(accountID string, points int64) []Entry {
	return []Entry{
		{AccountID: accountID, AmountMinor: points, Currency: string(CurrencyPoints)},
		{AccountID: AccountSuspense, AmountMinor: -points, Currency: string(CurrencyPoints)},
	}
}

// CashChart is the pair of accounts a currency needs before cash can move.
//
// The reserve is an ASSET — cash the platform holds. Partner funding is a
// LIABILITY: money received for points not yet issued is owed, not earned,
// and classifying it as revenue at the moment it arrives is how a deferred
// obligation turns into a profit that was never made.
//
// docs/03 requires the reserve to be segregated; this is the account that
// segregation is expressed against, and keeping it separate per currency is
// what lets a regulator ask "how much IDR is held" and get an answer.
func CashChart(currency, country string) []Account {
	return []Account{
		{
			ID: ReserveAccountID(currency), OwnerType: OwnerReserve, OwnerID: "platform",
			Kind: KindAsset, Currency: Currency(currency), Country: country,
		},
		{
			ID: PartnerFundingAccountID(currency), OwnerType: OwnerPlatform, OwnerID: "platform",
			Kind: KindLiability, Currency: Currency(currency), Country: country,
		},
	}
}

// FundReserve moves a partner's payment into the segregated reserve.
//
// Same flow shape as every other posting here: OUT of the source account,
// INTO the destination. Nothing in it converts — the amount is whatever was
// actually received, in the currency it was received in, and the points that
// purchase allocated are recorded separately because they are a different
// currency and a transfer may not mix them.
func FundReserve(currency string, amountMinor int64) []Entry {
	return []Entry{
		{AccountID: PartnerFundingAccountID(currency), AmountMinor: -amountMinor, Currency: currency},
		{AccountID: ReserveAccountID(currency), AmountMinor: amountMinor, Currency: currency},
	}
}
