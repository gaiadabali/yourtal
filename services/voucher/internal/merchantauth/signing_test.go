package merchantauth_test

import (
	"errors"
	"testing"
	"time"

	"github.com/yourtal/services/voucher/internal/merchantauth"
)

var (
	secret = []byte("a merchant's shared secret, 32b+")
	now    = time.Date(2026, 9, 20, 4, 0, 0, 0, time.UTC)
	body   = []byte(`{"code":"ABCD1234EFGH5678K","amount":3000,"order_ref":"A-1"}`)
)

func signed(t *testing.T, at time.Time) string {
	t.Helper()
	return merchantauth.Sign(secret, "key_live_1", "POST", "/v1/vouchers/authorize", body, at)
}

func verify(header, method, path string, payload []byte, at time.Time) error {
	return merchantauth.Verify(secret, header, method, path, payload, at)
}

func TestAGenuineRequestVerifies(t *testing.T) {
	if err := verify(signed(t, now), "POST", "/v1/vouchers/authorize", body, now); err != nil {
		t.Fatalf("a request we signed ourselves does not verify: %v", err)
	}
}

// Each field of the canonical string, tampered with independently. Every one
// of these is an attack that works if that field is not signed — see the
// package comment for what each one buys the attacker.
func TestEveryPartOfTheRequestIsCovered(t *testing.T) {
	header := signed(t, now)

	cases := []struct {
		name    string
		method  string
		path    string
		payload []byte
		attack  string
	}{
		{
			name: "the body", method: "POST", path: "/v1/vouchers/authorize",
			payload: []byte(`{"code":"ABCD1234EFGH5678K","amount":300000,"order_ref":"A-1"}`),
			attack:  "the amount is changed under a valid signature",
		},
		{
			name: "the path", method: "POST", path: "/v1/vouchers/refund", payload: body,
			attack: "a capture is replayed as a refund",
		},
		{
			name: "the method", method: "DELETE", path: "/v1/vouchers/authorize", payload: body,
			attack: "the verb is swapped under a valid signature",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			err := verify(header, testCase.method, testCase.path, testCase.payload, now)
			if !errors.Is(err, merchantauth.ErrSignatureMismatch) {
				t.Errorf("%s: %s", testCase.attack, "accepted")
			}
		})
	}
}

// A captured request must stop working. Symmetric, because a request from
// the future is as suspicious as an old one — and accepting those would let
// an attacker with a skewed clock mint long-lived signatures.
func TestTheReplayWindowIsSymmetricAndClosed(t *testing.T) {
	cases := []struct {
		name     string
		offset   time.Duration
		accepted bool
	}{
		{"right now", 0, true},
		{"a minute ago", -time.Minute, true},
		{"a minute ahead, ordinary till drift", time.Minute, true},
		{"at the edge", merchantauth.ReplayWindow, true},
		{"just past the edge", merchantauth.ReplayWindow + time.Second, false},
		{"an hour old — a captured request", -time.Hour, false},
		{"a day ahead — a forged clock", 24 * time.Hour, false},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			header := signed(t, now.Add(testCase.offset))
			err := verify(header, "POST", "/v1/vouchers/authorize", body, now)

			if testCase.accepted && err != nil {
				t.Errorf("a legitimate request was refused: %v", err)
			}
			if !testCase.accepted && !errors.Is(err, merchantauth.ErrOutsideReplayWindow) {
				t.Errorf("expected a replay-window refusal, got %v", err)
			}
		})
	}
}

// Moving the timestamp to bring a captured request back inside the window
// invalidates the signature, because the timestamp is itself signed. Without
// that, the window would be advisory.
func TestTheTimestampCannotBeMovedToDodgeTheWindow(t *testing.T) {
	old := signed(t, now.Add(-time.Hour))

	// The attacker rewrites `t=` to now, keeping the MAC.
	parsed, err := merchantauth.Parse(old)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	forged := "t=" + itoa(now.Unix()) + ",k=" + parsed.KeyID + ",v1=" + hexOf(parsed.MAC)

	err = verify(forged, "POST", "/v1/vouchers/authorize", body, now)
	if !errors.Is(err, merchantauth.ErrSignatureMismatch) {
		t.Errorf("a re-dated replay was accepted: %v", err)
	}
}

// A signature naming a different key must not verify against this secret —
// this is what keeps a rotation unambiguous rather than "try both keys".
func TestTheKeyIdIsCovered(t *testing.T) {
	parsed, err := merchantauth.Parse(signed(t, now))
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	forged := "t=" + itoa(now.Unix()) + ",k=key_live_2,v1=" + hexOf(parsed.MAC)

	if err := verify(forged, "POST", "/v1/vouchers/authorize", body, now); !errors.Is(
		err, merchantauth.ErrSignatureMismatch,
	) {
		t.Errorf("a signature relabelled to another key verified: %v", err)
	}
}

func TestMalformedHeadersAreRefused(t *testing.T) {
	for _, header := range []string{
		"",
		"garbage",
		"t=notanumber,k=key_live_1,v1=00",
		"k=key_live_1,v1=" + hexOf(make([]byte, 32)), // no timestamp
		"t=1,v1=" + hexOf(make([]byte, 32)),          // no key id
		"t=1,k=key_live_1",                           // no mac
		"t=1,k=key_live_1,v1=nothex",                 // mac not hex
		"t=1,k=key_live_1,v1=00",                     // mac wrong length
	} {
		if err := verify(header, "POST", "/v1/vouchers/authorize", body, now); !errors.Is(
			err, merchantauth.ErrMalformedSignature,
		) {
			t.Errorf("Verify(%q) = %v, want ErrMalformedSignature", header, err)
		}
	}
}

// An unknown field must be ignored rather than refused, or a later `v2=`
// could only ship on a flag day when every merchant changed at once.
func TestUnknownFieldsAreIgnored(t *testing.T) {
	header := signed(t, now) + ",v2=something-from-the-future"

	if err := verify(header, "POST", "/v1/vouchers/authorize", body, now); err != nil {
		t.Errorf("a forward-compatible field broke verification: %v", err)
	}
}

func itoa(value int64) string {
	if value == 0 {
		return "0"
	}
	var digits []byte
	negative := value < 0
	if negative {
		value = -value
	}
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	if negative {
		return "-" + string(digits)
	}
	return string(digits)
}

func hexOf(raw []byte) string {
	const alphabet = "0123456789abcdef"
	out := make([]byte, 0, len(raw)*2)
	for _, b := range raw {
		out = append(out, alphabet[b>>4], alphabet[b&0x0f])
	}
	return string(out)
}
