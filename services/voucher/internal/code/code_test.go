package code_test

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"

	"github.com/yourtal/services/voucher/internal/code"
)

func TestAMintedCodeParses(t *testing.T) {
	for index := 0; index < 200; index++ {
		minted, err := code.Mint()
		if err != nil {
			t.Fatalf("Mint: %v", err)
		}
		if len(minted) != code.Length {
			t.Fatalf("minted %q is %d symbols, want %d", minted, len(minted), code.Length)
		}
		if _, err := code.Parse(minted); err != nil {
			t.Fatalf("a minted code failed its own check: %q: %v", minted, err)
		}
	}
}

// The alphabet omits I, L, O and U, and that has to hold for every code
// rather than for most of them. A single U in one code in ten thousand is
// still a code somebody has to read out loud.
func TestNoMintedCodeContainsAConfusableLetter(t *testing.T) {
	for index := 0; index < 2_000; index++ {
		minted, err := code.Mint()
		if err != nil {
			t.Fatalf("Mint: %v", err)
		}
		// The final symbol may be one of Crockford's five check symbols,
		// which include U by design; the payload may not.
		if strings.ContainsAny(minted[:code.PayloadLength], "ILOU") {
			t.Fatalf("minted code %q contains a confusable letter", minted)
		}
	}
}

// YT-0140: "no prefix or counter". Two codes minted back to back must share
// no structure — this is a weak check by nature, but it catches the
// realistic regression, which is somebody adding a readable prefix later
// because support asked for one.
func TestCodesCarryNoSharedStructure(t *testing.T) {
	first, err := code.Mint()
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}
	second, err := code.Mint()
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}

	shared := 0
	for index := 0; index < code.PayloadLength; index++ {
		if first[index] != second[index] {
			break
		}
		shared++
	}
	if shared >= 4 {
		t.Errorf("%q and %q share a %d-symbol prefix — is there a prefix or counter?",
			first, second, shared)
	}
}

// The misreadings the alphabet was chosen to absorb. A cashier who types I
// for 1 or O for 0 has not made an error.
func TestTheCommonMisreadingsAreNotErrors(t *testing.T) {
	minted, err := code.Mint()
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}

	mistyped := strings.NewReplacer("1", "I", "0", "O").Replace(code.Format(minted))

	parsed, err := code.Parse(strings.ToLower(mistyped))
	if err != nil {
		t.Fatalf("a foldable misreading of %q was rejected: %v", minted, err)
	}
	if parsed != minted {
		t.Errorf("folded to %q, want %q", parsed, minted)
	}
}

// The check symbol's job: catch a typo before it reaches the database, so a
// fat thumb at a till does not look like an enumeration probe.
//
// Every single-symbol substitution, exhaustively, not a sample — a prime
// modulus is supposed to catch all of them, and "we tried twenty and they
// were fine" would not distinguish that from a check that catches most.
func TestEverySingleSymbolTypoIsCaught(t *testing.T) {
	const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

	for attempt := 0; attempt < 20; attempt++ {
		minted, err := code.Mint()
		if err != nil {
			t.Fatalf("Mint: %v", err)
		}

		for position := 0; position < code.PayloadLength; position++ {
			for _, replacement := range alphabet {
				if byte(replacement) == minted[position] {
					continue
				}
				corrupted := []byte(minted)
				corrupted[position] = byte(replacement)

				if _, err := code.Parse(string(corrupted)); !errors.Is(err, code.ErrCheckFailed) {
					t.Fatalf("a typo at position %d of %q (%c -> %c) was accepted",
						position, minted, minted[position], replacement)
				}
			}
		}
	}
}

// Adjacent transposition — the other typo people actually make. The prime
// modulus is what catches these; base-32 arithmetic alone would not.
func TestAdjacentTranspositionsAreCaught(t *testing.T) {
	for attempt := 0; attempt < 200; attempt++ {
		minted, err := code.Mint()
		if err != nil {
			t.Fatalf("Mint: %v", err)
		}

		for position := 0; position+1 < code.PayloadLength; position++ {
			if minted[position] == minted[position+1] {
				continue // swapping two identical symbols is not a typo
			}
			swapped := []byte(minted)
			swapped[position], swapped[position+1] = swapped[position+1], swapped[position]

			if _, err := code.Parse(string(swapped)); !errors.Is(err, code.ErrCheckFailed) {
				t.Fatalf("transposing %d and %d in %q was accepted", position, position+1, minted)
			}
		}
	}
}

func TestMalformedInputIsRefused(t *testing.T) {
	for _, input := range []string{
		"",
		"SHORT",
		"0123456789ABCDEFGH", // one too long
		"0123456789ABCDEF!",  // symbol outside the alphabet
	} {
		if _, err := code.Parse(input); !errors.Is(err, code.ErrMalformed) {
			t.Errorf("Parse(%q) = %v, want ErrMalformed", input, err)
		}
	}
}

// Display formatting must round-trip. Two spellings of one code is how a
// lookup misses a voucher that is sitting right there.
func TestTheDisplayFormRoundTrips(t *testing.T) {
	minted, err := code.Mint()
	if err != nil {
		t.Fatalf("Mint: %v", err)
	}

	formatted := code.Format(minted)
	if !strings.Contains(formatted, "-") {
		t.Errorf("Format(%q) = %q, expected hyphen grouping", minted, formatted)
	}
	// 17 symbols in groups of four is 5 groups and 4 hyphens: 21 characters,
	// inside voucherSchema's max of 24.
	if len(formatted) > 24 {
		t.Errorf("the display form %q is %d characters; voucherSchema allows 24",
			formatted, len(formatted))
	}

	parsed, err := code.Parse(formatted)
	if err != nil {
		t.Fatalf("the display form did not parse: %v", err)
	}
	if parsed != minted {
		t.Errorf("round trip gave %q, want %q", parsed, minted)
	}
}

// 2.8 T2: the cross-language vectors. SnapApp ports Normalise/Parse/Format to
// TypeScript (snap-apps S2) and checks its port against this exact table, so
// a change here is a contract change: edit both sides together. The canonical
// forms and the three outcomes are the whole contract; error text is not.
func TestParseVectors(t *testing.T) {
	accept := []struct{ name, input, canonical string }{
		{"all zero", "00000000000000000", "00000000000000000"},
		{"plain", "0123456789ABCDEFK", "0123456789ABCDEFK"},
		{"mixed", "7M3Q9K2X5VRT8WBHN", "7M3Q9K2X5VRT8WBHN"},
		{"check symbol ~", "KE14SG8DJFFDZH9N~", "KE14SG8DJFFDZH9N~"},
		{"check symbol $", "5Z9JF3MD8VSN5S4Z$", "5Z9JF3MD8VSN5S4Z$"},
		{"check symbol *", "VXWD6KSNCQQ84BZ0*", "VXWD6KSNCQQ84BZ0*"},
		{"check symbol U", "ZSHQ9JKMCDM1YW9DU", "ZSHQ9JKMCDM1YW9DU"},
		{"check symbol =", "TKQ9Z8GC17FXNBF6=", "TKQ9Z8GC17FXNBF6="},
		{"display form", "0123-4567-89AB-CDEF-K", "0123456789ABCDEFK"},
		{"lower case", "7m3q-9k2x-5vrt-8wbh-n", "7M3Q9K2X5VRT8WBHN"},
		{"spaces for hyphens", "7M3Q 9K2X 5VRT 8WBH N", "7M3Q9K2X5VRT8WBHN"},
		{"outer whitespace", " \t0123456789ABCDEFK\n", "0123456789ABCDEFK"},
		{"I and O fold to 1 and 0", "I4OB5FOBEBGFII75Z", "140B5F0BEBGF1175Z"},
		{"L folds to 1, lower case", "l4ob5f0bebgfl175z", "140B5F0BEBGF1175Z"},
		{"fold inside the display form", "I4OB-5FOB-EBGF-II75-Z", "140B5F0BEBGF1175Z"},
		{"special check symbol, lower-case u", "zshq9jkmcdm1yw9du", "ZSHQ9JKMCDM1YW9DU"},
	}
	for _, c := range accept {
		got, err := code.Parse(c.input)
		if err != nil || got != c.canonical {
			t.Errorf("%s: Parse(%q) = %q, %v; want %q", c.name, c.input, got, err, c.canonical)
		}
	}

	// ErrMalformed: wrong length after normalising, a payload symbol outside
	// the alphabet (U included, only the 17th may be U), or a 17th symbol
	// outside the check alphabet. Malformed wins over a failed check.
	malformed := []struct{ name, input string }{
		{"empty", ""},
		{"only formatting", "- - -"},
		{"16 symbols", "0123456789ABCDEF"},
		{"18 symbols", "0123456789ABCDEFKK"},
		{"inner tab is content, not formatting", "0123456789ABC\tDEFK"},
		{"payload symbol outside the alphabet", "0123456789ABCDE!K"},
		{"U in the payload", "U123456789ABCDEFK"},
		{"check position outside the check alphabet", "0123456789ABCDEF?"},
		{"underscore in the check position", "0123456789ABCDEF_"},
	}
	for _, c := range malformed {
		if _, err := code.Parse(c.input); !errors.Is(err, code.ErrMalformed) {
			t.Errorf("%s: Parse(%q) = %v, want ErrMalformed", c.name, c.input, err)
		}
	}

	// ErrCheckFailed: well-formed, wrong 17th symbol. Plain is "...K".
	checkFailed := []struct{ name, input string }{
		{"wrong check symbol", "0123456789ABCDEFJ"},
		{"special symbol where K belongs", "0123456789ABCDEFU"},
		{"one payload symbol changed", "0123456789ABCDEEK"},
		{"adjacent pair swapped", "0123456789ABCDFEK"},
		{"all-zero payload, check 1", "00000000000000001"},
	}
	for _, c := range checkFailed {
		if _, err := code.Parse(c.input); !errors.Is(err, code.ErrCheckFailed) {
			t.Errorf("%s: Parse(%q) = %v, want ErrCheckFailed", c.name, c.input, err)
		}
	}

	if got := code.Format("0123456789ABCDEFK"); got != "0123-4567-89AB-CDEF-K" {
		t.Errorf("Format = %q, want 0123-4567-89AB-CDEF-K", got)
	}

	// What apps/api and the holding read key on: SHA-256 of the canonical
	// form, lower-case hex, never of what was typed.
	for canonical, want := range map[string]string{
		"0123456789ABCDEFK": "d024ef43bb4311f7be1515efd6cea9d1ae0ea0ab8ea2f4b1915f1e9abf188cd7",
		"140B5F0BEBGF1175Z": "d01d91b8f14319f45e7df33a29b1e8cacafef2df929c5416e08b78e8c09652dc",
	} {
		sum := sha256.Sum256([]byte(canonical))
		if got := hex.EncodeToString(sum[:]); got != want {
			t.Errorf("sha256(%q) = %s, want %s", canonical, got, want)
		}
	}
}
