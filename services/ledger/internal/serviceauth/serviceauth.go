// Package serviceauth verifies HMAC-signed calls from YourTal's own services
// (apps/api, apps/worker). The ledger has no public callers: every /v1 route
// sits behind this middleware, and an unsigned call never reaches a handler.
//
// Header: `X-YourTal-Service-Signature: t=<unix>,c=<caller>,n=<nonce>,v1=<hex>`.
// The MAC covers timestamp, caller, nonce, method, path with its query string,
// and a SHA-256 of the body. The query string is signed because leaving it out
// lets a captured GET be replayed against a different account (voucher D9).
package serviceauth

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/yourtal/services/ledger/internal/httpx"
)

const (
	// Header carries the signature.
	Header = "X-YourTal-Service-Signature"
	// MaxSkew is how far a timestamp may be from the ledger's clock, either way.
	// Callers are our own hosts on NTP, so a minute is generous.
	MaxSkew = 60 * time.Second
	// MinSecretBytes refuses a secret too short to be a real key.
	MinSecretBytes = 32

	maxBodyBytes = 1 << 20
	maxNonceLen  = 64
	// maxNonces bounds the replay cache. Only correctly signed requests enter
	// it, so filling it takes the secret; past the bound we refuse, never forget.
	maxNonces = 200_000
)

// Callers are the services allowed to sign. The caller id is signed, so one
// cannot pose as the other without the secret either way. "voucher" is
// services/voucher's outbox drainer (4.6.f.2); internal/api limits it to
// its own routes.
var Callers = map[string]bool{"api": true, "worker": true, "voucher": true}

var (
	ErrMalformed = errors.New("serviceauth: malformed signature header")
	ErrSkew      = errors.New("serviceauth: timestamp outside the allowed skew")
	ErrMismatch  = errors.New("serviceauth: signature does not match")
	ErrCaller    = errors.New("serviceauth: unknown caller")
	ErrReplay    = errors.New("serviceauth: nonce already used")
	ErrCacheFull = errors.New("serviceauth: replay cache is full")
)

// Sign returns the header value for one request. Used by tests and by any Go
// caller; apps/api implements the same canonical string in TypeScript.
func Sign(secret []byte, caller, nonce, method, pathAndQuery string, body []byte, at time.Time) string {
	mac := compute(secret, at.Unix(), caller, nonce, method, pathAndQuery, body)
	return fmt.Sprintf("t=%d,c=%s,n=%s,v1=%s", at.Unix(), caller, nonce, hex.EncodeToString(mac))
}

type signature struct {
	unix   int64
	caller string
	nonce  string
	mac    []byte
}

func parse(header string) (signature, error) {
	var s signature
	var seen int
	for _, part := range strings.Split(header, ",") {
		name, value, ok := strings.Cut(strings.TrimSpace(part), "=")
		if !ok {
			return s, ErrMalformed
		}
		switch name {
		case "t":
			n, err := strconv.ParseInt(value, 10, 64)
			if err != nil {
				return s, ErrMalformed
			}
			s.unix, seen = n, seen|1
		case "c":
			s.caller, seen = value, seen|2
		case "n":
			if value == "" || len(value) > maxNonceLen {
				return s, ErrMalformed
			}
			s.nonce, seen = value, seen|4
		case "v1":
			mac, err := hex.DecodeString(value)
			if err != nil || len(mac) != sha256.Size {
				return s, ErrMalformed
			}
			s.mac, seen = mac, seen|8
		}
	}
	if seen != 15 {
		return s, ErrMalformed
	}
	return s, nil
}

// compute is newline-joined so no field can smuggle in another: the caller is
// from a fixed set, and verify refuses a nonce containing a newline.
func compute(secret []byte, unix int64, caller, nonce, method, pathAndQuery string, body []byte) []byte {
	digest := sha256.Sum256(body)
	canonical := strings.Join([]string{
		strconv.FormatInt(unix, 10), caller, nonce, strings.ToUpper(method), pathAndQuery,
		base64.StdEncoding.EncodeToString(digest[:]),
	}, "\n")
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(canonical))
	return mac.Sum(nil)
}

// Verifier checks signatures and remembers nonces for 2 × MaxSkew, the whole
// time a timestamp stays acceptable. The cache is per process: the ledger runs
// as one instance, and a second one needs a shared cache first.
type Verifier struct {
	secret []byte
	now    func() time.Time

	mu     sync.Mutex
	nonces map[string]time.Time
	swept  time.Time
}

func New(secret []byte) (*Verifier, error) {
	if len(secret) < MinSecretBytes {
		return nil, fmt.Errorf("serviceauth: the secret must be at least %d bytes", MinSecretBytes)
	}
	return &Verifier{secret: secret, now: time.Now, nonces: map[string]time.Time{}}, nil
}

// WithClock replaces the clock. Test seam only.
func (v *Verifier) WithClock(now func() time.Time) *Verifier { v.now = now; return v }

func (v *Verifier) verify(header, method, pathAndQuery string, body []byte) (string, error) {
	s, err := parse(header)
	if err != nil {
		return "", err
	}
	if !Callers[s.caller] {
		return "", ErrCaller
	}
	if strings.ContainsAny(s.nonce, "\n\r") {
		return "", ErrMalformed
	}
	now := v.now()
	skew := now.Sub(time.Unix(s.unix, 0))
	if skew < -MaxSkew || skew > MaxSkew {
		return "", ErrSkew
	}
	// MAC before the nonce: an unsigned request must not be able to burn a
	// legitimate caller's nonce or fill the cache.
	if !hmac.Equal(compute(v.secret, s.unix, s.caller, s.nonce, method, pathAndQuery, body), s.mac) {
		return "", ErrMismatch
	}
	return s.caller, v.remember(s.caller+":"+s.nonce, now)
}

func (v *Verifier) remember(key string, now time.Time) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if now.Sub(v.swept) > MaxSkew {
		for k, exp := range v.nonces {
			if now.After(exp) {
				delete(v.nonces, k)
			}
		}
		v.swept = now
	}
	if exp, ok := v.nonces[key]; ok && !now.After(exp) {
		return ErrReplay
	}
	if len(v.nonces) >= maxNonces {
		return ErrCacheFull
	}
	v.nonces[key] = now.Add(2 * MaxSkew)
	return nil
}

type callerKey struct{}

// Caller returns the verified caller id, or "" outside the middleware.
func Caller(ctx context.Context) string {
	c, _ := ctx.Value(callerKey{}).(string)
	return c
}

// Middleware refuses every request without a valid signature with one
// identical 401; the reason is logged, never returned.
func (v *Verifier) Middleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get(Header)
			if header == "" {
				refuse(w, logger, errors.New("no signature header"))
				return
			}
			body, err := io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
			if err != nil || len(body) > maxBodyBytes {
				httpx.WriteError(w, logger, http.StatusRequestEntityTooLarge,
					"invalid_request_error", "body_too_large", "the request body is too large")
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(body))

			caller, err := v.verify(header, r.Method, r.URL.RequestURI(), body)
			if err != nil {
				refuse(w, logger, err)
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), callerKey{}, caller)))
		})
	}
}

func refuse(w http.ResponseWriter, logger *slog.Logger, reason error) {
	logger.Warn("service signature refused", "reason", reason.Error())
	httpx.WriteError(w, logger, http.StatusUnauthorized,
		"authentication_error", "invalid_signature", "invalid or missing service signature")
}
