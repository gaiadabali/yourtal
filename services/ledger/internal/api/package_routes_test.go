package api_test

import (
	"encoding/json"
	"net/http"
	"testing"
)

// 14.13 (F122): the package tiers over signed HTTP, priced at the seeded ID
// rate (P_issue IDR 9 a point). No answer carries B.

type tierView struct {
	TierKey           string `json:"tierKey"`
	Points            int64  `json:"points"`
	DiscountBps       int64  `json:"discountBps"`
	TotalMinor        int64  `json:"totalMinor"`
	UndiscountedMinor int64  `json:"undiscountedMinor"`
	Currency          string `json:"currency"`
}

// httpError is httpx's error envelope, which a 400 answers with.
type httpError struct {
	Error struct {
		Code string `json:"code"`
	} `json:"error"`
}

func TestPackageTiersArePricedByTheLedger(t *testing.T) {
	s := newServer(t)

	var tiers []tierView
	s.mustCall("/pricing/package-tiers", map[string]any{"region": "ID"}, &tiers)
	if len(tiers) != 3 || tiers[1] != (tierView{"grow", 10_000, 500, 85_500, 90_000, "IDR"}) {
		t.Errorf("tiers = %+v", tiers)
	}

	var grow map[string]any
	s.mustCall("/pricing/package-quote", map[string]any{"region": "ID", "tierKey": "grow"}, &grow)
	if grow["totalMinor"] != float64(85_500) || grow["pricing"] != "tier" {
		t.Errorf("grow = %v", grow)
	}
	for key := range grow {
		if key != "tierKey" && key != "points" && key != "discountBps" && key != "totalMinor" &&
			key != "undiscountedMinor" && key != "currency" && key != "pricing" {
			t.Errorf("the quote carries %q", key)
		}
	}

	var refused httpError
	if code := s.call("/pricing/package-quote", map[string]any{"region": "ID", "tierKey": "platinum"}, &refused); code != http.StatusBadRequest || refused.Error.Code != "refused" {
		t.Errorf("an unknown tier: %d %+v, want 400 refused", code, refused)
	}
}

func TestAProposedCatalogueIsCheckedAgainstB(t *testing.T) {
	s := newServer(t)
	check := func(tiers string) (int, httpError) {
		var out httpError
		return s.call("/pricing/package-tiers/check", map[string]any{"region": "ID", "tiers": json.RawMessage(tiers)}, &out), out
	}
	if code, _ := check(`[{"key": "grow", "points": 10000, "discountBps": 3000}]`); code != http.StatusOK {
		t.Errorf("30%% off IDR 9 is IDR 6.3, above B: %d", code)
	}
	if code, out := check(`[{"key": "deep", "points": 10000, "discountBps": 3400}]`); code != http.StatusBadRequest || out.Error.Code != "refused" {
		t.Errorf("34%% off IDR 9 is IDR 5.94, under B = 6: %d %+v", code, out)
	}
	if code, _ := check(`[{"key": "odd", "points": 1500, "discountBps": 0}]`); code != http.StatusBadRequest {
		t.Errorf("not a pack: %d", code)
	}
}

func TestAPurchaseByTierOverHTTP(t *testing.T) {
	s := newServer(t)
	business := uuid()
	body := func(paid int64) map[string]any {
		return map[string]any{"businessId": business, "region": "ID", "currency": "IDR", "points": 10_000,
			"paidMinor": paid, "idempotencyKey": unique("tier"), "tierKey": "grow"}
	}
	var refused httpError
	if code := s.call("/allocations/purchase", body(85_499), &refused); code != http.StatusBadRequest || refused.Error.Code != "refused" {
		t.Errorf("under the tier's price: %d %+v", code, refused)
	}
	var allocation struct {
		TotalPoints int64 `json:"totalPoints"`
	}
	s.mustCall("/allocations/purchase", body(85_500), &allocation)
	if allocation.TotalPoints != 10_000 {
		t.Errorf("allocation = %+v", allocation)
	}
}
