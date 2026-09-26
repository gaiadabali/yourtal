package api_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"testing"
)

// 4.6.h: services/voucher anchors chain heads, signed as "voucher".

func TestVoucherHeadsAreAnchoredOverHTTP(t *testing.T) {
	s := newServer(t)
	ctx := context.Background()
	sum := sha256.Sum256([]byte(unique("head")))
	head := map[string]any{"voucherId": uuid(), "seq": 2, "headHash": hex.EncodeToString(sum[:]), "region": "AU"}
	body := map[string]any{"heads": []map[string]any{head}}

	var answer struct {
		Received int `json:"received"`
		Anchored int `json:"anchored"`
	}
	if code := s.callAs("voucher", "/proof/voucher-heads", body, &answer); code != http.StatusOK || answer.Anchored != 1 {
		t.Fatalf("anchor: %d %+v", code, answer)
	}
	var stored string
	if err := s.owner.QueryRow(ctx,
		`SELECT head_hash FROM ledger.voucher_head_anchor WHERE voucher_id = $1 AND seq = 2`, head["voucherId"]).
		Scan(&stored); err != nil || stored != head["headHash"] {
		t.Fatalf("stored %q (%v), want %v", stored, err, head["headHash"])
	}

	// A lost reply is re-sent: accepted, nothing new.
	if code := s.callAs("voucher", "/proof/voucher-heads", body, &answer); code != http.StatusOK || answer.Anchored != 0 {
		t.Fatalf("re-sent anchor: %d %+v", code, answer)
	}

	// A different head at the same seq means the chain was rewritten.
	other := sha256.Sum256([]byte("rewritten"))
	head["headHash"] = hex.EncodeToString(other[:])
	var refused problem
	if code := s.callAs("voucher", "/proof/voucher-heads", body, &refused); code != http.StatusConflict || refused.Code != "idempotency_conflict" {
		t.Fatalf("rewritten head: %d %q", code, refused.Code)
	}

	head["headHash"] = "not-hex"
	if code := s.callAs("voucher", "/proof/voucher-heads", body, nil); code != http.StatusBadRequest {
		t.Fatalf("malformed head: %d, want 400", code)
	}
}

func TestOnlyTheVoucherServiceAnchorsHeads(t *testing.T) {
	s := newServer(t)
	if code := s.callAs("api", "/proof/voucher-heads", map[string]any{"heads": []any{}}, nil); code != http.StatusForbidden {
		t.Fatalf("api caller anchoring heads: %d, want 403", code)
	}
}
