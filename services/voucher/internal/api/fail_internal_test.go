package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/yourtal/services/voucher/internal/issue"
)

// 13.1.d: a sold-out listing is a contract refusal the api maps to a 409,
// never the generic 400 it could not read (which checkout turned into a 500).
func TestOutOfStockIsSoldOut(t *testing.T) {
	a := &API{logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
	rec := httptest.NewRecorder()
	a.fail(rec, fmt.Errorf("reserving: %w", issue.ErrOutOfStock))
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusConflict || body["code"] != "sold_out" {
		t.Fatalf("got %d %v, want 409 sold_out", rec.Code, body)
	}
}
