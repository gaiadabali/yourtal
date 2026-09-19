package httpx_test

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/yourtal/services/voucher/internal/httpx"
)

func discardLogger() *slog.Logger {
	return slog.New(slog.NewJSONHandler(io.Discard, nil))
}

func TestWriteJSONSetsStatusAndContentType(t *testing.T) {
	recorder := httptest.NewRecorder()

	httpx.WriteJSON(recorder, discardLogger(), http.StatusCreated, map[string]string{"id": "led_1"})

	if recorder.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusCreated)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("content-type = %q, want application/json", got)
	}
}

// docs/13 section 5 fixes ONE error envelope for every endpoint and every
// status >= 400. An envelope that drifts is one a merchant integration
// silently stops parsing, so the shape is asserted rather than assumed.
func TestWriteErrorUsesTheStandardEnvelope(t *testing.T) {
	recorder := httptest.NewRecorder()

	httpx.WriteError(recorder, discardLogger(), http.StatusConflict,
		"idempotency_error", "idempotency_key_reused", "that key carried a different request")

	var envelope httpx.ErrorEnvelope
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("body did not parse as the standard envelope: %v", err)
	}

	if envelope.Error.Type != "idempotency_error" {
		t.Errorf("type = %q", envelope.Error.Type)
	}
	if envelope.Error.Code != "idempotency_key_reused" {
		t.Errorf("code = %q", envelope.Error.Code)
	}
	if recorder.Code != http.StatusConflict {
		t.Errorf("status = %d, want 409", recorder.Code)
	}
}

// `param` is optional in the envelope and must be absent rather than empty
// when unused — a client matching on presence should not see "".
func TestWriteErrorOmitsEmptyParam(t *testing.T) {
	recorder := httptest.NewRecorder()

	httpx.WriteError(recorder, discardLogger(), http.StatusNotFound,
		"invalid_request_error", "not_found", "no such endpoint")

	var raw map[string]map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if _, present := raw["error"]["param"]; present {
		t.Error("param should be omitted when empty, not sent as an empty string")
	}
}
