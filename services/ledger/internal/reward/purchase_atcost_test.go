package reward_test

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/ledgertest"
	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// Group 2.10.b T2a (F127, docs/27 §3.2): the receipt funder buys a receipt
// package at cost, ceil(points × B in force); nobody else can, and every
// other purchase keeps its price.

func businessUUID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6], b[8] = b[6]&0x0f|0x40, b[8]&0x3f|0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// receiptFunder makes a fresh business the approved receipt funder of a
// fresh partner in region.
func receiptFunder(t *testing.T, region ledger.Region) string {
	t.Helper()
	business := businessUUID()
	ledgertest.SetRegionSetting(t, string(region), "receipt_funder."+unique("partner"),
		fmt.Sprintf(`{"businessId": %q}`, business))
	return business
}

// atCostEngines are both regions' engines on the F1 rates.
func atCostEngines(t *testing.T) (au, id *reward.Engine, pool *pgxpool.Pool) {
	t.Helper()
	pool = receiptPool(t)
	book := ledger.New(pool)
	return reward.New(pool, book, reward.AlwaysAllow{}, ledger.RegionAU),
		reward.New(pool, book, reward.AlwaysAllow{}, ledger.RegionID), pool
}

func receiptPurchase(business string, region ledger.Region, tier string, points, paid int64) reward.PurchaseRequest {
	return reward.PurchaseRequest{ID: unique("pur_rcpt"), PartnerID: business, Points: points,
		AmountMinor: paid, Currency: string(region.Currency()), TierKey: tier, Programme: reward.ProgrammeReceipts}
}

// wroteNothing: a refused purchase leaves no purchase, allocation or package.
func wroteNothing(t *testing.T, pool *pgxpool.Pool, req reward.PurchaseRequest) {
	t.Helper()
	ctx := context.Background()
	q := sqlcgen.New(pool)
	if _, err := q.GetPointPurchase(ctx, req.ID); !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("%s: a purchase row was written (%v)", req.ID, err)
	}
	if _, err := q.GetAllocation(ctx, "alloc_"+req.ID); !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("%s: an allocation was written (%v)", req.ID, err)
	}
}

func TestTheFunderBuysAReceiptPackageAtB(t *testing.T) {
	au, id, pool := atCostEngines(t)
	ctx := context.Background()
	q := sqlcgen.New(pool)

	// AU Starter: 1,000 points at 3¢ is A$30.00. A cent under is refused.
	business := receiptFunder(t, ledger.RegionAU)
	under := receiptPurchase(business, ledger.RegionAU, "starter", 1_000, 2_999)
	if _, err := au.RecordPurchase(ctx, under); !errors.Is(err, reward.ErrUnderpriced) {
		t.Fatalf("A$29.99: err = %v, want ErrUnderpriced", err)
	}
	wroteNothing(t, pool, under)

	req := receiptPurchase(business, ledger.RegionAU, "starter", 1_000, 3_000)
	bought, err := au.RecordPurchase(ctx, req)
	if err != nil {
		t.Fatalf("A$30.00: %v", err)
	}
	purchase, err := q.GetPointPurchase(ctx, req.ID)
	if err != nil || purchase.Points != 1_000 || purchase.AmountMinor != 3_000 || purchase.PartnerID != business ||
		purchase.AllocationID != bought.AllocationID {
		t.Fatalf("purchase = %+v (%v)", purchase, err)
	}
	allocation, err := q.GetAllocationWithRegion(ctx, bought.AllocationID)
	if err != nil || allocation.FunderType != "partner" || allocation.FunderID != business ||
		allocation.TotalPoints != 1_000 || !allocation.IsReceiptPackage {
		t.Fatalf("allocation = %+v (%v)", allocation, err)
	}
	var funder, region, rateID string
	if err := pool.QueryRow(ctx,
		`SELECT funder_id, region, rate_id FROM ledger.receipt_package WHERE allocation_id = $1 AND purchase_id = $2`,
		bought.AllocationID, req.ID).Scan(&funder, &region, &rateID); err != nil {
		t.Fatalf("receipt package: %v", err)
	}
	if funder != business || region != "AU" || rateID != rateInForce(t, pool, ledger.RegionAU).ID {
		t.Errorf("receipt package = %s %s %s, want %s AU at the rate in force", funder, region, rateID, business)
	}

	// Dr plat_AU_reserve 3,000 / Cr plat_AU_partner_funding 3,000 (credit-positive).
	entries, err := q.ListEntriesByTransfer(ctx, bought.CashTransfer)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int64{
		ledger.PlatformAccountID(ledger.RegionAU, ledger.RoleReserve):        -3_000,
		ledger.PlatformAccountID(ledger.RegionAU, ledger.RolePartnerFunding): 3_000,
	}
	if len(entries) != len(want) {
		t.Fatalf("entries = %+v", entries)
	}
	for _, entry := range entries {
		if want[entry.AccountID] != entry.AmountMinor || entry.Currency != "AUD" {
			t.Errorf("entry %s %d %s, want %v", entry.AccountID, entry.AmountMinor, entry.Currency, want)
		}
	}

	// ID Starter: 1,000 points at IDR 6 is IDR 6,000.
	idFunder := receiptFunder(t, ledger.RegionID)
	underID := receiptPurchase(idFunder, ledger.RegionID, "starter", 1_000, 5_999)
	if _, err := id.RecordPurchase(ctx, underID); !errors.Is(err, reward.ErrUnderpriced) {
		t.Fatalf("IDR 5,999: err = %v, want ErrUnderpriced", err)
	}
	wroteNothing(t, pool, underID)
	if _, err := id.RecordPurchase(ctx, receiptPurchase(idFunder, ledger.RegionID, "starter", 1_000, 6_000)); err != nil {
		t.Fatalf("IDR 6,000: %v", err)
	}
}

// The same business without the programme buys an ordinary package at the
// tier's price, unchanged.
func TestTheFunderPaysTheTierPriceWithoutTheProgramme(t *testing.T) {
	au, _, pool := atCostEngines(t)
	ctx := context.Background()
	business := receiptFunder(t, ledger.RegionAU)

	cheap := receiptPurchase(business, ledger.RegionAU, "starter", 1_000, 3_000)
	cheap.Programme = ""
	if _, err := au.RecordPurchase(ctx, cheap); !errors.Is(err, reward.ErrUnderpriced) {
		t.Fatalf("an ordinary starter at A$30.00: err = %v, want ErrUnderpriced", err)
	}
	wroteNothing(t, pool, cheap)

	tier := receiptPurchase(business, ledger.RegionAU, "starter", 1_000, 4_500)
	tier.Programme = ""
	bought, err := au.RecordPurchase(ctx, tier)
	if err != nil {
		t.Fatalf("an ordinary starter at A$45.00: %v", err)
	}
	if receipts, err := sqlcgen.New(pool).IsReceiptPackage(ctx, bought.AllocationID); err != nil || receipts {
		t.Errorf("an ordinary package is a receipt package: %v %v", receipts, err)
	}
}

func TestOnlyTheFunderInItsRegionBuysACatalogueSize(t *testing.T) {
	au, id, pool := atCostEngines(t)
	ctx := context.Background()
	funder := receiptFunder(t, ledger.RegionAU)

	for name, c := range map[string]struct {
		engine *reward.Engine
		req    reward.PurchaseRequest
		want   error
	}{
		"a business that funds no partner": {au,
			receiptPurchase(businessUUID(), ledger.RegionAU, "starter", 1_000, 4_500), reward.ErrNotReceiptFunder},
		"the AU funder buying in ID": {id,
			receiptPurchase(funder, ledger.RegionID, "starter", 1_000, 9_000), reward.ErrNotReceiptFunder},
		"no tier": {au,
			receiptPurchase(funder, ledger.RegionAU, "", 1_000, 4_500), reward.ErrProgrammeNeedsTier},
		"a size that is not the tier's": {au,
			receiptPurchase(funder, ledger.RegionAU, "starter", 2_000, 9_000), pricing.ErrTierPointsMismatch},
		"a tier that is not in the catalogue": {au,
			receiptPurchase(funder, ledger.RegionAU, "platinum", 1_000, 4_500), pricing.ErrUnknownTier},
		"another programme": {au,
			func() reward.PurchaseRequest {
				r := receiptPurchase(funder, ledger.RegionAU, "starter", 1_000, 4_500)
				r.Programme = "vouchers"
				return r
			}(), reward.ErrUnknownProgramme},
	} {
		if _, err := c.engine.RecordPurchase(ctx, c.req); !errors.Is(err, c.want) {
			t.Errorf("%s: err = %v, want %v", name, err, c.want)
		}
		wroteNothing(t, pool, c.req)
	}
}

func TestAReceiptPackageReplaysOnlyAsTheSameProgramme(t *testing.T) {
	au, _, _ := atCostEngines(t)
	ctx := context.Background()
	business := receiptFunder(t, ledger.RegionAU)

	req := receiptPurchase(business, ledger.RegionAU, "starter", 1_000, 4_500)
	first, err := au.PurchasePoints(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	again, err := au.PurchasePoints(ctx, req)
	if err != nil || again.AllocationID != first.AllocationID {
		t.Fatalf("replay = %+v (%v), want %s", again, err, first.AllocationID)
	}
	ordinary := req
	ordinary.Programme = ""
	if _, err := au.PurchasePoints(ctx, ordinary); !errors.Is(err, ledger.ErrIdempotencyConflict) {
		t.Errorf("the same id without the programme: err = %v, want ErrIdempotencyConflict", err)
	}

	// And an ordinary purchase cannot be replayed into a receipt package.
	plain := receiptPurchase(business, ledger.RegionAU, "starter", 1_000, 4_500)
	plain.Programme = ""
	if _, err := au.PurchasePoints(ctx, plain); err != nil {
		t.Fatal(err)
	}
	plain.Programme = reward.ProgrammeReceipts
	if _, err := au.PurchasePoints(ctx, plain); !errors.Is(err, ledger.ErrIdempotencyConflict) {
		t.Errorf("an ordinary id as a receipt package: err = %v, want ErrIdempotencyConflict", err)
	}
}

// K6 for the slice: once a package's points are all issued, the reserve
// holds exactly what they would settle for at B, and issuing them moved no
// cash. The spend is receipts, drawn from the package (T2b).
func TestAFullySpentPackageIsBackedAtExactlyB(t *testing.T) {
	au, _, pool := atCostEngines(t)
	au = au.WithCaps(uncapped)
	ctx := context.Background()
	book := ledger.New(pool)
	reserve := ledger.PlatformAccountID(ledger.RegionAU, ledger.RoleReserve)
	reserveBefore, err := book.Balance(ctx, reserve)
	if err != nil {
		t.Fatal(err)
	}

	partner, business := fundedPartner(t, ledger.RegionAU)
	bought, err := au.RecordPurchase(ctx, receiptPurchase(business, ledger.RegionAU, "starter", 1_000, 3_000))
	if err != nil {
		t.Fatal(err)
	}
	reserveBought, _ := book.Balance(ctx, reserve)

	users := []string{unique("usr"), unique("usr")}
	for _, user := range users {
		receipt := receiptFor(user, partner, 500)
		receipt.TrustTier = 1 // held back, so the points stay pending
		if _, err := au.GrantAction(ctx, receipt); err != nil {
			t.Fatalf("spending the package: %v", err)
		}
	}
	if remaining, _ := au.RemainingPoints(ctx, bought.AllocationID); remaining != 0 {
		t.Fatalf("%d points left, want the package spent", remaining)
	}
	reserveSpent, _ := book.Balance(ctx, reserve)

	var issued int64
	for _, user := range users {
		pending, err := book.Balance(ctx, ledger.UserAccountID(user, ledger.PurposePending))
		if err != nil {
			t.Fatal(err)
		}
		issued += pending
	}
	liability, err := pricing.SettlementLiabilityMinor(issued, rateInForce(t, pool, ledger.RegionAU).MicrosPerPoint)
	if err != nil {
		t.Fatal(err)
	}
	if issued != 1_000 || reserveBought-reserveBefore != 3_000 || reserveSpent != reserveBought || liability != 3_000 {
		t.Errorf("issued %d points (liability %d at B); reserve +%d at purchase, +%d while spending; want 1,000, 3,000, 3,000, 0",
			issued, liability, reserveBought-reserveBefore, reserveSpent-reserveBought)
	}
}
