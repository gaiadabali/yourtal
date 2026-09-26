package api_test

import (
	"bytes"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/yourtal/services/ledger/internal/api"
	"github.com/yourtal/services/ledger/internal/serviceauth"
)

// 4.10: every /v1 route refuses a call apps/api did not sign. The routes are
// walked from the router itself, so a new route cannot skip this. Mounted as
// cmd/ledger mounts it; no engine is reached, so no database is needed.
func TestEveryRouteRefusesAnUnsignedOrForgedCall(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	auth, err := serviceauth.New(secret)
	if err != nil {
		t.Fatal(err)
	}
	routes := api.New(logger, nil, attestationSecret).Routes()
	router := chi.NewRouter()
	router.Use(middleware.Recoverer) // a signed call reaching a nil engine is a 500, not a crash
	router.Route("/v1", func(r chi.Router) {
		r.Use(auth.Middleware(logger))
		r.Mount("/", routes)
	})

	send := func(method, path, header string, body []byte) int {
		req := httptest.NewRequest(method, path, bytes.NewReader(body))
		if header != "" {
			req.Header.Set(serviceauth.Header, header)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec.Code
	}

	walked := 0
	if err := chi.Walk(routes, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		walked++
		path := "/v1" + route
		body := []byte(`not json`)
		now := time.Now()
		for name, header := range map[string]string{
			"unsigned":       "",
			"bad signature":  serviceauth.Sign([]byte("not-the-ledger-service-secret-32b!"), "api", unique("n"), method, path, body, now),
			"other body":     serviceauth.Sign(secret, "api", unique("n"), method, path, []byte(`{}`), now),
			"other path":     serviceauth.Sign(secret, "api", unique("n"), method, "/v1/wallet/balance-x", body, now),
			"stale":          serviceauth.Sign(secret, "api", unique("n"), method, path, body, now.Add(-2*serviceauth.MaxSkew)),
			"future":         serviceauth.Sign(secret, "api", unique("n"), method, path, body, now.Add(2*serviceauth.MaxSkew)),
			"unknown caller": serviceauth.Sign(secret, "merchant", unique("n"), method, path, body, now),
			"garbled":        "t=1,c=api,n=x,v1=zz",
		} {
			if code := send(method, path, header, body); code != http.StatusUnauthorized {
				t.Errorf("%s %s, %s: %d, want 401", method, path, name, code)
			}
		}
		// A good signature is let through once; its replay is refused.
		signed := serviceauth.Sign(secret, "api", unique("n"), method, path, body, now)
		if code := send(method, path, signed, body); code == http.StatusUnauthorized {
			t.Errorf("%s %s: a correctly signed call was refused", method, path)
		}
		if code := send(method, path, signed, body); code != http.StatusUnauthorized {
			t.Errorf("%s %s, replayed nonce: %d, want 401", method, path, code)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if walked < 30 {
		t.Fatalf("walked %d routes; the ledger serves at least 30", walked)
	}
}
