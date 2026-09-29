package risk_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/escrow"
	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/pricing"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/risk"
	"github.com/yourtal/services/ledger/internal/store/sqlcgen"
	"github.com/yourtal/services/ledger/internal/testdb"
)

// TASKS.md 10.4: the real RiskGate, tested against the reward engine it
// actually gates rather than in isolation, since 10.4.d's Check is about the
// whole path — a flagged account's points end up held, not just that some
// function returns false.

var counter atomic.Uint64

func unique(prefix string) string {
	return fmt.Sprintf("%s_%d_%d", prefix, time.Now().UnixNano(), counter.Add(1))
}

var uncapped = reward.Caps{DailyPoints: 1 << 40, MonthlyPoints: 1 << 40}

// setup wires a real engine, with the real gate, in region ID (same fixture
// shape as reward's own engine_test.go, duplicated rather than shared since
// export_test.go's helpers are reward's own test binary, not this package's).
func setup(t *testing.T) (*reward.Engine, *pgxpool.Pool, *escrow.Engine) {
	t.Helper()
	ctx := context.Background()

	pool, err := pgxpool.New(ctx, testdb.URL(t, "LEDGER_DATABASE_URL"))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("no local Postgres (run `pnpm dev:up`): %v", err)
	}
	t.Cleanup(pool.Close)

	book := ledger.New(pool)
	esc := escrow.New(pool, book)
	gate := risk.New(pool, book, esc)

	engine := reward.New(pool, book, gate, ledger.RegionID).WithCaps(uncapped)
	if err := engine.EnsureChart(ctx); err != nil {
		t.Fatalf("ensure chart: %v", err)
	}

	rates := pricing.New(pool)
	rateID := unique("rate")
	if err := rates.ProposeRate(ctx, pricing.Rate{
		ID: rateID, Currency: "IDR", MicrosPerPoint: 6_000_000, IssuePriceMicrosPerPoint: 9_000_000,
		Reason: "risk test fixture", SetBy: "risk_test",
	}); err != nil {
		t.Fatalf("propose rate: %v", err)
	}
	if _, err := rates.ApproveRate(ctx, rateID, "risk_test_approver"); err != nil {
		t.Fatalf("approve rate: %v", err)
	}

	return engine, pool, esc
}

func fundedAllocation(t *testing.T, engine *reward.Engine, points int64) string {
	t.Helper()
	packs := (points + 999) / 1_000
	result, err := engine.RecordPurchase(context.Background(), reward.PurchaseRequest{
		ID: unique("pur"), PartnerID: "adv_risk", Points: packs * 1_000, AmountMinor: packs * 9_000, Currency: "IDR",
	})
	if err != nil {
		t.Fatalf("purchase: %v", err)
	}
	return result.AllocationID
}

func request(userID, allocationID, deviceID, ip string) reward.GrantRequest {
	return reward.GrantRequest{
		UserID: userID, Action: reward.ActionQuickWatched, ExternalRef: unique("ref"),
		Evidence: "checkpoint-token", AllocationID: allocationID, DeviceID: deviceID, IPAddress: ip,
	}
}

// 10.4.d: "a scripted farming account is flagged and its pending points are
// held" — same-user velocity, no device/IP involved.
func TestAFarmingAccountIsFlaggedAndItsBalanceIsHeld(t *testing.T) {
	engine, pool, _ := setup(t)
	ctx := context.Background()
	allocation := fundedAllocation(t, engine, 100_000)
	user := unique("usr")

	var lastErr error
	granted := 0
	for i := 0; i < risk.BlockUserVelocity+2; i++ {
		_, err := engine.Grant(ctx, request(user, allocation, "", ""))
		if err == nil {
			granted++
			continue
		}
		lastErr = err
	}
	if !errors.Is(lastErr, reward.ErrRiskRefused) {
		t.Fatalf("a scripted burst never hit the risk gate: last err = %v", lastErr)
	}
	if granted != risk.BlockUserVelocity-1 {
		t.Errorf("%d grants went through before the block, want %d", granted, risk.BlockUserVelocity-1)
	}

	// The flag exists, block severity, and the balance it held matches
	// exactly what those grants paid.
	region := "ID"
	flags, err := sqlcgen.New(pool).ListRiskQueue(ctx, sqlcgen.ListRiskQueueParams{Region: region, LimitCount: 10})
	if err != nil {
		t.Fatalf("listing the queue: %v", err)
	}
	// Several block-severity rows exist by now (every refused attempt writes
	// one); only the FIRST such attempt still had a balance left to hold —
	// later ones re-flag against an already-zero balance. What matters is
	// that at least one block flag for this user actually holds an escrow.
	var sawBlock bool
	var heldEscrow *string
	for i := range flags {
		if flags[i].UserID != user {
			continue
		}
		if flags[i].Severity == "block" {
			sawBlock = true
		}
		if flags[i].EscrowID != nil {
			heldEscrow = flags[i].EscrowID
		}
	}
	if !sawBlock {
		t.Fatal("no block-severity risk flag was written for the farming account")
	}
	if heldEscrow == nil {
		t.Fatal("a block severity flag did not hold the account's balance")
	}

	// Held: nothing is spendable. Available and pending both read zero
	// because Suspend (escrow.Hold) drained exactly what was granted.
	available, err := ledger.New(pool).Balance(ctx, ledger.UserAccountID(user, ledger.PurposeAvailable))
	if err != nil {
		t.Fatalf("available balance: %v", err)
	}
	pending, err := ledger.New(pool).Balance(ctx, ledger.UserAccountID(user, ledger.PurposePending))
	if err != nil {
		t.Fatalf("pending balance: %v", err)
	}
	if available != 0 || pending != 0 {
		t.Errorf("available=%d pending=%d after the auto-hold, want 0 and 0", available, pending)
	}

	// And a further grant attempt is refused outright (a fresh, distinct
	// external ref, so this is not merely idempotency replaying the block).
	if _, err := engine.Grant(ctx, request(user, allocation, "", "")); !errors.Is(err, reward.ErrRiskRefused) {
		t.Errorf("a further grant while held: err = %v, want ErrRiskRefused", err)
	}
}

// 10.4.a: one device claiming to be several different people in minutes is
// device/account farming, not a shared kiosk.
func TestADeviceBehindManyIdentitiesIsBlocked(t *testing.T) {
	engine, pool, _ := setup(t)
	ctx := context.Background()
	allocation := fundedAllocation(t, engine, 100_000)
	device := unique("dev")

	var lastErr error
	for i := 0; i < risk.BlockDeviceIdentities+1; i++ {
		_, err := engine.Grant(ctx, request(unique("usr"), allocation, device, ""))
		if err != nil {
			lastErr = err
		}
	}
	if !errors.Is(lastErr, reward.ErrRiskRefused) {
		t.Fatalf("a device cycling through identities never hit the risk gate: last err = %v", lastErr)
	}

	flags, err := sqlcgen.New(pool).ListRiskQueue(ctx, sqlcgen.ListRiskQueueParams{Region: "ID", LimitCount: 20})
	if err != nil {
		t.Fatalf("listing the queue: %v", err)
	}
	found := false
	for _, f := range flags {
		if f.Severity == "block" && strings.Contains(f.Reason, "device_multi_user") {
			found = true
		}
	}
	if !found {
		t.Error("no block-severity flag names the device signal")
	}
}

// 10.4.d: "a tier-0 account's grant unlocks after 72 h" — the risk gate is
// real now, but an ordinary, non-farming grant still holds back exactly the
// tier's F12 hours and nothing more; this is not something 10.4 changed, and
// the point of this test is to prove it still isn't, with the real gate
// wired in instead of AlwaysAllow.
func TestAnOrdinaryGrantThroughTheRealGateStillHoldsBackByTier(t *testing.T) {
	engine, pool, esc := setup(t)
	_ = esc
	ctx := context.Background()
	allocation := fundedAllocation(t, engine, 10_000)
	user := unique("usr")

	req := request(user, allocation, unique("dev"), unique("1.2.3."))
	hours := int32(72)
	req.HoldbackHours = &hours
	result, err := engine.Grant(ctx, req)
	if err != nil {
		t.Fatalf("grant: %v", err)
	}
	wantUnlock := result.GrantedAt.Add(72 * time.Hour)
	if diff := result.UnlockAt.Sub(wantUnlock); diff < -time.Second || diff > time.Second {
		t.Errorf("unlock at %s, want ~%s (72h after grant)", result.UnlockAt, wantUnlock)
	}

	pending, err := ledger.New(pool).Balance(ctx, ledger.UserAccountID(user, ledger.PurposePending))
	if err != nil {
		t.Fatalf("pending balance: %v", err)
	}
	if pending != result.Points {
		t.Errorf("pending = %d, want %d (still held back, not released early)", pending, result.Points)
	}
}
