package code_test

import (
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
