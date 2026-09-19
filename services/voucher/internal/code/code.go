// Package code mints and parses voucher codes. YT-0140.
//
// # What a voucher code has to be
//
// It is a bearer instrument typed by a cashier from a phone screen, under
// time pressure, in a shop. That gives it two requirements that pull against
// each other: it must be unguessable, and it must survive being read aloud,
// written on a receipt and typed back in with a fat thumb.
//
// The answers, in order:
//
//   - **Unguessable.** 80 bits from crypto/rand. docs/09 §10's threat is
//     enumeration — "the surface that gets gift-card systems drained" — and
//     at 80 bits an attacker throwing a million guesses a second at the
//     redemption API expects to wait longer than the universe has existed.
//     The rate limits and the failed-lookup alerting exist anyway, because
//     defence in depth is not defence in one.
//
//   - **No prefix, no counter.** YT-0140 says so and the reason is worth
//     keeping: a code shaped `YTL-000123-XXXX` tells an attacker the
//     issuance volume, the batch boundaries and where to start guessing. A
//     code with structure is a code with a smaller search space than its
//     length suggests.
//
//   - **Typo-tolerant to read, typo-DETECTING to enter.** Crockford's
//     Base32 drops I, L, O and U from the alphabet — the first three because
//     they are 1 and 0 in most handwriting, U because dropping it is what
//     stops a random code spelling something the cashier has to say out
//     loud. On input, I and L fold to 1 and O folds to 0, so the most common
//     misreadings are not errors at all. The check symbol catches the rest
//     before the code ever reaches the database, which matters because a
//     mistyped code and a stolen-code probe look identical to the
//     enumeration alerting otherwise — every fat thumb at a till would look
//     like an attack.
package code

import (
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
)

// Crockford's Base32 alphabet: the digits, then the letters without I, L, O
// and U. See the package comment for why those four are missing.
const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// Crockford's five extra check symbols, used only in the final position, so
// the check character has a modulus of 37 (a prime) rather than 32. A prime
// modulus is what makes the check catch every single-symbol error and every
// adjacent transposition — with 32 it would miss some of both.
const checkAlphabet = alphabet + "*~$=U"

const (
	// PayloadLength is the number of random symbols. 16 × 5 bits = 80.
	PayloadLength = 16
	// Length is what is stored and compared: payload plus check symbol.
	Length = PayloadLength + 1
	// groupSize is the hyphen spacing used for display only.
	groupSize = 4
)

var (
	// ErrMalformed — wrong length, or a symbol outside the alphabet.
	ErrMalformed = errors.New("code: not a voucher code")
	// ErrCheckFailed — well-formed but the check symbol disagrees. Almost
	// always a typo; it is answered identically to an unknown code at the
	// API boundary, because telling a prober "that was nearly right" is a
	// free oracle.
	ErrCheckFailed = errors.New("code: check symbol does not match")
)

// Mint returns a new code in its canonical (unhyphenated, upper-case) form.
func Mint() (string, error) {
	symbols := make([]byte, PayloadLength)
	if _, err := rand.Read(symbols); err != nil {
		return "", fmt.Errorf("code: reading randomness: %w", err)
	}

	// Low 5 bits of each byte. Uniform without rejection sampling because
	// 256 is exactly 8 × 32 — every symbol is the image of exactly eight
	// byte values, so there is no modulo bias to correct for. A `% 32` on a
	// non-power-of-two alphabet would need rejection; this one does not, and
	// the distinction is the sort that quietly halves an entropy estimate.
	for index, b := range symbols {
		symbols[index] = alphabet[b&0x1f]
	}

	payload := string(symbols)
	return payload + string(checkSymbol(payload)), nil
}

// Normalise turns whatever a cashier typed into the canonical form.
//
// Hyphens and spaces are stripped because the display form has them and
// people type what they see. I and L fold to 1 and O folds to 0 — Crockford's
// rule, and the reason the alphabet omits them in the first place.
func Normalise(input string) string {
	var builder strings.Builder
	builder.Grow(len(input))

	for _, character := range strings.ToUpper(strings.TrimSpace(input)) {
		switch character {
		case '-', ' ':
			// Formatting, not content.
		case 'I', 'L':
			builder.WriteRune('1')
		case 'O':
			builder.WriteRune('0')
		default:
			builder.WriteRune(character)
		}
	}
	return builder.String()
}

// Parse normalises and verifies a code, returning its canonical form.
//
// The two failure modes are distinguished HERE and deliberately collapsed at
// the API boundary: this package's caller wants to know whether to count an
// attempt as a probable typo or a probable probe, and the merchant on the
// other end of the wire must learn neither.
func Parse(input string) (string, error) {
	normalised := Normalise(input)

	if len(normalised) != Length {
		return "", fmt.Errorf("%w: %d symbols, want %d", ErrMalformed, len(normalised), Length)
	}

	payload := normalised[:PayloadLength]
	for index := 0; index < PayloadLength; index++ {
		if strings.IndexByte(alphabet, payload[index]) < 0 {
			return "", fmt.Errorf("%w: %q is not in the alphabet", ErrMalformed, payload[index])
		}
	}
	if strings.IndexByte(checkAlphabet, normalised[PayloadLength]) < 0 {
		return "", fmt.Errorf("%w: %q is not a check symbol", ErrMalformed, normalised[PayloadLength])
	}

	if normalised[PayloadLength] != checkSymbol(payload) {
		return "", ErrCheckFailed
	}
	return normalised, nil
}

// Format is the human-facing rendering: groups of four, hyphen-separated.
//
// Display only. Nothing is ever stored or compared in this form — Normalise
// undoes it — because two spellings of one code is how a lookup misses a
// voucher that is sitting right there.
func Format(canonical string) string {
	var builder strings.Builder
	for index := 0; index < len(canonical); index += groupSize {
		if index > 0 {
			builder.WriteByte('-')
		}
		end := index + groupSize
		if end > len(canonical) {
			end = len(canonical)
		}
		builder.WriteString(canonical[index:end])
	}
	return builder.String()
}

// checkSymbol is Crockford's: the payload read as a base-32 number, modulo
// 37, indexed into the extended alphabet.
//
// Computed with a running remainder rather than by building the whole
// number, because an 80-bit value does not fit in a uint64 and the modular
// identity ((a × 32) + b) mod 37 makes the big integer unnecessary.
func checkSymbol(payload string) byte {
	remainder := 0
	for index := 0; index < len(payload); index++ {
		value := strings.IndexByte(alphabet, payload[index])
		if value < 0 {
			// Unreachable for a minted code; Parse validates before calling.
			return checkAlphabet[36]
		}
		remainder = (remainder*32 + value) % 37
	}
	return checkAlphabet[remainder]
}
