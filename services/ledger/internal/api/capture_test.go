package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/serviceauth"
	"github.com/yourtal/services/ledger/internal/testdb"
)

// 4.6.f.2: services/voucher posts captures signed as "voucher".

func (s *server) callAs(caller, path string, body any, out any) int {
	s.t.Helper()
	payload, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/v1"+path, bytes.NewReader(payload))
	req.Header.Set(serviceauth.Header,
		serviceauth.Sign(secret, caller, unique("n"), http.MethodPost, "/v1"+path, payload, time.Now()))
	rec := httptest.NewRecorder()
	s.handler.ServeHTTP(rec, req)
	if out != nil && rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			s.t.Fatalf("%s answered %d %s: %v", path, rec.Code, rec.Body.String(), err)
		}
	}
	return rec.Code
}

// ensureChart does what main.go's boot does: a capture debits voucher_liability.
func ensureChart(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, testdb.URL(t, "LEDGER_DATABASE_URL"))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	for _, region := range []ledger.Region{ledger.RegionAU, ledger.RegionID} {
		if err := reward.New(pool, ledger.New(pool), reward.AlwaysAllow{}, region).EnsureChart(ctx); err != nil {
			t.Fatalf("ensure chart: %v", err)
		}
	}
	return pool
}

type capturePosting struct {
	CaptureID   string `json:"captureId"`
	MerchantID  string `json:"merchantId"`
	AmountMinor int64  `json:"amountMinor"`
	TransferID  string `json:"transferId"`
	PostedAt    string `json:"postedAt"`
}

func TestACaptureIsPostedOnceAndReplayed(t *testing.T) {
	s := newServer(t)
	pool := ensureChart(t)
	ctx := context.Background()
	merchant := uuid()
	body := map[string]any{
		"captureId": uuid(), "region": "AU", "merchantId": merchant, "amountMinor": 4_500, "currency": "AUD",
	}

	var first, replay capturePosting
	if code := s.callAs("voucher", "/captures", body, &first); code != http.StatusOK || first.TransferID == "" {
		t.Fatalf("capture: %d %+v", code, first)
	}
	if code := s.callAs("voucher", "/captures", body, &replay); code != http.StatusOK || replay != first {
		t.Fatalf("replay: %d %+v, want %+v", code, replay, first)
	}

	balance, err := ledger.New(pool).Balance(ctx, ledger.MerchantPayableID(merchant, ledger.RegionAU))
	if err != nil || balance != 4_500 {
		t.Fatalf("merchant payable = %d (%v), want 4500 once", balance, err)
	}
	var rows int
	if err := s.owner.QueryRow(ctx, `SELECT count(*) FROM ledger.capture WHERE capture_id = $1`, body["captureId"]).
		Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("ledger.capture rows = %d (%v), want 1", rows, err)
	}

	// The same id with a different amount is a conflict, and posts nothing.
	body["amountMinor"] = 5_000
	var refused problem
	if code := s.callAs("voucher", "/captures", body, &refused); code != http.StatusConflict || refused.Code != "idempotency_conflict" {
		t.Fatalf("conflict: %d %q", code, refused.Code)
	}
	if balance, _ := ledger.New(pool).Balance(ctx, ledger.MerchantPayableID(merchant, ledger.RegionAU)); balance != 4_500 {
		t.Fatalf("a conflicting replay moved the payable to %d", balance)
	}
}

func TestACaptureNeverCrossesRegions(t *testing.T) {
	s := newServer(t)
	ensureChart(t)
	merchant := uuid()

	var refused problem
	if code := s.callAs("voucher", "/captures", map[string]any{
		"captureId": uuid(), "region": "AU", "merchantId": merchant, "amountMinor": 100, "currency": "IDR",
	}, &refused); code != http.StatusConflict || refused.Code != "region_mismatch" {
		t.Fatalf("AU capture in IDR: %d %q", code, refused.Code)
	}

	s.mustCallAs("voucher", "/captures", map[string]any{
		"captureId": uuid(), "region": "ID", "merchantId": merchant, "amountMinor": 10_000, "currency": "IDR",
	})
	if code := s.callAs("voucher", "/captures", map[string]any{
		"captureId": uuid(), "region": "AU", "merchantId": merchant, "amountMinor": 100, "currency": "AUD",
	}, &refused); code != http.StatusConflict || refused.Code != "region_mismatch" {
		t.Fatalf("an ID merchant captured in AU: %d %q", code, refused.Code)
	}
}

func TestTheVoucherCallerReachesOnlyItsOwnRoutes(t *testing.T) {
	s := newServer(t)
	if code := s.callAs("voucher", "/wallet/balance", map[string]any{"userId": uuid()}, nil); code != http.StatusForbidden {
		t.Fatalf("voucher caller on /wallet/balance: %d, want 403", code)
	}
}

func (s *server) mustCallAs(caller, path string, body any) {
	s.t.Helper()
	var out map[string]any
	if code := s.callAs(caller, path, body, &out); code != http.StatusOK {
		s.t.Fatalf("%s: %d %v", path, code, out)
	}
}
