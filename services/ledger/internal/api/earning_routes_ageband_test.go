package api_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/yourtal/services/ledger/internal/attest"
)

// campaignPayingFor is its own small, disposable AU campaign paying exactly
// points per completion, owned by business — several of these, sharing one
// purchased allocation, let ONE user accumulate points across several
// distinct completions (a real GrantReward pays a given user at most once
// per campaign, so crossing a cap needs several campaigns, not one).
func campaignPayingFor(t *testing.T, s *server, business string, points int64) string {
	t.Helper()
	ctx := context.Background()
	var campaignID string
	if err := s.owner.QueryRow(ctx, `
		INSERT INTO campaign.campaigns
			(id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
			 estimated_data_mb, reward_points, question_count, scoring_rule,
			 lifecycle_state, published_at, business_id, region, audience, content_category,
			 poster_url, teaser_url, hls_url, aspect, estimated_bytes,
			 starts_at, ends_at, open_viewing, teaser_start_seconds)
		VALUES
			(gen_random_uuid(), 'quick', '12.1.c ageband cap fixture', gen_random_uuid(), 'ageband merchant',
			 'fixture', 30, 5, $1, 0, 'base_only',
			 'live', now(), $2, 'AU', 'all_ages', 'entertainment',
			 'https://example.test/poster.jpg', 'https://example.test/teaser.m3u8',
			 'https://example.test/hls.m3u8', '16:9', 1000000,
			 now(), now() + interval '30 days', false, 0)
		RETURNING id::text`, points, business).Scan(&campaignID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// campaign.terms_version and .reward_config cascade off campaign.campaigns.
		_, _ = s.owner.Exec(context.Background(), `DELETE FROM campaign.campaigns WHERE id = $1`, campaignID)
	})
	return campaignID
}

func fundedCampaign(t *testing.T, s *server, business string, points int64, allocationID string) string {
	t.Helper()
	ctx := context.Background()
	campaignID := campaignPayingFor(t, s, business, points)
	if _, err := s.owner.Exec(ctx, `INSERT INTO campaign.terms_version
			(campaign_id, version, reward_points, question_count, scoring_rule, duration_seconds, effective_from, accuracy_bonus_points)
		VALUES ($1, 1, $2, 0, 'base_only', 600, now(), 0)`, campaignID, points); err != nil {
		t.Fatal(err)
	}
	if _, err := s.owner.Exec(ctx, `INSERT INTO campaign.reward_config
			(campaign_id, allocation_id, funder_type, max_points_for_campaign, reward_points_per_completion, accuracy_bonus_points)
		VALUES ($1, $2, 'partner', 1000000, $3, 0)`, campaignID, allocationID, points); err != nil {
		t.Fatal(err)
	}
	return campaignID
}

// grantRewardBody is one attested grantReward call, with 12.1.c's ageBand.
func grantRewardBody(campaignID, userID, ageBand string, points int64) map[string]any {
	completion := attest.Completion{SessionID: unique("session"), UserID: userID, CampaignID: campaignID,
		TermsVersion: 1, CompletedAt: time.Now().UTC().Truncate(time.Second)}
	body := map[string]any{
		"campaignId": campaignID, "userId": userID, "region": "AU", "points": points,
		"trustTier": 3, "idempotencyKey": unique("grant"),
		"attestation": map[string]any{
			"sessionId": completion.SessionID, "termsVersion": 1,
			"completedAt": completion.CompletedAt.Format(time.RFC3339), "asked": 0, "correct": 0,
			"signature": attest.Sign(attestationSecret, completion),
		},
	}
	if ageBand != "" {
		body["ageBand"] = ageBand
	}
	return body
}

// TASKS.md 12.1.e's own Check: "a teen's grant above the cap is refused" —
// against the REAL Go ledger over real HTTP (this task's instruction, not
// just the fake), using AU's REAL seeded caps (migration
// 20260925193000_platform_region_setting.sql: 500 adult / 250 teen daily —
// nothing here overrides them).
//
// Five small campaigns (60 pts each), one shared purchased allocation: a
// teen completing all five crosses 250 on the fifth (4x60=240, then
// 240+60=300) and is refused velocity_capped; an adult completing the SAME
// five campaigns (300, under the 500 adult cap) succeeds on every one.
func TestATeensGrantAboveTheAUCapIsRefusedOverHTTP(t *testing.T) {
	s := newServer(t)
	ctx := context.Background()
	business := uuid()

	var alloc struct {
		AllocationID string `json:"allocationId"`
	}
	s.mustCall("/allocations/purchase", map[string]any{
		"businessId": business, "region": "AU", "currency": "AUD", "points": 10_000,
		"paidMinor": 450_000, "idempotencyKey": unique("buy"),
	}, &alloc)

	const perCampaign = 60
	campaigns := make([]string, 5)
	for i := range campaigns {
		campaigns[i] = fundedCampaign(t, s, business, perCampaign, alloc.AllocationID)
	}

	teen := uuid()
	for i := 0; i < 4; i++ {
		if code := s.call("/rewards/grants", grantRewardBody(campaigns[i], teen, "teen", perCampaign), nil); code != http.StatusOK {
			t.Fatalf("teen grant %d: %d, want 200", i, code)
		}
	}
	var refusal problem
	if code := s.call("/rewards/grants", grantRewardBody(campaigns[4], teen, "teen", perCampaign), &refusal); code != http.StatusConflict || refusal.Code != "velocity_capped" {
		t.Fatalf("teen's 5th grant (300 of a 250 teen daily cap): %d %s, want 409 velocity_capped", code, refusal.Code)
	}

	adult := uuid()
	for i := 0; i < 5; i++ {
		if code := s.call("/rewards/grants", grantRewardBody(campaigns[i], adult, "adult", perCampaign), nil); code != http.StatusOK {
			t.Fatalf("adult grant %d: %d, want 200 (300 of a 500 adult daily cap)", i, code)
		}
	}

	// The ledger row count is the proof that matters: the teen's refused
	// 5th attempt posted NOTHING — not a grant, not a transfer — while the
	// identical adult sequence posted all five.
	var teenGrants, adultGrants int
	if err := s.owner.QueryRow(ctx, `SELECT count(*) FROM ledger.grant WHERE user_id = $1`, teen).Scan(&teenGrants); err != nil {
		t.Fatal(err)
	}
	if err := s.owner.QueryRow(ctx, `SELECT count(*) FROM ledger.grant WHERE user_id = $1`, adult).Scan(&adultGrants); err != nil {
		t.Fatal(err)
	}
	if teenGrants != 4 {
		t.Errorf("teen has %d ledger.grant rows, want 4 (the refused 5th must leave none)", teenGrants)
	}
	if adultGrants != 5 {
		t.Errorf("adult has %d ledger.grant rows, want 5", adultGrants)
	}

	var teenBalance struct {
		AvailablePoints int64 `json:"availablePoints"`
		Pending         []struct {
			Points int64 `json:"points"`
		} `json:"pending"`
	}
	s.mustCall("/wallet/balance", map[string]any{"userId": teen}, &teenBalance)
	teenTotal := teenBalance.AvailablePoints
	for _, p := range teenBalance.Pending {
		teenTotal += p.Points
	}
	if teenTotal != 240 {
		t.Errorf("teen's wallet totals %d points, want 240", teenTotal)
	}
}

// 12.1.c: the field is required — an absent ageBand is refused rather than
// silently treated as adult (the fail-closed rule the whole cap depends on).
func TestAGrantWithNoAgeBandIsRefused(t *testing.T) {
	s := newServer(t)
	business := uuid()
	var alloc struct {
		AllocationID string `json:"allocationId"`
	}
	s.mustCall("/allocations/purchase", map[string]any{
		"businessId": business, "region": "AU", "currency": "AUD", "points": 1_000,
		"paidMinor": 45_000, "idempotencyKey": unique("buy"),
	}, &alloc)
	campaign := fundedCampaign(t, s, business, 60, alloc.AllocationID)

	// ageBandFor's own 400 is a plain bad-request refusal (engineFor's
	// "unknown_region" shape), not one of the closed ledger-error codes
	// a.fail's contractCodes table answers flat — httpx's own
	// {"error":{"code",...}} envelope (docs/13 section 5), not {"code",...}.
	type badRequest struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}

	body := grantRewardBody(campaign, uuid(), "", 60) // ageBand omitted
	var refusal badRequest
	if code := s.call("/rewards/grants", body, &refusal); code != http.StatusBadRequest || refusal.Error.Code != "unknown_age_band" {
		t.Errorf("no ageBand: %d %s, want 400 unknown_age_band", code, refusal.Error.Code)
	}

	body["ageBand"] = "toddler"
	if code := s.call("/rewards/grants", body, &refusal); code != http.StatusBadRequest || refusal.Error.Code != "unknown_age_band" {
		t.Errorf("ageBand=toddler: %d %s, want 400 unknown_age_band", code, refusal.Error.Code)
	}
}
