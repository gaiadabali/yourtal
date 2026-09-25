package ledger

import "fmt"

// The chart of accounts and its posting rules (4.2).
//
// # Sign convention
//
// Entries are credit-positive: a debit is negative, a credit positive, and
// every transfer sums to zero. Liability, equity and revenue accounts are
// credit-normal (natural balance = +SUM); asset and expense accounts are
// debit-normal (natural balance = -SUM). GetAccountBalance applies that, so
// every reader sees natural balances and none re-derives the sign.
//
// # Regions
//
// AU and ID are separate economies. Every platform account exists once per
// region and its id carries the region; cash accounts hold that region's
// currency only. The balance trigger refuses a transfer touching two regions.

// AccountKind is the accounting classification (docs/02 §6).
type AccountKind string

const (
	KindAsset     AccountKind = "asset"
	KindLiability AccountKind = "liability"
	KindRevenue   AccountKind = "revenue"
	KindExpense   AccountKind = "expense"
	KindEquity    AccountKind = "equity"
)

// OwnerType is who an account belongs to (docs/02 §6).
type OwnerType string

const (
	OwnerUser     OwnerType = "user"
	OwnerMerchant OwnerType = "merchant"
	OwnerPlatform OwnerType = "platform"
	OwnerEscrow   OwnerType = "escrow"
	OwnerCharity  OwnerType = "charity"
	// OwnerSuspense holds a leg whose counterparty is not yet known; a
	// non-zero balance at close of day is a work queue for finance.
	OwnerSuspense OwnerType = "suspense"
	OwnerReserve  OwnerType = "reserve"
)

// Currency in the ledger sense. Points are one, so a points entry and a cash
// entry can never sum together: a transfer may not mix currencies.
type Currency string

const (
	CurrencyPoints Currency = "YTP"
	CurrencyIDR    Currency = "IDR"
	CurrencyAUD    Currency = "AUD"
)

// Region is one economy. Its cash currency is fixed.
type Region string

const (
	RegionAU Region = "AU"
	RegionID Region = "ID"
)

// Currency is the region's cash currency, or "" for an unknown region.
func (r Region) Currency() Currency {
	switch r {
	case RegionAU:
		return CurrencyAUD
	case RegionID:
		return CurrencyIDR
	}
	return ""
}

// Purpose separates a user's spendable, held-back and frozen points, and marks
// a merchant's payable. Platform accounts are `main`.
type Purpose string

const (
	PurposeMain      Purpose = "main"
	PurposeAvailable Purpose = "available"
	PurposePending   Purpose = "pending"
	PurposeEscrow    Purpose = "escrow"
	PurposePayable   Purpose = "payable"
)

// Role names a platform account within a region.
type Role string

const (
	// Cash side, in the region currency.
	RoleReserve            Role = "reserve"             // asset: segregated cash backing points and vouchers
	RolePartnerFunding     Role = "partner_funding"     // liability: partner cash received for points
	RoleMarketingCash      Role = "marketing_cash"      // asset: cash earmarked to back marketing points
	RolePlatformEquity     Role = "platform_equity"     // equity: the platform's own money put in
	RoleRedemptionClearing Role = "redemption_clearing" // equity: contra to voucher liability created by burns
	RoleVoucherLiability   Role = "voucher_liability"   // liability: face value owed on live vouchers

	// Points side, in YTP.
	RolePointsIssued     Role = "points_issued"     // equity: contra to partner-funded points
	RolePointsRedeemed   Role = "points_redeemed"   // equity: points burned for vouchers
	RoleBreakageRevenue  Role = "breakage_revenue"  // revenue: points expired unspent
	RoleMarketingExpense Role = "marketing_expense" // expense: points the platform pays for
	RoleSuspense         Role = "suspense"
)

type roleSpec struct {
	kind  AccountKind
	cash  bool
	owner OwnerType
}

var roles = map[Role]roleSpec{
	RoleReserve:            {KindAsset, true, OwnerReserve},
	RolePartnerFunding:     {KindLiability, true, OwnerPlatform},
	RoleMarketingCash:      {KindAsset, true, OwnerPlatform},
	RolePlatformEquity:     {KindEquity, true, OwnerPlatform},
	RoleRedemptionClearing: {KindEquity, true, OwnerPlatform},
	RoleVoucherLiability:   {KindLiability, true, OwnerPlatform},
	RolePointsIssued:       {KindEquity, false, OwnerPlatform},
	RolePointsRedeemed:     {KindEquity, false, OwnerPlatform},
	RoleBreakageRevenue:    {KindRevenue, false, OwnerPlatform},
	RoleMarketingExpense:   {KindExpense, false, OwnerPlatform},
	RoleSuspense:           {KindEquity, false, OwnerSuspense},
}

// PlatformAccountID is a platform account's fixed id, e.g. `plat_AU_reserve`.
// Fixed strings, so a posting rule can never look up the wrong account.
func PlatformAccountID(region Region, role Role) string {
	return fmt.Sprintf("plat_%s_%s", region, role)
}

// UserAccountID is one of a user's points accounts, e.g. `usr_42_pts_pending`.
func UserAccountID(userID string, purpose Purpose) string {
	return fmt.Sprintf("usr_%s_pts_%s", userID, purpose)
}

// MerchantPayableID is what the platform owes a merchant for captured vouchers.
func MerchantPayableID(merchantID string, region Region) string {
	return fmt.Sprintf("mer_%s_payable_%s", merchantID, region.Currency())
}

// Account is one row of the chart.
type Account struct {
	ID        string
	OwnerType OwnerType
	OwnerID   string
	Kind      AccountKind
	Currency  Currency
	Country   string
	Purpose   Purpose
}

// PlatformChart is every platform account in a region, points and cash.
func PlatformChart(region Region) []Account {
	accounts := make([]Account, 0, len(roles))
	for _, role := range []Role{
		RoleReserve, RolePartnerFunding, RoleMarketingCash, RolePlatformEquity,
		RoleRedemptionClearing, RoleVoucherLiability, RolePointsIssued,
		RolePointsRedeemed, RoleBreakageRevenue, RoleMarketingExpense, RoleSuspense,
	} {
		spec := roles[role]
		currency := CurrencyPoints
		if spec.cash {
			currency = region.Currency()
		}
		accounts = append(accounts, Account{
			ID: PlatformAccountID(region, role), OwnerType: spec.owner, OwnerID: "platform",
			Kind: spec.kind, Currency: currency, Country: string(region), Purpose: PurposeMain,
		})
	}
	return accounts
}

// UserAccounts are a user's three points accounts, all liabilities: points are
// a claim the user holds on the platform.
func UserAccounts(userID string, region Region) []Account {
	accounts := make([]Account, 0, 3)
	for _, purpose := range []Purpose{PurposeAvailable, PurposePending, PurposeEscrow} {
		accounts = append(accounts, Account{
			ID: UserAccountID(userID, purpose), OwnerType: OwnerUser, OwnerID: userID,
			Kind: KindLiability, Currency: CurrencyPoints, Country: string(region), Purpose: purpose,
		})
	}
	return accounts
}

// MerchantPayable is the platform's liability to one merchant in one region.
func MerchantPayable(merchantID string, region Region) Account {
	return Account{
		ID: MerchantPayableID(merchantID, region), OwnerType: OwnerMerchant, OwnerID: merchantID,
		Kind: KindLiability, Currency: region.Currency(), Country: string(region), Purpose: PurposePayable,
	}
}

// --- posting rules ----------------------------------------------------------
//
// One function per row of the 4.2.c table. Each returns entries summing to
// zero in one currency; Postgres re-checks both at COMMIT.

// debitCredit is `Dr debit / Cr credit` for amount.
func debitCredit(debit, credit string, currency Currency, amount int64) []Entry {
	return []Entry{
		{AccountID: debit, AmountMinor: -amount, Currency: string(currency)},
		{AccountID: credit, AmountMinor: amount, Currency: string(currency)},
	}
}

func cash(region Region, debit, credit Role, amount int64) []Entry {
	return debitCredit(PlatformAccountID(region, debit), PlatformAccountID(region, credit), region.Currency(), amount)
}

// Purchase: a partner's cash enters the reserve. Dr reserve / Cr partner_funding.
// No spread revenue is posted; the spread is reported only.
func Purchase(region Region, amountMinor int64) []Entry {
	return cash(region, RoleReserve, RolePartnerFunding, amountMinor)
}

// FundMarketing: the platform puts its own cash behind marketing points.
// Dr marketing_cash / Cr platform_equity.
func FundMarketing(region Region, amountMinor int64) []Entry {
	return cash(region, RoleMarketingCash, RolePlatformEquity, amountMinor)
}

// MarketingBacking moves marketing cash into the reserve to back a marketing
// grant (K6). Dr reserve / Cr marketing_cash.
func MarketingBacking(region Region, amountMinor int64) []Entry {
	return cash(region, RoleReserve, RoleMarketingCash, amountMinor)
}

// GrantPartner: partner-funded points, held back. Dr points_issued / Cr user.pending.
func GrantPartner(region Region, userID string, points int64) []Entry {
	return debitCredit(PlatformAccountID(region, RolePointsIssued), UserAccountID(userID, PurposePending), CurrencyPoints, points)
}

// GrantMarketing: platform-funded points, held back. Dr marketing_expense / Cr user.pending.
func GrantMarketing(region Region, userID string, points int64) []Entry {
	return debitCredit(PlatformAccountID(region, RoleMarketingExpense), UserAccountID(userID, PurposePending), CurrencyPoints, points)
}

// Release: holdback ends. Dr user.pending / Cr user.available.
func Release(userID string, points int64) []Entry {
	return debitCredit(UserAccountID(userID, PurposePending), UserAccountID(userID, PurposeAvailable), CurrencyPoints, points)
}

// BurnPoints: the points half of a burn. Dr user.available / Cr points_redeemed.
func BurnPoints(region Region, userID string, points int64) []Entry {
	return debitCredit(UserAccountID(userID, PurposeAvailable), PlatformAccountID(region, RolePointsRedeemed), CurrencyPoints, points)
}

// BurnLiability: the cash half of a burn, at the voucher's settlement value S.
// Dr redemption_clearing / Cr voucher_liability. Posted in the same database
// transaction as BurnPoints, as its own transfer (another currency).
func BurnLiability(region Region, settlementMinor int64) []Entry {
	return cash(region, RoleRedemptionClearing, RoleVoucherLiability, settlementMinor)
}

// Capture: a merchant honoured a voucher. Dr voucher_liability / Cr merchant_payable.
func Capture(region Region, merchantID string, amountMinor int64) []Entry {
	return debitCredit(PlatformAccountID(region, RoleVoucherLiability), MerchantPayableID(merchantID, region), region.Currency(), amountMinor)
}

// RefundCapture reverses a share of a capture.
func RefundCapture(region Region, merchantID string, amountMinor int64) []Entry {
	return Reverse(Capture(region, merchantID, amountMinor))
}

// Payout: the merchant is paid from the reserve. Dr merchant_payable / Cr reserve.
func Payout(region Region, merchantID string, amountMinor int64) []Entry {
	return debitCredit(MerchantPayableID(merchantID, region), PlatformAccountID(region, RoleReserve), region.Currency(), amountMinor)
}

// VoucherExpiry: an unredeemed voucher or forfeited remainder is no longer owed.
// Dr voucher_liability / Cr redemption_clearing.
func VoucherExpiry(region Region, amountMinor int64) []Entry {
	return cash(region, RoleVoucherLiability, RoleRedemptionClearing, amountMinor)
}

// ExpirePoints (when enabled): Dr user.available / Cr breakage_revenue.
func ExpirePoints(region Region, userID string, points int64) []Entry {
	return debitCredit(UserAccountID(userID, PurposeAvailable), PlatformAccountID(region, RoleBreakageRevenue), CurrencyPoints, points)
}

// Suspend freezes a user's points: Dr available + pending / Cr escrow. Zero
// legs are left out, since the ledger refuses a zero entry; nil when both are
// zero. Undo it with Reverse.
func Suspend(userID string, available, pending int64) []Entry {
	var entries []Entry
	if available != 0 {
		entries = append(entries, Entry{AccountID: UserAccountID(userID, PurposeAvailable), AmountMinor: -available, Currency: string(CurrencyPoints)})
	}
	if pending != 0 {
		entries = append(entries, Entry{AccountID: UserAccountID(userID, PurposePending), AmountMinor: -pending, Currency: string(CurrencyPoints)})
	}
	if len(entries) == 0 {
		return nil
	}
	return append(entries, Entry{AccountID: UserAccountID(userID, PurposeEscrow), AmountMinor: available + pending, Currency: string(CurrencyPoints)})
}

// ToSuspense parks a points leg whose counterparty is not yet known.
func ToSuspense(region Region, accountID string, points int64) []Entry {
	return debitCredit(PlatformAccountID(region, RoleSuspense), accountID, CurrencyPoints, points)
}

// Reverse is the exact inverse of entries. Post it with TransferRequest.Reverses
// naming the original, which the ledger checks.
func Reverse(entries []Entry) []Entry {
	out := make([]Entry, len(entries))
	for i, e := range entries {
		out[i] = Entry{AccountID: e.AccountID, AmountMinor: -e.AmountMinor, Currency: e.Currency}
	}
	return out
}
