package merchantauth

import (
	"context"

	"github.com/google/uuid"
)

// contextKey is unexported so nothing outside this package can collide with
// it or set it directly (docs/13a §4: context values live behind unexported
// key types). The merchant id in a request's context is a claim the
// signature middleware made after verifying a MAC, and it must not be
// settable any other way.
type contextKey int

const merchantIDKey contextKey = iota

// WithMerchantID attaches the merchant a verified signature was made by.
// Called only by Middleware, once, after Verify has succeeded.
func WithMerchantID(ctx context.Context, id uuid.UUID) context.Context {
	return context.WithValue(ctx, merchantIDKey, id)
}

// MerchantID reads the merchant a verified signature was made by. The bool
// is false for any request that did not pass through Middleware — which
// idempotency.Middleware treats as a wiring error, never as "no merchant",
// because docs/13a §7's ordering means that should be unreachable.
func MerchantID(ctx context.Context) (uuid.UUID, bool) {
	id, ok := ctx.Value(merchantIDKey).(uuid.UUID)
	return id, ok
}
