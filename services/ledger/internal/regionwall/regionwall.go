// Package regionwall sets Postgres's `yourtal.region` on every connection the
// ledger acquires (13.5.e, F89). The api sends the region of a walled request
// in Header; the row-level security policies then hide the other region's
// rows. No header means no filter, as for jobs and staff, so this only ever
// narrows what a query can see.
package regionwall

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Header carries the caller's region from apps/api.
const Header = "X-YourTal-Region"

type ctxKey struct{}

// WithRegion returns ctx walled to region ("AU" or "ID"); anything else unwalls it.
func WithRegion(ctx context.Context, region string) context.Context {
	if region != "AU" && region != "ID" {
		region = ""
	}
	return context.WithValue(ctx, ctxKey{}, region)
}

// Region is the region ctx is walled to, or "".
func Region(ctx context.Context) string {
	region, _ := ctx.Value(ctxKey{}).(string)
	return region
}

// Middleware walls each request to the region in Header.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r.WithContext(WithRegion(r.Context(), r.Header.Get(Header))))
	})
}

// Configure sets the region on every acquire, including to "" so a pooled
// connection never keeps a previous request's region.
func Configure(cfg *pgxpool.Config) {
	cfg.PrepareConn = func(ctx context.Context, conn *pgx.Conn) (bool, error) {
		if _, err := conn.Exec(ctx, "SELECT set_config('yourtal.region', $1, false)", Region(ctx)); err != nil {
			return false, err
		}
		return true, nil
	}
}
