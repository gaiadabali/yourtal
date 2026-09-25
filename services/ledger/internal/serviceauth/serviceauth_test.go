package serviceauth

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

var (
	secret = []byte("0123456789abcdef0123456789abcdef")
	t0     = time.Unix(1_790_000_000, 0)
)

func verifier(t *testing.T, now time.Time) *Verifier {
	t.Helper()
	v, err := New(secret)
	if err != nil {
		t.Fatal(err)
	}
	return v.WithClock(func() time.Time { return now })
}

func TestNewRefusesShortSecret(t *testing.T) {
	if _, err := New([]byte("short")); err == nil {
		t.Fatal("a 5-byte secret was accepted")
	}
}

func TestVerify(t *testing.T) {
	body := []byte(`{"points":"100"}`)
	good := Sign(secret, "api", "n1", "POST", "/v1/grants?x=1", body, t0)

	cases := []struct {
		name, header, method, path string
		body                       []byte
		now                        time.Time
		want                       error
	}{
		{"valid", good, "POST", "/v1/grants?x=1", body, t0, nil},
		{"lower-case method signs the same", good, "post", "/v1/grants?x=1", body, t0, nil},
		{"body changed", good, "POST", "/v1/grants?x=1", []byte(`{"points":"900"}`), t0, ErrMismatch},
		{"path changed", good, "POST", "/v1/burns?x=1", body, t0, ErrMismatch},
		{"query changed", good, "POST", "/v1/grants?x=2", body, t0, ErrMismatch},
		{"method changed", good, "PUT", "/v1/grants?x=1", body, t0, ErrMismatch},
		{"61 s late", good, "POST", "/v1/grants?x=1", body, t0.Add(61 * time.Second), ErrSkew},
		{"61 s early", good, "POST", "/v1/grants?x=1", body, t0.Add(-61 * time.Second), ErrSkew},
		{"60 s late is fine", good, "POST", "/v1/grants?x=1", body, t0.Add(60 * time.Second), nil},
		{"wrong secret", Sign([]byte(strings.Repeat("z", 32)), "api", "n1", "POST", "/v1/grants?x=1", body, t0),
			"POST", "/v1/grants?x=1", body, t0, ErrMismatch},
		{"unknown caller", Sign(secret, "web", "n1", "POST", "/v1/grants?x=1", body, t0),
			"POST", "/v1/grants?x=1", body, t0, ErrCaller},
		{"caller swapped under a valid mac", strings.Replace(good, "c=api", "c=worker", 1),
			"POST", "/v1/grants?x=1", body, t0, ErrMismatch},
		{"missing nonce", "t=1790000000,c=api,v1=" + strings.Repeat("0", 64), "POST", "/", nil, t0, ErrMalformed},
		{"garbage", "hello", "POST", "/", nil, t0, ErrMalformed},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := verifier(t, c.now).verify(c.header, c.method, c.path, c.body)
			if !errors.Is(err, c.want) {
				t.Fatalf("want %v, got %v", c.want, err)
			}
		})
	}
}

func TestReplayIsRefusedAndExpires(t *testing.T) {
	now := t0
	v := verifier(t, t0).WithClock(func() time.Time { return now })
	h := Sign(secret, "api", "same", "GET", "/v1/balance", nil, t0)

	if _, err := v.verify(h, "GET", "/v1/balance", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := v.verify(h, "GET", "/v1/balance", nil); !errors.Is(err, ErrReplay) {
		t.Fatalf("replay: want ErrReplay, got %v", err)
	}
	// The same nonce from the other caller is a different request.
	if _, err := v.verify(Sign(secret, "worker", "same", "GET", "/v1/balance", nil, t0), "GET", "/v1/balance", nil); err != nil {
		t.Fatalf("worker with api's nonce: %v", err)
	}
	// Once the timestamp is out of skew the nonce may be forgotten: the skew
	// check refuses the old header on its own.
	now = t0.Add(2*MaxSkew + time.Second)
	fresh := Sign(secret, "api", "same", "GET", "/v1/balance", nil, now)
	if _, err := v.verify(fresh, "GET", "/v1/balance", nil); err != nil {
		t.Fatalf("nonce reused after expiry: %v", err)
	}
	if n := len(v.nonces); n != 1 {
		t.Fatalf("sweep left %d nonces, want 1", n)
	}
}

func TestBadMACDoesNotBurnNonce(t *testing.T) {
	v := verifier(t, t0)
	forged := Sign([]byte(strings.Repeat("z", 32)), "api", "n9", "GET", "/v1/x", nil, t0)
	if _, err := v.verify(forged, "GET", "/v1/x", nil); !errors.Is(err, ErrMismatch) {
		t.Fatal(err)
	}
	if _, err := v.verify(Sign(secret, "api", "n9", "GET", "/v1/x", nil, t0), "GET", "/v1/x", nil); err != nil {
		t.Fatalf("a forged request burned the real caller's nonce: %v", err)
	}
}

func TestMiddleware(t *testing.T) {
	v := verifier(t, t0)
	var gotCaller, gotBody string
	h := v.Middleware(slog.New(slog.NewTextHandler(io.Discard, nil)))(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotCaller = Caller(r.Context())
			b, _ := io.ReadAll(r.Body)
			gotBody = string(b)
			w.WriteHeader(http.StatusNoContent)
		}))

	unsigned := httptest.NewRecorder()
	h.ServeHTTP(unsigned, httptest.NewRequest("POST", "/v1/grants", strings.NewReader(`{}`)))
	if unsigned.Code != http.StatusUnauthorized {
		t.Fatalf("unsigned: want 401, got %d", unsigned.Code)
	}

	req := httptest.NewRequest("POST", "/v1/grants?a=b", strings.NewReader(`{"k":1}`))
	req.Header.Set(Header, Sign(secret, "worker", "m1", "POST", "/v1/grants?a=b", []byte(`{"k":1}`), t0))
	signed := httptest.NewRecorder()
	h.ServeHTTP(signed, req)
	if signed.Code != http.StatusNoContent || gotCaller != "worker" || gotBody != `{"k":1}` {
		t.Fatalf("signed: code %d caller %q body %q", signed.Code, gotCaller, gotBody)
	}
}

// The same vector is in packages/contracts' service-signature test, so the
// TypeScript signer and this verifier cannot drift apart.
func TestSharedVector(t *testing.T) {
	got := Sign([]byte("test-only-ledger-service-secret-32b"), "worker", "n-1", "POST",
		"/v1/releases/unnotified", []byte(`{"limit":100}`), t0)
	want := "t=1790000000,c=worker,n=n-1,v1=00b1d876b40f2a0b6df76f9a84d1c5a5232e2305c8458db7b6d010e2fc117a2b"
	if got != want {
		t.Fatalf("Sign = %s, want %s", got, want)
	}
}
