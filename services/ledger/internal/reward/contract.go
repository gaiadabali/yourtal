package reward

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/ledger/internal/attest"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/settings"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// The ledger-internal contract's earning operations (grantReward,
// grantAction, purchasePoints), on top of Grant and RecordPurchase.

// ErrOverCampaignMax — more points than one completion of the campaign may
// earn (reward_config: per completion plus the accuracy bonus).
var ErrOverCampaignMax = errors.New("reward: more than one completion of this campaign may earn")

// RewardRequest is grantReward: one completed campaign.
type RewardRequest struct {
	CampaignID     string
	UserID         string
	Points         int64
	TrustTier      int
	IdempotencyKey string
	HoldID         string
	// Completion and Signature are apps/api's attestation (4.4.c).
	Completion attest.Completion
	Signature  string
}

// GrantReward pays a completed campaign what its frozen terms promise, on a
// completion apps/api attests, from the owner's partner allocation, once per
// user per campaign (4.4.a-d). A replay of the same key returns the grant;
// the same key with other points is a conflict.
func (e *Engine) GrantReward(ctx context.Context, req RewardRequest) (GrantResult, error) {
	grant, err := e.campaignGrant(ctx, req)
	if err != nil {
		return GrantResult{}, err
	}
	return e.contractGrant(ctx, grant, req.TrustTier)
}

// ActionRequest is grantAction: a streak, receipt or goodwill credit.
type ActionRequest struct {
	Kind           string // streak | receipt | goodwill
	UserID         string
	Points         int64
	TrustTier      int
	IdempotencyKey string
}

var actionKinds = map[string]ActionType{
	"streak": ActionDailyStreak, "receipt": ActionReceiptScanned, "goodwill": ActionGoodwill,
}

// GrantAction pays a marketing-funded action from the region's marketing
// budget; every point is backed by marketing cash as it is issued (K6).
func (e *Engine) GrantAction(ctx context.Context, req ActionRequest) (GrantResult, error) {
	action, known := actionKinds[req.Kind]
	if !known {
		return GrantResult{}, fmt.Errorf("%w: %q", ErrUnknownAction, req.Kind)
	}
	if req.Points <= 0 || req.IdempotencyKey == "" {
		return GrantResult{}, fmt.Errorf("reward: an action needs points and an idempotency key")
	}
	budget, err := e.marketingBudget(ctx)
	if err != nil {
		return GrantResult{}, err
	}
	def, _ := Definition(action)
	def.Points, def.Evidence = req.Points, EvidenceNone
	return e.contractGrant(ctx, GrantRequest{
		UserID: req.UserID, Action: action, ExternalRef: req.IdempotencyKey, AllocationID: budget,
		IdempotencyKey: req.IdempotencyKey, def: &def,
	}, req.TrustTier)
}

// contractGrant is Grant with the contract's replay rule and the tier's
// holdback.
func (e *Engine) contractGrant(ctx context.Context, req GrantRequest, tier int) (GrantResult, error) {
	prior, err := sqlcgen.New(e.pool).GetGrantByExternalRef(ctx, sqlcgen.GetGrantByExternalRefParams{
		UserID: req.UserID, ActionType: string(req.Action), ExternalRef: req.ExternalRef,
	})
	if err == nil {
		sameKey := prior.IdempotencyKey != nil && *prior.IdempotencyKey == req.IdempotencyKey
		switch {
		case sameKey && prior.Points == req.def.Points:
			return GrantResult{GrantID: prior.ID, Points: prior.Points, Region: e.region,
				GrantedAt: prior.CreatedAt.Time, UnlockAt: prior.UnlockAt.Time}, nil
		case sameKey:
			return GrantResult{}, fmt.Errorf("%w: %s was granted %d points",
				ledger.ErrIdempotencyConflict, req.IdempotencyKey, prior.Points)
		default:
			return GrantResult{}, fmt.Errorf("%w: %s/%s", ErrAlreadyGranted, req.Action, req.ExternalRef)
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return GrantResult{}, fmt.Errorf("reading an earlier grant: %w", err)
	}
	hours, err := e.holdbackHours(ctx, tier)
	if err != nil {
		return GrantResult{}, err
	}
	req.HoldbackHours = &hours
	return e.Grant(ctx, req)
}

// holdbackHours is the tier's holdback from the region's settings (F12).
func (e *Engine) holdbackHours(ctx context.Context, tier int) (int32, error) {
	if tier < 0 || tier > 3 {
		return 0, fmt.Errorf("reward: trust tier %d is not 0-3", tier)
	}
	raw, err := settings.New(e.pool).Get(ctx, string(e.region), "holdback_hours_by_tier")
	if err != nil {
		return 0, err
	}
	var byTier map[string]int32
	if raw == nil || json.Unmarshal(raw, &byTier) != nil {
		return 0, fmt.Errorf("%w: holdback_hours_by_tier for %s", ErrCapsNotConfigured, e.region)
	}
	hours, ok := byTier[fmt.Sprintf("tier%d", tier)]
	if !ok {
		return 0, fmt.Errorf("%w: no holdback for tier %d in %s", ErrCapsNotConfigured, tier, e.region)
	}
	return hours, nil
}

// marketingBudget is the region's standing marketing allocation. It is only
// a points budget: the limit that matters is marketing cash, checked on
// every grant (K6).
func (e *Engine) marketingBudget(ctx context.Context) (string, error) {
	id := "alloc_marketing_" + string(e.region)
	if _, err := sqlcgen.New(e.pool).GetAllocation(ctx, id); err == nil {
		return id, nil
	}
	if err := e.CreateAllocation(ctx, id, "marketing", "platform", marketingBudgetPoints); err != nil {
		// Another request created it first.
		if _, getErr := sqlcgen.New(e.pool).GetAllocation(ctx, id); getErr != nil {
			return "", err
		}
	}
	return id, nil
}

const marketingBudgetPoints = 1_000_000_000_000

// PurchasePoints is purchasePoints: RecordPurchase keyed by the caller's
// idempotency key. A replay returns the allocation it created; the same key
// with other amounts is a conflict.
func (e *Engine) PurchasePoints(ctx context.Context, req PurchaseRequest) (PurchaseResult, error) {
	prior, err := sqlcgen.New(e.pool).GetPointPurchase(ctx, req.ID)
	if err == nil {
		if prior.PartnerID != req.PartnerID || prior.Points != req.Points ||
			prior.AmountMinor != req.AmountMinor || prior.Currency != req.Currency {
			return PurchaseResult{}, fmt.Errorf("%w: purchase %s", ledger.ErrIdempotencyConflict, req.ID)
		}
		return PurchaseResult{PurchaseID: prior.ID, AllocationID: prior.AllocationID, CashTransfer: prior.CashTransferID}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return PurchaseResult{}, fmt.Errorf("reading an earlier purchase: %w", err)
	}
	return e.RecordPurchase(ctx, req)
}
