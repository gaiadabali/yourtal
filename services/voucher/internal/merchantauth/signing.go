// Package merchantauth verifies HMAC-signed merchant requests. YT-0152.
//
// docs/09 §10: "per-merchant credentials — API key + HMAC-SHA256 request
// signing; scheduled key rotation." Value moves across an organisational
// boundary here, on infrastructure we do not control, so a bearer API key
// alone is not enough: anything that observes one request can replay it.
//
// # What is signed, and why all of it
//
// The signature covers the method, the path, the timestamp, the key id and a
// hash of the body. Leave any of them out and there is an attack:
//
//   - **no body hash** — the amount and the order reference can be changed
//     under a valid signature, which is the whole transaction
//   - **no path** — a capture is replayed as a refund
//   - **no method** — likewise
//   - **no timestamp** — every request is replayable forever
//   - **no idempotency key** — a logged request is replayed under a fresh key
//     and the interceptor treats it as new (D9)
//   - **no query string** — a signed GET is replayed with other parameters
//   - **no key id** — a merchant with two live keys during a rotation has an
//     ambiguous signature, and the resolution would be "try both", which
//     doubles the attacker's chances rather than halving them
//
// # Constant time, always
//
// Comparison is `hmac.Equal`, never `==`. A byte-by-byte comparison that
// returns early leaks the position of the first difference through timing,
// and a signature is recoverable one byte at a time from that.
package merchantauth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ReplayWindow is how far a request's timestamp may be from the server's
// clock. Five minutes each way absorbs ordinary clock drift on a merchant's
// till — which is frequently wrong, and not by a little — while keeping a
// captured request useless within minutes.
//
// Symmetric on purpose: a request from the FUTURE is as suspicious as an old
// one, and accepting those would let an attacker with a skewed clock mint
// signatures valid for as long as they liked.
const ReplayWindow = 5 * time.Minute

var (
	// ErrMalformedSignature — the header is not the expected shape.
	ErrMalformedSignature = errors.New("merchantauth: malformed signature header")
	// ErrSignatureMismatch — the signature does not verify.
	ErrSignatureMismatch = errors.New("merchantauth: signature does not match")
	// ErrOutsideReplayWindow — the timestamp is too far from now.
	ErrOutsideReplayWindow = errors.New("merchantauth: timestamp is outside the replay window")
)

// SignatureHeader is the header a merchant sends.
const SignatureHeader = "X-YourTal-Signature"

// Signature is a parsed header: `t=<unix>,k=<key id>,v1=<hex mac>`.
//
// Versioned from the first release (`v1=`), because the alternative is a
// flag day: a scheme with no version cannot be changed without every
// merchant changing at the same instant. Stripe's webhook signatures carry
// the same field for the same reason.
type Signature struct {
	Timestamp time.Time
	KeyID     string
	MAC       []byte
}

// Sign produces the header value. Used by our own SDK and by the tests; a
// merchant implements the same three lines in their language.
//
// pathAndQuery is the request URI as sent (path plus any query string), and
// idempotencyKey the Idempotency-Key header ("" when there is none). Sign
// every attempt afresh: each signature is accepted once.
func Sign(secret []byte, keyID, method, pathAndQuery, idempotencyKey string, body []byte, at time.Time) string {
	mac := compute(secret, keyID, method, pathAndQuery, idempotencyKey, body, at)
	return fmt.Sprintf("t=%d,k=%s,v1=%s", at.Unix(), keyID, hex.EncodeToString(mac))
}

// Parse reads a signature header.
func Parse(header string) (Signature, error) {
	var parsed Signature
	var seenTime, seenKey, seenMAC bool

	for _, part := range strings.Split(header, ",") {
		name, value, found := strings.Cut(strings.TrimSpace(part), "=")
		if !found {
			return Signature{}, fmt.Errorf("%w: %q is not name=value", ErrMalformedSignature, part)
		}

		switch name {
		case "t":
			seconds, err := strconv.ParseInt(value, 10, 64)
			if err != nil {
				return Signature{}, fmt.Errorf("%w: timestamp %q", ErrMalformedSignature, value)
			}
			parsed.Timestamp, seenTime = time.Unix(seconds, 0).UTC(), true
		case "k":
			parsed.KeyID, seenKey = value, value != ""
		case "v1":
			mac, err := hex.DecodeString(value)
			if err != nil || len(mac) != sha256.Size {
				return Signature{}, fmt.Errorf("%w: v1 is not a sha256 hex digest", ErrMalformedSignature)
			}
			parsed.MAC, seenMAC = mac, true
		default:
			// Unknown fields are ignored rather than refused, so a future
			// `v2=` can be added without every merchant's current signature
			// becoming invalid on the day it ships.
		}
	}

	if !seenTime || !seenKey || !seenMAC {
		return Signature{}, fmt.Errorf("%w: need t, k and v1", ErrMalformedSignature)
	}
	return parsed, nil
}

// Verify checks a request against a merchant's secret.
//
// The timestamp is checked BEFORE the MAC. Not for speed — a stale request
// should not consume a constant-time comparison's worth of oracle, and more
// importantly, a caller that verified the MAC first and then forgot the
// window check would have a working signature scheme with no replay
// protection at all, and nothing would look wrong.
func Verify(secret []byte, header, method, pathAndQuery, idempotencyKey string, body []byte, now time.Time) error {
	parsed, err := Parse(header)
	if err != nil {
		return err
	}

	drift := now.Sub(parsed.Timestamp)
	if drift < 0 {
		drift = -drift
	}
	if drift > ReplayWindow {
		return fmt.Errorf("%w: %s off", ErrOutsideReplayWindow, drift.Round(time.Second))
	}

	expected := compute(secret, parsed.KeyID, method, pathAndQuery, idempotencyKey, body, parsed.Timestamp)
	if !hmac.Equal(expected, parsed.MAC) {
		return ErrSignatureMismatch
	}
	return nil
}

// compute builds the MAC over a canonical string.
//
// Newline-separated with a base64 body digest, so no field can contain the
// separator. The body is HASHED rather than included, so signing a 10 MB
// request costs the same as signing an empty one — and so the canonical
// string stays something a merchant's engineer can print and eyeball when
// their integration does not work, which is most of the first week.
func compute(secret []byte, keyID, method, pathAndQuery, idempotencyKey string, body []byte, at time.Time) []byte {
	digest := sha256.Sum256(body)

	canonical := strings.Join([]string{
		strconv.FormatInt(at.Unix(), 10),
		keyID,
		strings.ToUpper(method),
		pathAndQuery,
		idempotencyKey,
		base64.StdEncoding.EncodeToString(digest[:]),
	}, "\n")

	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(canonical))
	return mac.Sum(nil)
}
