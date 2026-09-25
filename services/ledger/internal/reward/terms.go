package reward

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/ledger/internal/attest"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// A campaign reward is paid what the partner set, once (4.4.a-d). The
// amount comes from the terms version the viewer watched under, never from
// the campaign's editable config, and only on a completion apps/api attests.

var (
	// ErrAttestation — no verifiable completion attestation (EW-12).
	ErrAttestation = errors.New("reward: the completion attestation does not verify")
	// ErrCampaignNotLive — the campaign is unknown, or not live.
	ErrCampaignNotLive = errors.New("reward: the campaign is not live")
	// ErrPointsMismatch — the caller's points are not what the terms pay.
	ErrPointsMismatch = errors.New("reward: the points are not what the campaign's terms pay")
)

const scoringWithBonus = "base_plus_accuracy_bonus"

// WithAttestationSecret sets the key apps/api signs completions with.
func (e *Engine) WithAttestationSecret(secret []byte) *Engine {
	e.attestationSecret = secret
	return e
}

// TermsPoints is what a completion earns under its terms (4.4.b): the base,
// plus floor(bonus × correct ÷ asked) when the terms score accuracy. A
// timed-out question counts as asked and wrong (F10), so the base is always
// earned by a completed watch.
func TermsPoints(base, bonus int64, scoringRule string, asked, correct int) int64 {
	if scoringRule != scoringWithBonus || asked <= 0 {
		return base
	}
	return base + bonus*int64(correct)/int64(asked)
}

// campaignGrant resolves a reward request into the grant it may make: the
// points from the frozen terms, and the owner's partner allocation.
func (e *Engine) campaignGrant(ctx context.Context, req RewardRequest) (GrantRequest, error) {
	c := req.Completion
	if len(e.attestationSecret) < attest.MinSecretBytes {
		return GrantRequest{}, fmt.Errorf("%w: no attestation secret is configured", ErrAttestation)
	}
	if err := attest.Verify(e.attestationSecret, c, req.Signature); err != nil {
		return GrantRequest{}, fmt.Errorf("%w: %w", ErrAttestation, err)
	}
	if c.UserID != req.UserID || c.CampaignID != req.CampaignID {
		return GrantRequest{}, fmt.Errorf("%w: it attests another user or campaign", ErrAttestation)
	}

	q := sqlcgen.New(e.pool)
	campaign := optionalUUID(req.CampaignID)
	owner, err := q.GetCampaignOwner(ctx, campaign)
	if errors.Is(err, pgx.ErrNoRows) {
		return GrantRequest{}, fmt.Errorf("%w: no campaign %s", ErrCampaignNotLive, req.CampaignID)
	}
	if err != nil {
		return GrantRequest{}, fmt.Errorf("reading the campaign: %w", err)
	}
	if owner.State != "live" {
		return GrantRequest{}, fmt.Errorf("%w: %s is %s", ErrCampaignNotLive, req.CampaignID, owner.State)
	}
	if owner.Region != string(e.region) {
		return GrantRequest{}, fmt.Errorf("%w: campaign %s is in %s", ErrRegionMismatch, req.CampaignID, owner.Region)
	}
	terms, err := q.GetCampaignTerms(ctx, sqlcgen.GetCampaignTermsParams{CampaignID: campaign, Version: int32(c.TermsVersion)})
	if errors.Is(err, pgx.ErrNoRows) {
		return GrantRequest{}, fmt.Errorf("%w: no terms version %d", ErrCampaignNotLive, c.TermsVersion)
	}
	if err != nil {
		return GrantRequest{}, fmt.Errorf("reading the terms: %w", err)
	}
	points := TermsPoints(terms.RewardPoints, terms.AccuracyBonusPoints, terms.ScoringRule, c.Asked, c.Correct)
	if req.Points != points {
		return GrantRequest{}, fmt.Errorf("%w: %d asked, the terms pay %d", ErrPointsMismatch, req.Points, points)
	}

	config, err := q.GetRewardConfig(ctx, campaign)
	if errors.Is(err, pgx.ErrNoRows) {
		return GrantRequest{}, fmt.Errorf("%w: campaign %s has no reward config", ErrWrongFunder, req.CampaignID)
	}
	if err != nil {
		return GrantRequest{}, fmt.Errorf("reading the reward config: %w", err)
	}
	allocation, err := q.GetAllocationWithRegion(ctx, config.AllocationID)
	if err != nil {
		return GrantRequest{}, fmt.Errorf("%w: allocation %s: %w", ErrWrongFunder, config.AllocationID, err)
	}
	// EM-05/EM-16: only the campaign owner's own purchased points, in the
	// campaign's region, pay its viewers.
	if allocation.FunderType != "partner" || allocation.FunderID != uuidText(owner.BusinessID) ||
		allocation.Region == nil || *allocation.Region != owner.Region {
		return GrantRequest{}, fmt.Errorf("%w: allocation %s is not %s's partner allocation in %s",
			ErrWrongFunder, config.AllocationID, uuidText(owner.BusinessID), owner.Region)
	}

	def, _ := Definition(ActionWatchCompleted)
	def.Points, def.Evidence, def.MarketingFunded = points, EvidenceNone, false
	return GrantRequest{
		UserID: req.UserID, Action: ActionWatchCompleted, ExternalRef: req.CampaignID,
		AllocationID: config.AllocationID, HoldID: req.HoldID, CampaignID: req.CampaignID,
		IdempotencyKey: req.IdempotencyKey, def: &def, completion: &c,
		campaignMax: config.MaxPointsForCampaign,
	}, nil
}

// checkCampaignMax keeps a campaign's total grants within its maximum,
// bonus included, under a per-campaign lock inside the grant's transaction.
func checkCampaignMax(ctx context.Context, q *sqlcgen.Queries, req GrantRequest, points int64) error {
	if req.CampaignID == "" || req.campaignMax <= 0 {
		return nil
	}
	if err := q.LockCampaignGrants(ctx, req.CampaignID); err != nil {
		return fmt.Errorf("locking the campaign's grants: %w", err)
	}
	spent, err := q.CampaignSpend(ctx, optionalUUID(req.CampaignID))
	if err != nil {
		return fmt.Errorf("reading the campaign's spend: %w", err)
	}
	if spent.GrantedPoints+points > req.campaignMax {
		return fmt.Errorf("%w: %d spent, %d more would pass %d", ErrOverCampaignMax, spent.GrantedPoints, points, req.campaignMax)
	}
	return nil
}

func uuidText(id pgtype.UUID) string {
	if !id.Valid {
		return ""
	}
	b := id.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func completionSession(c *attest.Completion) *string {
	if c == nil {
		return nil
	}
	return &c.SessionID
}

func completionInt(c *attest.Completion, field func(*attest.Completion) int) *int32 {
	if c == nil {
		return nil
	}
	value := int32(field(c))
	return &value
}
