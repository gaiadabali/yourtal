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

// liveCampaign is a seeded ID campaign made live with a terms version
// (base, bonus, scoring rule) and a reward config paid from its own owner's
// purchased allocation. As the owner: the studio (C) writes these tables,
// the ledger only reads them. Returns the campaign id and terms version.
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
	if err := owner.QueryRow(ctx, `SELECT c.id::text, c.business_id::text FROM campaign.campaigns c
		LEFT JOIN campaign.reward_config r ON r.campaign_id = c.id
		WHERE r.campaign_id IS NULL AND c.region = 'ID' ORDER BY random() LIMIT 1`).Scan(&c.ID, &c.Owner); err != nil {
		t.Skipf("no seeded ID campaign without a reward config: %v", err)
	}
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
	t.Cleanup(func() {
		cleanup, err := pgxpool.New(context.Background(), testdb.URL(t, "DATABASE_OWNER_URL"))
		if err == nil {
			_, _ = cleanup.Exec(context.Background(), `DELETE FROM campaign.reward_config WHERE campaign_id = $1`, c.ID)
			cleanup.Close()
		}
	})
	return c
}

// reward builds a signed reward request for user on c.
func (c liveCampaign) reward(user string, points int64, asked, correct, tier int) reward.RewardRequest {
	completion := attest.Completion{SessionID: unique("session"), UserID: user, CampaignID: c.ID,
		TermsVersion: c.Terms, CompletedAt: time.Now().UTC().Truncate(time.Second), Asked: asked, Correct: correct}
	return reward.RewardRequest{CampaignID: c.ID, UserID: user, Points: points, TrustTier: tier,
		IdempotencyKey: unique("key"), Completion: completion, Signature: attest.Sign(attestationSecret, completion)}
}
