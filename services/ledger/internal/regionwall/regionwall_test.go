package regionwall_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/regionwall"
	"github.com/yourtal/services/ledger/internal/reward"
	"github.com/yourtal/services/ledger/internal/testdb"
)

func TestMiddlewareReadsOnlyAKnownRegion(t *testing.T) {
	for header, want := range map[string]string{"AU": "AU", "ID": "ID", "": "", "XX": "", "au": ""} {
		var got string
		h := regionwall.Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			got = regionwall.Region(r.Context())
		}))
		req := httptest.NewRequest(http.MethodPost, "/v1/x", nil)
		req.Header.Set(regionwall.Header, header)
		h.ServeHTTP(httptest.NewRecorder(), req)
		if got != want {
			t.Errorf("header %q: region %q, want %q", header, got, want)
		}
	}
}

// A walled acquire hides the other region's accounts, and the next unwalled
// acquire on the same pool sees them again.
func TestAcquireSetsTheRegion(t *testing.T) {
	ctx := context.Background()
	cfg, err := pgxpool.ParseConfig(testdb.URL(t, "LEDGER_DATABASE_URL"))
	if err != nil {
		t.Fatal(err)
	}
	cfg.MaxConns = 1
	regionwall.Configure(cfg)
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	count := func(ctx context.Context) int {
		var n int
		if err := pool.QueryRow(ctx, "SELECT count(*) FROM ledger.account WHERE country = 'AU'").Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if err := reward.New(pool, ledger.New(pool), reward.AlwaysAllow{}, ledger.RegionAU).EnsureChart(ctx); err != nil {
		t.Fatal(err)
	}
	if count(ctx) == 0 {
		t.Fatal("no AU accounts after EnsureChart")
	}
	if n := count(regionwall.WithRegion(ctx, "ID")); n != 0 {
		t.Fatalf("walled to ID, saw %d AU accounts", n)
	}
	if count(regionwall.WithRegion(ctx, "AU")) == 0 || count(ctx) == 0 {
		t.Fatal("AU accounts vanished outside an ID wall")
	}
}
