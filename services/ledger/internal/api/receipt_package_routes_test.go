package api_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/yourtal/services/ledger/internal/ledgertest"
)

// Group 2.10.b T2a (F127): receipt packages over signed HTTP. The funder sees
// the at-cost price; no answer names the rate.

func (s *server) receiptFunder(region string) string {
	s.t.Helper()
	business := uuid()
	ledgertest.SetRegionSetting(s.t, region, "receipt_funder."+unique("partner"),
		fmt.Sprintf(`{"businessId": %q}`, business))
	return business
}

// noRate fails if an answer carries a field that could be the rate.
func noRate(t *testing.T, view map[string]any) {
	t.Helper()
	for key := range view {
		lower := strings.ToLower(key)
		if strings.Contains(lower, "rate") || strings.Contains(lower, "micros") || strings.Contains(lower, "backing") {
			t.Errorf("the answer carries %q", key)
		}
	}
}

func TestReceiptPackageTiersAreAtCostForTheFunderOnly(t *testing.T) {
	s := newServer(t)
	au := s.receiptFunder("AU")

	var tiers []map[string]any
	s.mustCall("/pricing/receipt-package-tiers", map[string]any{"region": "AU", "businessId": au}, &tiers)
	want := map[string]float64{"starter": 3_000, "grow": 30_000, "scale": 150_000}
	if len(tiers) != len(want) {
		t.Fatalf("tiers = %v", tiers)
	}
	for _, tier := range tiers {
		total := want[tier["tierKey"].(string)]
		if tier["totalMinor"] != total || tier["undiscountedMinor"] != total || tier["discountBps"] != float64(0) ||
			tier["pricing"] != "at_cost" || tier["currency"] != "AUD" {
			t.Errorf("tier = %v, want %v at cost", tier, total)
		}
		noRate(t, tier)
	}

	var refused httpError
	for name, body := range map[string]map[string]any{
		"a business that funds nothing": {"region": "AU", "businessId": uuid()},
		"the AU funder in ID":           {"region": "ID", "businessId": au},
	} {
		if code := s.call("/pricing/receipt-package-tiers", body, &refused); code != http.StatusBadRequest || refused.Error.Code != "refused" {
			t.Errorf("%s: %d %+v, want 400 refused", name, code, refused)
		}
	}
}

func TestAPackageQuoteNamesItsPricing(t *testing.T) {
	s := newServer(t)
	id := s.receiptFunder("ID")

	var atCost map[string]any
	s.mustCall("/pricing/package-quote", map[string]any{"region": "ID", "tierKey": "starter",
		"programme": "receipts", "businessId": id}, &atCost)
	if atCost["totalMinor"] != float64(6_000) || atCost["pricing"] != "at_cost" {
		t.Errorf("at cost = %v", atCost)
	}
	noRate(t, atCost)

	var tier map[string]any
	s.mustCall("/pricing/package-quote", map[string]any{"region": "ID", "tierKey": "starter"}, &tier)
	if tier["totalMinor"] != float64(9_000) || tier["pricing"] != "tier" {
		t.Errorf("tier = %v", tier)
	}

	var refused httpError
	for name, body := range map[string]map[string]any{
		"programme alone":   {"region": "ID", "tierKey": "starter", "programme": "receipts"},
		"businessId alone":  {"region": "ID", "tierKey": "starter", "businessId": id},
		"not a funder":      {"region": "ID", "tierKey": "starter", "programme": "receipts", "businessId": uuid()},
		"another programme": {"region": "ID", "tierKey": "starter", "programme": "vouchers", "businessId": id},
	} {
		if code := s.call("/pricing/package-quote", body, &refused); code != http.StatusBadRequest || refused.Error.Code != "refused" {
			t.Errorf("%s: %d %+v, want 400 refused", name, code, refused)
		}
	}
}

type allocationAnswer struct {
	AllocationID string  `json:"allocationId"`
	TotalPoints  int64   `json:"totalPoints"`
	Programme    *string `json:"programme"`
}

func TestAReceiptPackagePurchaseOverHTTP(t *testing.T) {
	s := newServer(t)
	business := s.receiptFunder("AU")
	key := unique("rcpt")
	body := func(paid int64, programme bool) map[string]any {
		b := map[string]any{"businessId": business, "region": "AU", "currency": "AUD", "points": 1_000,
			"paidMinor": paid, "idempotencyKey": key, "tierKey": "starter"}
		if programme {
			b["programme"] = "receipts"
		}
		return b
	}

	var refused httpError
	if code := s.call("/allocations/purchase", body(2_999, true), &refused); code != http.StatusBadRequest || refused.Error.Code != "refused" {
		t.Errorf("A$29.99: %d %+v, want 400 refused", code, refused)
	}
	var bought allocationAnswer
	s.mustCall("/allocations/purchase", body(3_000, true), &bought)
	if bought.TotalPoints != 1_000 || bought.Programme == nil || *bought.Programme != "receipts" {
		t.Fatalf("bought = %+v", bought)
	}

	var replayed allocationAnswer
	s.mustCall("/allocations/purchase", body(3_000, true), &replayed)
	if replayed.AllocationID != bought.AllocationID {
		t.Errorf("replay = %s, want %s", replayed.AllocationID, bought.AllocationID)
	}
	var conflict problem
	if code := s.call("/allocations/purchase", body(3_000, false), &conflict); code != http.StatusConflict || conflict.Code != "idempotency_conflict" {
		t.Errorf("the same id without the programme: %d %+v, want 409 idempotency_conflict", code, conflict)
	}

	// The same business buying an ordinary starter pays the tier's A$45.00.
	ordinary := body(3_000, false)
	ordinary["idempotencyKey"] = unique("tier")
	if code := s.call("/allocations/purchase", ordinary, &refused); code != http.StatusBadRequest || refused.Error.Code != "refused" {
		t.Errorf("an ordinary starter at A$30.00: %d %+v, want 400 refused", code, refused)
	}
	ordinary["paidMinor"] = 4_500
	var plain allocationAnswer
	s.mustCall("/allocations/purchase", ordinary, &plain)
	if plain.Programme != nil {
		t.Errorf("an ordinary package = %+v, want programme null", plain)
	}

	// Every allocation view carries programme, null included.
	var got map[string]any
	s.mustCall("/allocations/get", map[string]any{"allocationId": plain.AllocationID}, &got)
	if programme, present := got["programme"]; !present || programme != nil {
		t.Errorf("an ordinary allocation = %v, want programme: null", got)
	}
	var listed []allocationAnswer
	s.mustCall("/allocations/list", map[string]any{"businessId": business}, &listed)
	programmes := map[string]string{}
	for _, view := range listed {
		programmes[view.AllocationID] = "null"
		if view.Programme != nil {
			programmes[view.AllocationID] = *view.Programme
		}
	}
	if len(listed) != 2 || programmes[bought.AllocationID] != "receipts" || programmes[plain.AllocationID] != "null" {
		t.Errorf("listed = %v", programmes)
	}

	if code := s.call("/allocations/purchase", map[string]any{"businessId": uuid(), "region": "AU", "currency": "AUD",
		"points": 1_000, "paidMinor": 4_500, "idempotencyKey": unique("rcpt"), "tierKey": "starter", "programme": "receipts"},
		&refused); code != http.StatusBadRequest || refused.Error.Code != "refused" {
		t.Errorf("a business that funds nothing: %d %+v, want 400 refused", code, refused)
	}
}

// The switch (T2b, docs/27 §3.3): a receipt names its partner and is paid
// by the partner's receipt package; with no package it is not paid at all.
func TestAReceiptGrantIsPaidByItsPartnersPackage(t *testing.T) {
	s := newServer(t)
	partner, business := unique("partner"), uuid()
	ledgertest.SetRegionSetting(t, "AU", "receipt_funder."+partner, fmt.Sprintf(`{"businessId": %q}`, business))
	receipt := func(partner string) map[string]any {
		body := map[string]any{"kind": "receipt", "userId": uuid(), "region": "AU", "points": 1,
			"trustTier": 3, "idempotencyKey": unique("receipt"), "ageBand": "adult"}
		if partner != "" {
			body["partnerId"] = partner
		}
		return body
	}

	var paused problem
	if code := s.call("/actions/grants", receipt(partner), &paused); code != http.StatusConflict || paused.Code != "allocation_exhausted" {
		t.Errorf("no package yet: %d %+v, want 409 allocation_exhausted", code, paused)
	}
	s.mustCall("/allocations/purchase", map[string]any{"businessId": business, "region": "AU", "currency": "AUD",
		"points": 1_000, "paidMinor": 3_000, "idempotencyKey": unique("rcpt"), "tierKey": "starter", "programme": "receipts"}, nil)
	var granted struct {
		Points int64 `json:"points"`
	}
	s.mustCall("/actions/grants", receipt(partner), &granted)
	if granted.Points != 1 {
		t.Errorf("granted = %+v", granted)
	}
	var refused httpError
	if code := s.call("/actions/grants", receipt(""), &refused); code != http.StatusBadRequest || refused.Error.Code != "refused" {
		t.Errorf("no partner: %d %+v, want 400 refused", code, refused)
	}
}

// 2.9.c: the staff console's read of what a partner's receipt packages paid.
func TestReceiptProgrammeStatsCountOnlyReceiptGrantsFromItsPackages(t *testing.T) {
	s := newServer(t)
	partner, business := unique("partner"), uuid()
	ledgertest.SetRegionSetting(t, "AU", "receipt_funder."+partner, fmt.Sprintf(`{"businessId": %q}`, business))
	var pkg allocationAnswer
	s.mustCall("/allocations/purchase", map[string]any{"businessId": business, "region": "AU", "currency": "AUD",
		"points": 1_000, "paidMinor": 3_000, "idempotencyKey": unique("rcpt"), "tierKey": "starter", "programme": "receipts"}, &pkg)

	type earner struct {
		UserID   string `json:"userId"`
		Points   int64  `json:"points"`
		Receipts int64  `json:"receipts"`
	}
	type stats struct {
		PaidPoints    int64    `json:"paidPoints"`
		PaidLast7Days int64    `json:"paidLast7Days"`
		TopEarners    []earner `json:"topEarners"`
	}
	read := func(region string, ids ...string) stats {
		var got stats
		s.mustCall("/economy/receipt-programme-stats", map[string]any{"region": region, "allocationIds": ids}, &got)
		return got
	}

	if got := read("AU", pkg.AllocationID); got.PaidPoints != 0 || got.PaidLast7Days != 0 || got.TopEarners == nil || len(got.TopEarners) != 0 {
		t.Errorf("before any receipt = %+v, want zeros and an empty list", got)
	}

	heavy, light := uuid(), uuid()
	send := func(user string, points int) {
		s.mustCall("/actions/grants", map[string]any{"kind": "receipt", "userId": user, "region": "AU", "points": points,
			"trustTier": 3, "idempotencyKey": unique("receipt"), "ageBand": "adult", "partnerId": partner}, nil)
	}
	send(heavy, 1)
	send(heavy, 1)
	send(light, 1)

	got := read("AU", pkg.AllocationID)
	if got.PaidPoints != 3 || got.PaidLast7Days != 3 || len(got.TopEarners) != 2 {
		t.Fatalf("stats = %+v, want 3 paid and two earners", got)
	}
	if got.TopEarners[0] != (earner{UserID: heavy, Points: 2, Receipts: 2}) || got.TopEarners[1] != (earner{UserID: light, Points: 1, Receipts: 1}) {
		t.Errorf("top earners = %+v", got.TopEarners)
	}

	if other := read("AU", "no-such-allocation"); other.PaidPoints != 0 || len(other.TopEarners) != 0 {
		t.Errorf("another allocation = %+v, want nothing", other)
	}
	if other := read("ID", pkg.AllocationID); other.PaidPoints != 0 {
		t.Errorf("the package read as ID = %+v, want nothing: a region sees only its own packages", other)
	}
	var bad httpError
	if code := s.call("/economy/receipt-programme-stats", map[string]any{"region": "NZ", "allocationIds": []string{}}, &bad); code != http.StatusBadRequest {
		t.Errorf("unknown region: %d, want 400", code)
	}
}
