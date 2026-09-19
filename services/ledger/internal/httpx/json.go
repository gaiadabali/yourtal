// Package httpx holds the one place this service writes an HTTP response.
//
// docs/13a section 7: "Encoding goes through one httpx.WriteJSON /
// httpx.WriteError pair so the envelope shape cannot drift." That matters
// because docs/13 section 5 fixes ONE error envelope for every endpoint and
// every status >= 400, and an envelope that drifts is one a merchant's
// integration silently stops parsing.
package httpx

import (
	"encoding/json"
	"log/slog"
	"net/http"
)

// ErrorEnvelope is docs/13 section 5's shape, and the only error body this
// service emits. `code` is machine-readable and stable; `message` is for a
// human reading a log, never for an end user's screen.
type ErrorEnvelope struct {
	Error ErrorBody `json:"error"`
}

type ErrorBody struct {
	Type    string `json:"type"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Param   string `json:"param,omitempty"`
}

// WriteJSON encodes v at the given status.
//
// An encoding failure after the header is written cannot be reported to the
// client — the status is already on the wire — so it is logged rather than
// swallowed. Silently truncating a value-bearing response is the kind of
// thing that looks like a network blip for months.
func WriteJSON(w http.ResponseWriter, logger *slog.Logger, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)

	if err := json.NewEncoder(w).Encode(v); err != nil {
		logger.Error("response encoding failed after status was sent", "error", err)
	}
}

// WriteError emits the standard envelope. Never takes an `error`: docs/13a
// section 7 forbids leaking internal text to a client, and a caller that has
// to name a code has to think about which one.
func WriteError(w http.ResponseWriter, logger *slog.Logger, status int, kind, code, message string) {
	WriteJSON(w, logger, status, ErrorEnvelope{
		Error: ErrorBody{Type: kind, Code: code, Message: message},
	})
}
