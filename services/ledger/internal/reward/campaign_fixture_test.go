package reward_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/attest"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/testdb"
)

var attestationSecret = []byte("test-only-reward-attestation-secret-32")

// liveCampaign is its OWN fresh campaign row, made live with a terms version
// (base, bonus, scoring rule) and a reward config paid from its own owner's
// purchased allocation. As the owner: the studio (C) writes these tables,
// the ledger only reads them. Returns the campaign id and terms version.
//
// This used to borrow a seeded ID campaign that had no `reward_config` row
// yet (a `LEFT JOIN … WHERE r.campaign_id IS NULL`, the exact TS shape
// `ledger-client.contract.spec.ts`'s own `rewardedCampaign()` had). Once
// `seed/watch.ts` (5.1.b) started funding and configuring every seeded
// campaign with `reward_points > 0`, no such unconfigured campaign was
// left to find, and every caller of this helper `t.Skip`ped — which CI
// treats as a hard failure for a Postgres-backed test, not a pass. Owning a
// fresh row removes the dependency on the seeded catalogue's shape
// entirely: this helper does not need to reuse fixture data, it needs a
// campaign, and it can make one. Only `campaign.campaigns`'s own DB-level
// CHECK/NOT NULL constraints apply here — this package never reads through
// `campaignSchema` (that is `apps/api`'s job), so no `video_source` or
// `chapter` row is needed, unlike the TS fixture's equivalent fix.
type liveCampaign struct {
	ID, Owner, Allocation string
	Terms                 int
}

func newLiveCampaign(t *testing.T, engine *reward.Engine, base, bonus int64, maxPoints int64) liveCampaign {
	t.Helper()
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, testdb.URL(t, "DATABASE_OWNER_URL"))
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Close()

	var c liveCampaign
	if err := owner.QueryRow(ctx, `
		INSERT INTO campaign.campaigns
			(id, kind, title, merchant_id, merchant_name, synopsis, duration_seconds,
			 estimated_data_mb, reward_points, question_count, scoring_rule,
			 lifecycle_state, published_at, business_id, region, audience, content_category,
			 poster_url, teaser_url, hls_url, aspect, estimated_bytes,
			 starts_at, ends_at, open_viewing, teaser_start_seconds)
		VALUES
			(gen_random_uuid(), 'quick', 'reward engine contract fixture', gen_random_uuid(), 'reward-contract merchant',
			 'fixture', 30, 5, $1, 0, 'base_only',
			 'live', now(), gen_random_uuid(), 'ID', 'all_ages', 'entertainment',
			 'https://example.test/poster.jpg', 'https://example.test/teaser.m3u8',
			 'https://example.test/hls.m3u8', '16:9', 1000000,
			 now(), now() + interval '30 days', false, 0)
		RETURNING id::text, business_id::text`, base).Scan(&c.ID, &c.Owner); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, err := pgxpool.New(context.Background(), testdb.URL(t, "DATABASE_OWNER_URL"))
		if err == nil {
			// campaign.chapter, .terms_version and .reward_config all
			// cascade off campaign.campaigns; this owns the whole row.
			_, _ = cleanup.Exec(context.Background(), `DELETE FROM campaign.campaigns WHERE id = $1`, c.ID)
			cleanup.Close()
		}
	})
	if err := owner.QueryRow(ctx, `SELECT COALESCE(max(version), 0) + 1 FROM campaign.terms_version WHERE campaign_id = $1`,
		c.ID).Scan(&c.Terms); err != nil {
		t.Fatal(err)
	}
	rule := "base_only"
	questions := 0
	if bonus > 0 {
		rule, questions = "base_plus_accuracy_bonus", 3
	}
	for _, stmt := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO campaign.terms_version (campaign_id, version, reward_points, question_count, scoring_rule,
			duration_seconds, effective_from, accuracy_bonus_points) VALUES ($1, $2, $3, $4, $5, 600, now(), $6)`,
			[]any{c.ID, c.Terms, base, questions, rule, bonus}},
		{`UPDATE campaign.campaigns SET lifecycle_state = 'live' WHERE id = $1`, []any{c.ID}},
	} {
		if _, err := owner.Exec(ctx, stmt.sql, stmt.args...); err != nil {
			t.Fatal(err)
		}
	}
	bought, err := engine.RecordPurchase(ctx, reward.PurchaseRequest{
		ID: unique("pur"), PartnerID: c.Owner, Points: 100_000, AmountMinor: 900_000, Currency: "IDR",
	})
	if err != nil {
		t.Fatal(err)
	}
	c.Allocation = bought.AllocationID
	if _, err := owner.Exec(ctx, `INSERT INTO campaign.reward_config (campaign_id, allocation_id, funder_type,
		max_points_for_campaign, reward_points_per_completion, accuracy_bonus_points) VALUES ($1, $2, 'partner', $3, $4, $5)`,
		c.ID, c.Allocation, maxPoints, base, bonus); err != nil {
		t.Fatal(err)
	}
	// No separate reward_config cleanup: the campaign-row cleanup above
	// already cascades it away, along with terms_version and chapter.
	return c
}

// reward builds a signed reward request for user on c.
func (c liveCampaign) reward(user string, points int64, asked, correct, tier int) reward.RewardRequest {
	completion := attest.Completion{SessionID: unique("session"), UserID: user, CampaignID: c.ID,
		TermsVersion: c.Terms, CompletedAt: time.Now().UTC().Truncate(time.Second), Asked: asked, Correct: correct}
	return reward.RewardRequest{CampaignID: c.ID, UserID: user, Points: points, TrustTier: tier,
		IdempotencyKey: unique("key"), Completion: completion, Signature: attest.Sign(attestationSecret, completion)}
}
