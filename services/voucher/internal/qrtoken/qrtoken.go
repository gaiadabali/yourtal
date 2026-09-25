// Package qrtoken signs and verifies the in-store QR codes a voucher's owner
// shows at a till (4.5.b, YT-0143). A token is self-contained — sealed with
// keyring's `voucher_qr` purpose — so verifying one needs no database read
// and no state this service has to keep: the ciphertext IS the credential,
// the same design `internal/keyring` already uses for voucher codes.
package qrtoken

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/keyring"
)

// WindowLength is 4.5.b's "12 signed tokens for consecutive 5-minute
// windows" — an hour of offline-cacheable tokens, so the wallet can show a
// working QR code even without a network round trip at the till.
const WindowLength = 5 * time.Minute

// WindowCount is how many consecutive windows one call mints.
const WindowCount = 12

// ErrInvalid — malformed, wrongly signed, or expired.
var ErrInvalid = errors.New("qrtoken: invalid token")

// Token is one window's signed code plus the instant it stops verifying.
type Token struct {
	Value     string
	ExpiresAt time.Time
}

// Mint returns WindowCount tokens for consecutive windows starting now.
func Mint(keys *keyring.Keyring, voucherID uuid.UUID, at time.Time) ([]Token, error) {
	tokens := make([]Token, 0, WindowCount)
	start := at.Truncate(WindowLength)

	for i := 0; i < WindowCount; i++ {
		windowStart := start.Add(time.Duration(i) * WindowLength)
		windowEnd := windowStart.Add(WindowLength)

		plaintext := fmt.Sprintf("%s|%d", voucherID, windowEnd.Unix())
		sealed, err := keys.Seal(keyring.PurposeVoucherQR, []byte(plaintext))
		if err != nil {
			return nil, fmt.Errorf("qrtoken: sealing: %w", err)
		}

		tokens = append(tokens, Token{
			Value:     encode(sealed),
			ExpiresAt: windowEnd,
		})
	}
	return tokens, nil
}

// Verify opens a token and returns the voucher it names, if it has not
// expired. `now` is a parameter rather than time.Now() so callers can test
// the boundary deterministically.
func Verify(keys *keyring.Keyring, token string, now time.Time) (uuid.UUID, error) {
	sealed, err := decode(token)
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("%w: %s", ErrInvalid, err)
	}

	plaintext, err := keys.Open(keyring.PurposeVoucherQR, sealed)
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("%w: %s", ErrInvalid, err)
	}

	voucherPart, expiryPart, ok := strings.Cut(string(plaintext), "|")
	if !ok {
		return uuid.UUID{}, fmt.Errorf("%w: malformed payload", ErrInvalid)
	}
	voucherID, err := uuid.Parse(voucherPart)
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("%w: %s", ErrInvalid, err)
	}
	expiryUnix, err := strconv.ParseInt(expiryPart, 10, 64)
	if err != nil {
		return uuid.UUID{}, fmt.Errorf("%w: %s", ErrInvalid, err)
	}
	if !now.Before(time.Unix(expiryUnix, 0)) {
		return uuid.UUID{}, fmt.Errorf("%w: expired", ErrInvalid)
	}
	return voucherID, nil
}

// encode/decode: version.wrappedDataKey.nonce.ciphertext, each base64url —
// the same shape a JWT uses, chosen because it is a format every part of
// this stack already knows how to pass through a URL or a query string
// unmangled.
func encode(sealed keyring.Sealed) string {
	return strings.Join([]string{
		strconv.Itoa(sealed.Version),
		base64.RawURLEncoding.EncodeToString(sealed.WrappedDataKey),
		base64.RawURLEncoding.EncodeToString(sealed.Nonce),
		base64.RawURLEncoding.EncodeToString(sealed.Ciphertext),
	}, ".")
}

func decode(token string) (keyring.Sealed, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 4 {
		return keyring.Sealed{}, errors.New("wrong shape")
	}
	version, err := strconv.Atoi(parts[0])
	if err != nil {
		return keyring.Sealed{}, err
	}
	wrappedDataKey, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return keyring.Sealed{}, err
	}
	nonce, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return keyring.Sealed{}, err
	}
	ciphertext, err := base64.RawURLEncoding.DecodeString(parts[3])
	if err != nil {
		return keyring.Sealed{}, err
	}
	return keyring.Sealed{
		WrappedDataKey: wrappedDataKey, Nonce: nonce, Ciphertext: ciphertext,
		Purpose: keyring.PurposeVoucherQR, Version: version,
	}, nil
}
