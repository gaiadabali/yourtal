package merchantauth

import (
	"bytes"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/keyring"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// maxBodyBytes bounds what Middleware will read before hashing it into a
// signature check. Verify's canonical string is built from a full read of
// the body (see signing.go), so an unbounded read here is an unbounded read
// on every unauthenticated request this service accepts.
const maxBodyBytes = 1 << 20 // 1 MiB — a redemption call is a handful of fields.

// Verifier wires signature verification (YT-0152) to the merchant credential
// table and the keyring that unwraps it.
//
// A struct with a constructor rather than a bare function, so the clock is a
// seam (docs/13a §8: "inject a Clock interface, no time.Now() in domain
// code") without threading one more parameter through main.go.
type Verifier struct {
	queries *sqlcgen.Queries
	keys    *keyring.Keyring
	now     func() time.Time
}

// New wires a Verifier to the pool holding voucher.merchant_credential and
// the keyring that can open PurposeMerchantHMAC secrets.
func New(pool *pgxpool.Pool, keys *keyring.Keyring) *Verifier {
	return &Verifier{
		queries: sqlcgen.New(pool),
		keys:    keys,
		now:     func() time.Time { return time.Now().UTC() },
	}
}

// WithClock replaces the clock. Test seam only.
func (v *Verifier) WithClock(now func() time.Time) *Verifier {
	v.now = now
	return v
}

// Middleware verifies the signature on every request it wraps, and refuses
// anything that does not carry a valid one.
//
// docs/13a §7 fixes this immediately after Timeout and immediately before
// idempotency (cmd/voucher's wiring comment explains why that order, not
// this one, is load-bearing: idempotency behind auth, or an unauthenticated
// caller can write to the shared idempotency table).
//
// # Every refusal is the same refusal
//
// No signature, a malformed one, an unknown key id, a bad MAC and a stale
// timestamp all produce the identical 401. Verify already knows which of
// those happened and that detail is logged, never returned — a caller
// probing for a working signature should not be able to use the response to
// tell which part of their guess landed closer, the same reasoning
// `internal/redeem` applies to a voucher code.
func (v *Verifier) Middleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get(SignatureHeader)
			if header == "" {
				v.refuse(w, logger, "no signature header presented")
				return
			}

			parsed, err := Parse(header)
			if err != nil {
				v.refuse(w, logger, "malformed signature header: "+err.Error())
				return
			}

			credential, err := v.queries.GetActiveCredential(r.Context(), parsed.KeyID)
			if errors.Is(err, pgx.ErrNoRows) {
				v.refuse(w, logger, "no active credential for the presented key id")
				return
			}
			if err != nil {
				logger.Error("reading merchant credential failed", "error", err)
				httpx.WriteError(w, logger, http.StatusInternalServerError,
					"api_error", "internal_error", "something went wrong")
				return
			}

			secret, err := v.keys.Open(keyring.PurposeMerchantHMAC, keyring.Sealed{
				WrappedDataKey: credential.WrappedDataKey,
				Nonce:          credential.Nonce,
				Ciphertext:     credential.Ciphertext,
				Purpose:        keyring.Purpose(credential.KeyPurpose),
				Version:        int(credential.KeyVersion),
			})
			if err != nil {
				// Not the caller's fault — a stored credential this process
				// cannot open is a key-rotation or deployment defect — but it
				// must fail the request rather than proceed unauthenticated,
				// so it is logged loudly and still refused.
				logger.Error("unwrapping merchant secret failed", "error", err, "key_id", parsed.KeyID)
				httpx.WriteError(w, logger, http.StatusInternalServerError,
					"api_error", "internal_error", "something went wrong")
				return
			}

			body, err := readBody(r)
			if err != nil {
				httpx.WriteError(w, logger, http.StatusBadRequest,
					"invalid_request_error", "unreadable_body", "the request body could not be read")
				return
			}

			if err := Verify(secret, header, r.Method, r.URL.Path, body, v.now()); err != nil {
				v.refuse(w, logger, "signature verification failed: "+err.Error())
				return
			}

			merchantID := uuid.UUID(credential.MerchantID.Bytes)
			next.ServeHTTP(w, r.WithContext(WithMerchantID(r.Context(), merchantID)))
		})
	}
}

// readBody drains the request body for hashing and puts an equivalent
// reader back, so the handler behind this middleware can still decode it.
func readBody(r *http.Request) ([]byte, error) {
	limited := io.LimitReader(r.Body, maxBodyBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if len(body) > maxBodyBytes {
		return nil, errors.New("merchantauth: request body exceeds the size this service will sign-check")
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	return body, nil
}

func (v *Verifier) refuse(w http.ResponseWriter, logger *slog.Logger, reason string) {
	logger.Warn("merchant signature refused", "reason", reason)
	httpx.WriteError(w, logger, http.StatusUnauthorized,
		"authentication_error", "invalid_signature", "invalid or missing merchant signature")
}
