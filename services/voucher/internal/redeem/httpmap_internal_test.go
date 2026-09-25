package redeem

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/yourtal/services/voucher/internal/issue"
)

// D14: a write that lost a race is retryable, so it answers 409, not 500.
func TestALostRaceIsARetryable409(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	stale := fmt.Errorf("moving: %w", issue.ErrStaleVersion)
	for name, write := range map[string]func(http.ResponseWriter, *slog.Logger, error){
		"authorize": writeAuthorizeError, "capture": writeCaptureError,
		"void": writeVoidError, "refund": writeRefundError,
	} {
		rec := httptest.NewRecorder()
		write(rec, logger, stale)
		if rec.Code != http.StatusConflict {
			t.Errorf("%s: a stale version answered %d, want 409", name, rec.Code)
		}
	}
}
