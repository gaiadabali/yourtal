package api_test

import (
	"context"
	"testing"

	"github.com/yourtal/services/ledger/internal/ledger"
)

// TASKS.md 10.2.b: the ledger's own half of a voucher expiry — releasing
// whatever liability an expired voucher still carried.
func TestVoucherExpiryReleasesLiability(t *testing.T) {
	s := newServer(t)
	pool := ensureChart(t)

	before, err := ledger.New(pool).Balance(
		context.Background(), ledger.PlatformAccountID(ledger.RegionAU, ledger.RoleVoucherLiability))
	if err != nil {
		t.Fatalf("reading voucher_liability before: %v", err)
	}

	voucherID := uuid()
	var result struct {
		VoucherID  string `json:"voucherId"`
		TransferID string `json:"transferId"`
	}
	s.mustCall("/vouchers/expire", map[string]any{
		"voucherId": voucherID, "region": "AU", "amountMinor": 4_500,
	}, &result)
	if result.VoucherID != voucherID || result.TransferID == "" {
		t.Fatalf("result = %+v", result)
	}

	after, err := ledger.New(pool).Balance(
		context.Background(), ledger.PlatformAccountID(ledger.RegionAU, ledger.RoleVoucherLiability))
	if err != nil {
		t.Fatalf("reading voucher_liability after: %v", err)
	}
	// Liability is a normal-credit account (chart.go): expiry debits it, so
	// its natural balance falls by exactly the released amount.
	if before-after != 4_500 {
		t.Errorf("voucher_liability moved by %d, want 4500", before-after)
	}

	// A replay of the same voucher's expiry is a no-op — the ledger's own
	// idempotency key, not a second liability release.
	var replay struct {
		VoucherID  string `json:"voucherId"`
		TransferID string `json:"transferId"`
	}
	s.mustCall("/vouchers/expire", map[string]any{
		"voucherId": voucherID, "region": "AU", "amountMinor": 4_500,
	}, &replay)
	if replay.TransferID != result.TransferID {
		t.Errorf("a replay made a new transfer %s, want the original %s", replay.TransferID, result.TransferID)
	}
	again, err := ledger.New(pool).Balance(
		context.Background(), ledger.PlatformAccountID(ledger.RegionAU, ledger.RoleVoucherLiability))
	if err != nil {
		t.Fatalf("reading voucher_liability after replay: %v", err)
	}
	if again != after {
		t.Errorf("a replay moved the balance again: %d -> %d", after, again)
	}
}

func TestVoucherExpiryRefusesAnUnknownRegion(t *testing.T) {
	s := newServer(t)
	status := s.call("/vouchers/expire", map[string]any{
		"voucherId": uuid(), "region": "XX", "amountMinor": 100,
	}, nil)
	if status != 400 {
		t.Errorf("status = %d, want 400 for an unknown region", status)
	}
}
