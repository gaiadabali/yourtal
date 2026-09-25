package reward

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// The errors a caller can expect. Discriminated so a surface can tell a user
// "you have hit today's limit" without also telling a farmer which control
// stopped them — the distinction matters to the product, and the mapping to
// a user-facing message is the API's job, not this package's.
var (
	// ErrUnknownAction — not in the versioned taxonomy. Refused rather than
	// priced at zero: a zero-point grant still consumes a velocity slot and
	// still writes a transfer.
	ErrUnknownAction = errors.New("reward: action is not in the taxonomy")
	// ErrEvidenceMissing — the action requires evidence that was not given.
	ErrEvidenceMissing = errors.New("reward: required evidence was not presented")
	// ErrUserCapReached — this person has had their fill of this action today.
	ErrUserCapReached = errors.New("reward: per-user daily cap reached")
	// ErrDeviceCapReached — this device has, across all actions.
	ErrDeviceCapReached = errors.New("reward: per-device daily cap reached")
	// ErrIPCapReached — this address has, across all actions.
	ErrIPCapReached = errors.New("reward: per-IP daily cap reached")
	// ErrRiskRefused — the risk gate said no.
	ErrRiskRefused = errors.New("reward: refused by the risk gate")
	// ErrAllocationExhausted is K6 biting. There is no path around it: the
	// drawdown statement matches no row, so no points are issued. A Reward
	// Engine that can mint without an allocation is the single failure mode
	// K6 exists to prevent.
	ErrAllocationExhausted = errors.New("reward: funding allocation is exhausted")
	// ErrAlreadyGranted — this external reference was already paid.
	ErrAlreadyGranted = errors.New("reward: this action was already granted")
	// ErrRegionMismatch — the user, money or accounts belong to the other region.
	ErrRegionMismatch = errors.New("reward: region mismatch")
)

// RiskGate decides whether a principal may earn at all.
//
// An interface because the real one (YT-0054) does not exist yet, and
// because docs/18 §9 is explicit that the engine gets smarter only in its
// INPUTS. Note the shape: it returns a decision, not a multiplier. A gate
// that could scale the reward would be arithmetic, and two users completing
// the same campaign would quietly be paid differently.
type RiskGate interface {
	Allow(ctx context.Context, userID string, action ActionType) (bool, error)
}

// AlwaysAllow is the placeholder gate until YT-0054 lands.
//
// Deliberately named so it cannot be mistaken for a real control in a stack
// trace or a wiring diagram.
type AlwaysAllow struct{}

func (AlwaysAllow) Allow(context.Context, string, ActionType) (bool, error) { return true, nil }

// GrantRequest is one verified action asking to be paid.
type GrantRequest struct {
	UserID string
	Action ActionType
	// ExternalRef is the caller's own id for the action — a watch session, a
	// receipt, a referral. Unique per (user, action), so the same real-world
	// event cannot be paid twice even if the caller retries with a fresh
	// idempotency key.
	ExternalRef string
	// Evidence is whatever the taxonomy requires. Presence is checked here;
	// validity belongs to whoever owns that evidence.
	Evidence string
	// AllocationID is the funded block this draws from. Mandatory — that is
	// the whole point.
	AllocationID string
	DeviceID     string
	IPAddress    string
	// HoldID is the reward session's hold (Hold), when it has one.
	HoldID string
	// CampaignID is set for campaign rewards.
	CampaignID string
	// HoldbackHours is the trust tier's holdback (4.4.g): the grant unlocks
	// at now() + this. 0 releases it at once; nil leaves it in pending with
	// no unlock time (callers that predate holdback).
	HoldbackHours *int32
	// IdempotencyKey is the caller's key, stored with the grant.
	IdempotencyKey string

	// def replaces the taxonomy entry, for the contract's grants whose
	// points the caller sets (GrantReward, GrantAction).
	def *ActionDefinition
}

// GrantResult is what was paid, and from where.
type GrantResult struct {
	GrantID    string
	TransferID string
	Points     int64
	Region     ledger.Region
	GrantedAt  time.Time
	// UnlockAt is when the points become spendable; zero when the grant has
	// no holdback schedule.
	UnlockAt time.Time
}

// Engine is the sole path from a verified action to a points credit.
type Engine struct {
	pool   *pgxpool.Pool
	ledger *ledger.Ledger
	risk   RiskGate
	// region scopes every account this engine touches. One engine per
	// economy; AU and ID never share an account or a transfer.
	region ledger.Region
	// capsOverride replaces the settings read; tests only (WithCaps).
	capsOverride *Caps
}

func New(pool *pgxpool.Pool, book *ledger.Ledger, risk RiskGate, region ledger.Region) *Engine {
	return &Engine{pool: pool, ledger: book, risk: risk, region: region}
}

// Grant evaluates an action and, if everything passes, credits the user.
//
// # The order of the checks is the design
//
// Every gate that can refuse runs BEFORE the ledger is touched, and the
// funding drawdown happens in the same transaction as the grant record. The
// sequence:
//
//  1. taxonomy — is this an action we pay for at all?
//  2. evidence — was the thing it requires presented?
//  3. risk gate — is this principal allowed to earn?
//  4. caps — per-action, device, IP, daily and monthly, counted from the
//     grant log under a per-user lock on the database's clock
//  5. drawdown — atomically take the points out of a funded allocation
//  6. ledger — post the transfer
//  7. grant log — record it, which is what step 4 counts next time
//
// Steps 4 to 7 share one transaction. If the ledger post fails, the drawdown
// rolls back with it: an allocation must never be decremented for points
// that were not issued, because that quietly destroys funding nobody can
// account for.
func (e *Engine) Grant(ctx context.Context, req GrantRequest) (GrantResult, error) {
	definition, known := Definition(req.Action)
	if req.def != nil {
		definition, known = *req.def, true
	}
	if !known {
		return GrantResult{}, fmt.Errorf("%w: %q", ErrUnknownAction, req.Action)
	}

	if definition.Evidence != EvidenceNone && req.Evidence == "" {
		return GrantResult{}, fmt.Errorf("%w: %s requires %s",
			ErrEvidenceMissing, req.Action, definition.Evidence)
	}

	allowed, err := e.risk.Allow(ctx, req.UserID, req.Action)
	if err != nil {
		return GrantResult{}, fmt.Errorf("risk gate: %w", err)
	}
	if !allowed {
		return GrantResult{}, ErrRiskRefused
	}

	return e.issue(ctx, req, definition)
}

// issue draws down the allocation, posts to the ledger and records the
// grant — all in one transaction, so none of the three can happen without
// the others.
func (e *Engine) issue(
	ctx context.Context, req GrantRequest, def ActionDefinition,
) (GrantResult, error) {
	var result GrantResult

	caps, err := e.Caps(ctx)
	if err != nil {
		return GrantResult{}, err
	}

	// The ledger's retry policy, not a second copy of it. Concurrent grants
	// against one allocation conflict heavily under SERIALIZABLE — see
	// ledger.WithSerializableRetry for why the backoff and jitter matter.
	// Without it, contention would look exactly like an exhausted
	// allocation to a caller, which is the one confusion this gate cannot
	// afford: "we are out of funding" and "try again" need different answers.
	// The per-user lock is taken on the session BEFORE the transaction, so
	// the transaction's snapshot already includes the previous grant. Taken
	// inside it, a waiter would wake on a stale snapshot, be aborted by SSI
	// and retry with backoff: correct, but slow under contention.
	conn, err := e.pool.Acquire(ctx)
	if err != nil {
		return GrantResult{}, fmt.Errorf("acquiring a connection: %w", err)
	}
	defer conn.Release()
	session := sqlcgen.New(conn)
	if err := session.LockUserGrantsSession(ctx, req.UserID); err != nil {
		return GrantResult{}, fmt.Errorf("locking the user's grants: %w", err)
	}
	defer func() { _ = session.UnlockUserGrantsSession(context.WithoutCancel(ctx), req.UserID) }()

	err = ledger.WithSerializableRetry(ctx, conn,
		func(tx pgx.Tx) error {
			queries := sqlcgen.New(tx)

			if err := queries.LockUserGrants(ctx, req.UserID); err != nil {
				return fmt.Errorf("locking the user's grants: %w", err)
			}
			// The region's platform accounts exist before anything posts to
			// them, even on a database nobody has bought or funded in yet.
			if err := ensureChart(ctx, queries, e.region); err != nil {
				return err
			}
			if err := e.checkCaps(ctx, queries, req, def, caps); err != nil {
				return err
			}

			// K6, structurally: the allocation verbs are the only way points
			// leave an allocation, and an exhausted one draws nothing.
			ref := fmt.Sprintf("%s_%s_%s", req.UserID, req.Action, req.ExternalRef)
			allocation, err := drawFor(ctx, queries, req, ref, def.Points)
			if err != nil {
				return err
			}

			if err := checkFunder(def, allocation.FunderType); err != nil {
				return err
			}
			entries := e.postingFor(def, req.UserID)
			// Ids carry the user: two users may share an external ref (EM-17).
			transferID := "led_txn_" + ref

			if err := e.ensureUserAccount(ctx, queries, req.UserID); err != nil {
				return err
			}
			if def.MarketingFunded {
				if err := e.checkSolvency(ctx, queries); err != nil {
					return err
				}
				if err := e.backMarketingGrant(ctx, tx, queries, ref, def.Points); err != nil {
					return err
				}
			}

			transfer, err := e.ledger.TransferInTx(ctx, tx, ledger.TransferRequest{
				ID:             transferID,
				IdempotencyKey: fmt.Sprintf("reward_%s_%s_%s", req.UserID, req.Action, req.ExternalRef),
				ReasonCode:     string(req.Action),
				Entries:        entries,
			})
			if err != nil {
				return err
			}

			grantID := fmt.Sprintf("grt_%s_%s_%s", req.UserID, req.Action, req.ExternalRef)
			region := string(e.region)
			recorded, err := queries.InsertGrant(ctx, sqlcgen.InsertGrantParams{
				ID:             grantID,
				UserID:         req.UserID,
				ActionType:     string(req.Action),
				TaxonomyVer:    TaxonomyVersion,
				Points:         def.Points,
				AllocationID:   allocation.ID,
				TransferID:     transfer.TransferID,
				DeviceID:       optional(req.DeviceID),
				IpAddress:      optional(req.IPAddress),
				ExternalRef:    req.ExternalRef,
				CampaignID:     optionalUUID(req.CampaignID),
				Region:         &region,
				HoldbackHours:  req.HoldbackHours,
				IdempotencyKey: optional(req.IdempotencyKey),
			})
			if err != nil {
				if isUniqueViolation(err) {
					return fmt.Errorf("%w: %s/%s", ErrAlreadyGranted, req.Action, req.ExternalRef)
				}
				return fmt.Errorf("recording grant: %w", err)
			}
			if req.HoldbackHours != nil && *req.HoldbackHours == 0 {
				if err := e.releaseInTx(ctx, tx, queries, grantID, req.UserID, def.Points); err != nil {
					return err
				}
			}

			result = GrantResult{
				GrantID: grantID, TransferID: transfer.TransferID, Points: def.Points,
				Region: e.region, GrantedAt: recorded.CreatedAt.Time, UnlockAt: recorded.UnlockAt.Time,
			}
			return nil
		})

	if err != nil {
		return GrantResult{}, err
	}
	return result, nil
}

// postingFor picks the ledger pattern. Both credit the user's pending
// account identically; the debit says who paid: the partner (points_issued)
// or the platform (marketing_expense). checkFunder has already matched the
// allocation to the action.
func (e *Engine) postingFor(def ActionDefinition, userID string) []ledger.Entry {
	if def.MarketingFunded {
		return ledger.GrantMarketing(e.region, userID, def.Points)
	}
	return ledger.GrantPartner(e.region, userID, def.Points)
}

// ensureUserAccount creates the user's points accounts on first earn, and
// refuses a user whose accounts already live in the other region.
func (e *Engine) ensureUserAccount(ctx context.Context, q *sqlcgen.Queries, userID string) error {
	for _, account := range ledger.UserAccounts(userID, e.region) {
		if err := insertAccount(ctx, q, account); err != nil {
			return err
		}
	}
	existing, err := q.GetAccount(ctx, ledger.UserAccountID(userID, ledger.PurposeAvailable))
	if err != nil {
		return fmt.Errorf("reading user points account: %w", err)
	}
	if existing.Country != string(e.region) {
		return fmt.Errorf("%w: user %s is in %s, not %s", ErrRegionMismatch, userID, existing.Country, e.region)
	}
	return nil
}

func optional(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
