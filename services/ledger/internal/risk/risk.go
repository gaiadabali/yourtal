// Package risk is TASKS.md 10.4's real RiskGate (YT-0054), replacing
// reward.AlwaysAllow. It checks velocity per user, device and IP; flags
// impossible flows (one device or IP behind several different identities in
// a short window); and folds in the caller's own timing-plausibility signal.
// The daily and monthly earn caps are NOT this package's job — those are
// already enforced live from platform.region_setting by
// reward.Engine.checkCaps (9.5.e), independently of whatever this gate
// decides. That includes the teen half of the cap (12.1.c): checkCaps reads
// RiskCheck.AgeBand's own copy of GrantRequest.AgeBand, not anything this
// gate computes.
//
// A flag is written to ledger.risk_flag whenever a signal fires (10.4.b).
// The severe case ("block") also refuses the grant AND auto-holds the
// account's current balance into escrow (10.4.d): a scripted farming
// account is flagged and its pending points held without waiting for a
// human to notice. The soft case ("flag") lets the grant through but still
// queues the account for 10.5's staff review.
package risk

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/escrow"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
)

// Thresholds for risk v1. F12 does not set these — they are this package's
// own tunable defaults, deliberately generous: the "a scripted farming
// account" fixture (10.4.d) sits well past them, and an ordinary user
// completing a handful of campaigns in a sitting sits well under them.
const (
	// Window every count below looks back across.
	Window = 10 * time.Minute

	// FlagUserVelocity/BlockUserVelocity: grants by the same user, any
	// action, inside Window.
	FlagUserVelocity  = 6
	BlockUserVelocity = 10

	// FlagDeviceIdentities/BlockDeviceIdentities: OTHER distinct users
	// granted from the same device inside Window, plus this one. Two
	// distinct people sharing a device in ten minutes happens; five does not.
	FlagDeviceIdentities  = 2
	BlockDeviceIdentities = 4

	// FlagIPIdentities/BlockIPIdentities: same, per IP address. Wider than
	// the device thresholds — a shared network (a household, a campus) is
	// ordinary; a single address behind a dozen accounts in ten minutes is not.
	FlagIPIdentities  = 4
	BlockIPIdentities = 8
)

// Signal is one thing the gate noticed, recorded verbatim in
// ledger.risk_flag.signals for a reviewer to read (10.5.a).
type Signal struct {
	Kind   string `json:"kind"`
	Detail string `json:"detail"`
}

// Gate is the real RiskGate.
type Gate struct {
	pool   *pgxpool.Pool
	ledger *ledger.Ledger
	escrow *escrow.Engine
}

func New(pool *pgxpool.Pool, book *ledger.Ledger, esc *escrow.Engine) *Gate {
	return &Gate{pool: pool, ledger: book, escrow: esc}
}

// Gate satisfies reward.RiskGate structurally (it imports reward for
// RiskCheck/ActionType; reward never imports risk — see engine.go's comment).
var _ reward.RiskGate = (*Gate)(nil)

// Allow implements reward.RiskGate.
func (g *Gate) Allow(ctx context.Context, check reward.RiskCheck) (bool, error) {
	signals, severity, err := g.assess(ctx, check)
	if err != nil {
		return false, fmt.Errorf("risk: assessing %s: %w", check.UserID, err)
	}
	if severity == "" {
		return true, nil
	}
	if _, err := g.flag(ctx, check, severity, signals); err != nil {
		return false, fmt.Errorf("risk: recording a %s flag for %s: %w", severity, check.UserID, err)
	}
	// "flag" still grants — a soft signal alone must not lock out a real
	// user. "block" refuses this grant; the balance the account already
	// holds is what flag() just moved into escrow.
	return severity != "block", nil
}

// assess reads every signal and folds them into one severity: "" (nothing),
// "flag" (queue it, still grant) or "block" (queue it, refuse, auto-hold).
func (g *Gate) assess(ctx context.Context, check reward.RiskCheck) ([]Signal, string, error) {
	q := sqlcgen.New(g.pool)
	since := pgtype.Timestamptz{Time: time.Now().Add(-Window), Valid: true}
	var signals []Signal
	severity := ""
	bump := func(sev string) {
		if sev == "block" {
			severity = "block"
		} else if severity == "" {
			severity = sev
		}
	}

	userCount, err := q.CountGrantsForUserSince(ctx, sqlcgen.CountGrantsForUserSinceParams{
		UserID: check.UserID, Since: since,
	})
	if err != nil {
		return nil, "", fmt.Errorf("counting user velocity: %w", err)
	}
	// +1: this attempt, if it is allowed, becomes the (userCount+1)th.
	switch {
	case userCount+1 >= BlockUserVelocity:
		signals = append(signals, Signal{Kind: "velocity_user", Detail: fmt.Sprintf("%d grants in %s", userCount+1, Window)})
		bump("block")
	case userCount+1 >= FlagUserVelocity:
		signals = append(signals, Signal{Kind: "velocity_user", Detail: fmt.Sprintf("%d grants in %s", userCount+1, Window)})
		bump("flag")
	}

	if check.DeviceID != "" {
		otherUsers, err := q.CountDistinctUsersForDeviceSince(ctx, sqlcgen.CountDistinctUsersForDeviceSinceParams{
			DeviceID: &check.DeviceID, UserID: check.UserID, Since: since,
		})
		if err != nil {
			return nil, "", fmt.Errorf("counting device identities: %w", err)
		}
		switch {
		case otherUsers+1 >= BlockDeviceIdentities:
			signals = append(signals, Signal{Kind: "device_multi_user", Detail: fmt.Sprintf("%d identities on one device in %s", otherUsers+1, Window)})
			bump("block")
		case otherUsers+1 >= FlagDeviceIdentities:
			signals = append(signals, Signal{Kind: "device_multi_user", Detail: fmt.Sprintf("%d identities on one device in %s", otherUsers+1, Window)})
			bump("flag")
		}
	}

	if check.IPAddress != "" {
		otherUsers, err := q.CountDistinctUsersForIpSince(ctx, sqlcgen.CountDistinctUsersForIpSinceParams{
			IpAddress: &check.IPAddress, UserID: check.UserID, Since: since,
		})
		if err != nil {
			return nil, "", fmt.Errorf("counting ip identities: %w", err)
		}
		switch {
		case otherUsers+1 >= BlockIPIdentities:
			signals = append(signals, Signal{Kind: "ip_multi_user", Detail: fmt.Sprintf("%d identities on one address in %s", otherUsers+1, Window)})
			bump("block")
		case otherUsers+1 >= FlagIPIdentities:
			signals = append(signals, Signal{Kind: "ip_multi_user", Detail: fmt.Sprintf("%d identities on one address in %s", otherUsers+1, Window)})
			bump("flag")
		}
	}

	if check.TimingSuspicious {
		signals = append(signals, Signal{Kind: "timing_implausible", Detail: "an answer arrived faster than the prompt could be read"})
		bump("flag")
	}

	return signals, severity, nil
}

// flag writes the queue row (10.4.b) and, for "block", auto-holds the
// account's current balance into escrow (10.4.d) — the same escrow package
// 9.4.b's staff suspend uses, so 10.5.a's release path is identical either
// way. A zero balance still writes the flag; there is simply nothing to hold.
func (g *Gate) flag(ctx context.Context, check reward.RiskCheck, severity string, signals []Signal) (string, error) {
	payload, err := json.Marshal(signals)
	if err != nil {
		return "", fmt.Errorf("marshalling signals: %w", err)
	}
	kinds := make([]string, len(signals))
	for i, s := range signals {
		kinds[i] = s.Kind
	}
	reason := strings.Join(kinds, ",")

	var escrowID *string
	if severity == "block" {
		held, err := g.holdBalance(ctx, check.UserID, "risk: "+reason)
		switch {
		case err == nil:
			id := held.ID
			escrowID = &id
		case errors.Is(err, ledger.ErrInsufficientFunds):
			// Nothing to hold (a fresh, zero-balance account farming ahead
			// of its first real grant) — still flag it, just no escrow.
		default:
			return "", err
		}
	}

	id := "rf_" + rand.Text()
	if _, err := sqlcgen.New(g.pool).InsertRiskFlag(ctx, sqlcgen.InsertRiskFlagParams{
		ID: id, UserID: check.UserID, Region: string(check.Region),
		Severity: severity, Reason: reason, Signals: payload, EscrowID: escrowID,
	}); err != nil {
		return "", fmt.Errorf("inserting risk flag: %w", err)
	}
	return id, nil
}

// holdBalance escrows everything the user currently holds, available and
// pending, the same total 9.4.b's own suspend handler computes.
func (g *Gate) holdBalance(ctx context.Context, userID, reason string) (escrow.Escrow, error) {
	available, err := g.ledger.Balance(ctx, ledger.UserAccountID(userID, ledger.PurposeAvailable))
	if err != nil {
		return escrow.Escrow{}, fmt.Errorf("reading available balance: %w", err)
	}
	pending, err := g.ledger.Balance(ctx, ledger.UserAccountID(userID, ledger.PurposePending))
	if err != nil {
		return escrow.Escrow{}, fmt.Errorf("reading pending balance: %w", err)
	}
	total := available + pending
	if total <= 0 {
		return escrow.Escrow{}, ledger.ErrInsufficientFunds
	}
	return g.escrow.Hold(ctx, escrow.Request{UserID: userID, Points: total, Reason: reason})
}
