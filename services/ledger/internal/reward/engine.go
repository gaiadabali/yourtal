package reward

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
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
	Now          time.Time
}

// GrantResult is what was paid, and from where.
type GrantResult struct {
	GrantID    string
	TransferID string
	Points     int64
}

// Engine is the sole path from a verified action to a points credit.
type Engine struct {
	pool   *pgxpool.Pool
	ledger *ledger.Ledger
	risk   RiskGate
	// region scopes every account this engine touches. One engine per
	// economy; AU and ID never share an account or a transfer.
	region ledger.Region
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
//  4. velocity — user, device and IP caps, counted from the grant log
//  5. drawdown — atomically take the points out of a funded allocation
//  6. ledger — post the transfer
//  7. grant log — record it, which is what step 4 counts next time
//
// Steps 5 to 7 share one transaction. If the ledger post fails, the drawdown
// rolls back with it: an allocation must never be decremented for points
// that were not issued, because that quietly destroys funding nobody can
// account for.
func (e *Engine) Grant(ctx context.Context, req GrantRequest) (GrantResult, error) {
	definition, known := Definition(req.Action)
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

	if err := e.checkVelocity(ctx, req, definition); err != nil {
		return GrantResult{}, err
	}

	return e.issue(ctx, req, definition)
}

// checkVelocity enforces the three caps against the grant log.
//
// Counted from the log rather than from a counter, because a cap enforced
// against something lossy is not a cap — a dropped metric or an evicted
// cache key becomes free points, and the attacker who notices first is the
// one it was meant to stop.
func (e *Engine) checkVelocity(ctx context.Context, req GrantRequest, def ActionDefinition) error {
	queries := sqlcgen.New(e.pool)
	// pgtype.Timestamptz, not time.Time: sqlc types a nullable timestamptz
	// column this way, and going through it keeps the zero value explicit
	// rather than silently sending 0001-01-01.
	since := pgtype.Timestamptz{Time: req.Now.Add(-VelocityWindow), Valid: true}

	perUser, err := queries.CountGrantsForUserSince(ctx, sqlcgen.CountGrantsForUserSinceParams{
		UserID: req.UserID, ActionType: string(req.Action), CreatedAt: since,
	})
	if err != nil {
		return fmt.Errorf("counting user grants: %w", err)
	}
	if perUser.Grants >= int64(def.MaxPerUserPerDay) {
		return fmt.Errorf("%w: %d of %d for %s",
			ErrUserCapReached, perUser.Grants, def.MaxPerUserPerDay, req.Action)
	}

	// Device and IP caps span ALL actions. A per-action cap alone is defeated
	// by doing several different actions from one farm (docs/14 §3).
	if req.DeviceID != "" {
		count, err := queries.CountGrantsForDeviceSince(ctx, sqlcgen.CountGrantsForDeviceSinceParams{
			DeviceID: &req.DeviceID, CreatedAt: since,
		})
		if err != nil {
			return fmt.Errorf("counting device grants: %w", err)
		}
		if count >= DeviceGrantsPerDay {
			return fmt.Errorf("%w: %d today", ErrDeviceCapReached, count)
		}
	}

	if req.IPAddress != "" {
		count, err := queries.CountGrantsForIpSince(ctx, sqlcgen.CountGrantsForIpSinceParams{
			IpAddress: &req.IPAddress, CreatedAt: since,
		})
		if err != nil {
			return fmt.Errorf("counting ip grants: %w", err)
		}
		if count >= IPGrantsPerDay {
			return fmt.Errorf("%w: %d today", ErrIPCapReached, count)
		}
	}

	return nil
}

// issue draws down the allocation, posts to the ledger and records the
// grant — all in one transaction, so none of the three can happen without
// the others.
func (e *Engine) issue(
	ctx context.Context, req GrantRequest, def ActionDefinition,
) (GrantResult, error) {
	var result GrantResult

	// The ledger's retry policy, not a second copy of it. Concurrent grants
	// against one allocation conflict heavily under SERIALIZABLE — see
	// ledger.WithSerializableRetry for why the backoff and jitter matter.
	// Without it, contention would look exactly like an exhausted
	// allocation to a caller, which is the one confusion this gate cannot
	// afford: "we are out of funding" and "try again" need different answers.
	err := ledger.WithSerializableRetry(ctx, e.pool,
		func(tx pgx.Tx) error {
			queries := sqlcgen.New(tx)

			// K6, structurally. The statement is
			// `UPDATE ... WHERE remaining_points >= $n`, so an exhausted
			// allocation matches no row and nothing is issued. A read-then-
			// write would let two concurrent grants both see enough and both
			// draw — which is precisely how unfunded points get minted.
			allocation, err := queries.DrawDownAllocation(ctx, sqlcgen.DrawDownAllocationParams{
				ID: req.AllocationID, RemainingPoints: def.Points,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				return fmt.Errorf("%w: %s cannot fund %d points",
					ErrAllocationExhausted, req.AllocationID, def.Points)
			}
			if err != nil {
				return fmt.Errorf("drawing down allocation: %w", err)
			}

			entries := e.postingFor(def, allocation.FunderType, req.UserID)
			transferID := fmt.Sprintf("led_txn_%s_%s", req.Action, req.ExternalRef)

			if err := e.ensureUserAccount(ctx, queries, req.UserID); err != nil {
				return err
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

			grantID := fmt.Sprintf("grt_%s_%s", req.Action, req.ExternalRef)
			if err := queries.InsertGrant(ctx, sqlcgen.InsertGrantParams{
				ID:           grantID,
				UserID:       req.UserID,
				ActionType:   string(req.Action),
				TaxonomyVer:  TaxonomyVersion,
				Points:       def.Points,
				AllocationID: allocation.ID,
				TransferID:   transfer.TransferID,
				DeviceID:     optional(req.DeviceID),
				IpAddress:    optional(req.IPAddress),
				ExternalRef:  req.ExternalRef,
			}); err != nil {
				if isUniqueViolation(err) {
					return fmt.Errorf("%w: %s/%s", ErrAlreadyGranted, req.Action, req.ExternalRef)
				}
				return fmt.Errorf("recording grant: %w", err)
			}

			result = GrantResult{
				GrantID: grantID, TransferID: transfer.TransferID, Points: def.Points,
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
// or the platform (marketing_expense).
func (e *Engine) postingFor(def ActionDefinition, funderType, userID string) []ledger.Entry {
	if def.MarketingFunded || funderType == "marketing" {
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
