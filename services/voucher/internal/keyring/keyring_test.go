package keyring_test

import (
	"bytes"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/yourtal/services/voucher/internal/keyring"
)

func master(seed byte) []byte {
	key := make([]byte, 32)
	for index := range key {
		key[index] = seed + byte(index)
	}
	return key
}

func newRing(t *testing.T) *keyring.Keyring {
	t.Helper()
	ring, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeVoucherCode:  {1: master(1)},
		keyring.PurposeMerchantHMAC: {1: master(90)},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return ring
}

func TestSealAndOpenRoundTrip(t *testing.T) {
	ring := newRing(t)
	plaintext := []byte("ABCD1234EFGH5678K")

	sealed, err := ring.Seal(keyring.PurposeVoucherCode, plaintext)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if bytes.Contains(sealed.Ciphertext, plaintext) {
		t.Fatal("the plaintext is visible inside the ciphertext")
	}

	opened, err := ring.Open(keyring.PurposeVoucherCode, sealed)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	if !bytes.Equal(opened, plaintext) {
		t.Errorf("round trip gave %q, want %q", opened, plaintext)
	}
}

// Two seals of the same value must differ. Deterministic encryption of a
// voucher code would make the ciphertext a stable identifier — equal codes
// would be visibly equal in a dump, which is most of what encrypting them
// was supposed to prevent.
func TestSealingTheSameValueTwiceProducesDifferentCiphertext(t *testing.T) {
	ring := newRing(t)

	first, err := ring.Seal(keyring.PurposeVoucherCode, []byte("same"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	second, err := ring.Seal(keyring.PurposeVoucherCode, []byte("same"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	if bytes.Equal(first.Ciphertext, second.Ciphertext) {
		t.Error("two seals of one value produced identical ciphertext")
	}
	if bytes.Equal(first.WrappedDataKey, second.WrappedDataKey) {
		t.Error("two records shared a data key")
	}
}

// THE separation test. YT-0533: "separate keys for voucher codes, PII and
// signing — the separation is the point."
//
// Sealed for one purpose, opened as another, with the purpose field edited
// to match — which is exactly what an attacker with write access to the
// database would try. The AEAD refuses because the purpose is bound into the
// additional authenticated data, so the separation holds even when the
// column lies.
func TestACiphertextCannotBeMovedBetweenPurposes(t *testing.T) {
	ring := newRing(t)

	sealed, err := ring.Seal(keyring.PurposeVoucherCode, []byte("a voucher code"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	// 1. Asking for the wrong purpose is caught by the explicit check.
	if _, err := ring.Open(keyring.PurposeMerchantHMAC, sealed); !errors.Is(
		err, keyring.ErrWrongPurpose,
	) {
		t.Errorf("opening under the wrong purpose gave %v, want ErrWrongPurpose", err)
	}

	// 2. Editing the stored purpose to match is caught by the cryptography.
	//    This is the one that matters: check 1 is a guard rail somebody
	//    could remove, and this one cannot be removed without the key.
	tampered := sealed
	tampered.Purpose = keyring.PurposeMerchantHMAC
	if _, err := ring.Open(keyring.PurposeMerchantHMAC, tampered); err == nil {
		t.Error("a ciphertext relabelled as another purpose decrypted successfully")
	}
}

// Same argument for the version, which is what stops a rotation being rolled
// back one row at a time.
func TestARelabelledVersionDoesNotDecrypt(t *testing.T) {
	ring, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeVoucherCode: {1: master(1), 2: master(40)},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	sealed, err := ring.Seal(keyring.PurposeVoucherCode, []byte("value"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if sealed.Version != 2 {
		t.Fatalf("Seal used v%d; the newest key must seal", sealed.Version)
	}

	tampered := sealed
	tampered.Version = 1
	if _, err := ring.Open(keyring.PurposeVoucherCode, tampered); err == nil {
		t.Error("a ciphertext relabelled to an older version decrypted successfully")
	}
}

// Rotation with overlap: the new key seals, and records sealed under the old
// one still open. A rotation that could not read yesterday's vouchers would
// be a rotation nobody dares run.
func TestARotationCanStillOpenOlderRecords(t *testing.T) {
	before, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeVoucherCode: {1: master(1)},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	sealed, err := before.Seal(keyring.PurposeVoucherCode, []byte("minted before the rotation"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	after, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeVoucherCode: {1: master(1), 2: master(40)},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	opened, err := after.Open(keyring.PurposeVoucherCode, sealed)
	if err != nil {
		t.Fatalf("after rotating, an older record would not open: %v", err)
	}
	if string(opened) != "minted before the rotation" {
		t.Errorf("got %q", opened)
	}

	// And retiring v1 makes those records unreadable, loudly.
	retired, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeVoucherCode: {2: master(40)},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if _, err := retired.Open(keyring.PurposeVoucherCode, sealed); !errors.Is(
		err, keyring.ErrUnknownVersion,
	) {
		t.Errorf("retiring a key in use gave %v, want ErrUnknownVersion", err)
	}
}

// A purpose with no key refuses rather than borrowing another purpose's.
func TestAnUnconfiguredPurposeRefuses(t *testing.T) {
	ring := newRing(t)

	if _, err := ring.Seal(keyring.PurposeSigning, []byte("x")); !errors.Is(
		err, keyring.ErrNoKeyForPurpose,
	) {
		t.Errorf("sealing for an unconfigured purpose gave %v", err)
	}

	err := ring.RequirePurposes(keyring.PurposeVoucherCode, keyring.PurposeSigning)
	if !errors.Is(err, keyring.ErrNoKeyForPurpose) {
		t.Errorf("RequirePurposes gave %v, want ErrNoKeyForPurpose", err)
	}
	if err != nil && !contains(err.Error(), "signing") {
		t.Errorf("the failure does not name the missing purpose: %v", err)
	}
}

// Tampering with the ciphertext is detected — it is AEAD, so this is
// expected, but a voucher code that could be altered in place by someone
// with database write access is worth an explicit test.
func TestATamperedCiphertextIsRejected(t *testing.T) {
	ring := newRing(t)

	sealed, err := ring.Seal(keyring.PurposeVoucherCode, []byte("ABCD1234EFGH5678K"))
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	sealed.Ciphertext[0] ^= 0xff

	if _, err := ring.Open(keyring.PurposeVoucherCode, sealed); err == nil {
		t.Error("a modified ciphertext decrypted successfully")
	}
}

func TestAMasterKeyMustBe32Bytes(t *testing.T) {
	_, err := keyring.New(map[keyring.Purpose]map[int][]byte{
		keyring.PurposeVoucherCode: {1: []byte("too short")},
	})
	if !errors.Is(err, keyring.ErrBadKeyLength) {
		t.Errorf("a short master key was accepted: %v", err)
	}
}

// YT-0533: "keys live outside the repo and outside the build artifact". The
// criterion most likely to be satisfied when written and violated six weeks
// later, so it is checked rather than trusted.
func TestKeysInsideAGitTreeAreRefused(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	keys := filepath.Join(root, "secrets")
	if err := os.Mkdir(keys, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	writeKey(t, keys, "voucher_code.v1.key", master(1))

	if _, err := keyring.FromDirectory(keys); err == nil {
		t.Fatal("master keys inside a git working tree were loaded")
	}
}

func TestFromDirectoryLoadsEveryVersion(t *testing.T) {
	keys := keyDirOutsideAnyRepo(t)
	writeKey(t, keys, "voucher_code.v1.key", master(1))
	writeKey(t, keys, "voucher_code.v2.key", master(40))
	writeKey(t, keys, "merchant_hmac.v1.key", master(90))
	// A README beside the keys must not be mistaken for one.
	if err := os.WriteFile(filepath.Join(keys, "README.md"), []byte("rotation runbook"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}

	ring, err := keyring.FromDirectory(keys)
	if err != nil {
		t.Fatalf("FromDirectory: %v", err)
	}
	if got := len(ring.Versions(keyring.PurposeVoucherCode)); got != 2 {
		t.Errorf("loaded %d versions of the voucher-code key, want 2", got)
	}
	if err := ring.RequirePurposes(keyring.PurposeVoucherCode, keyring.PurposeMerchantHMAC); err != nil {
		t.Errorf("RequirePurposes: %v", err)
	}
}

// A key file naming a purpose nobody registered is a typo or a forgotten
// registration, and either way a key that can never be selected.
func TestAnUnknownPurposeInTheKeyDirectoryIsRefused(t *testing.T) {
	keys := keyDirOutsideAnyRepo(t)
	writeKey(t, keys, "voucher_codes.v1.key", master(1)) // note the plural

	if _, err := keyring.FromDirectory(keys); err == nil {
		t.Fatal("a key file with an unregistered purpose was accepted")
	}
}

// keyDirOutsideAnyRepo is `t.TempDir()` for the tests that need the loader to
// SUCCEED.
//
// `t.TempDir()` is not usable for those, and the reason is worth stating
// because it looks like over-engineering until it costs an hour: `go test`
// points the test process's temp directory at `GOTMPDIR`, a developer may
// reasonably set that inside the checkout, and the loader then refuses —
// correctly, and for a reason that has nothing to do with what the test is
// checking. A test whose result depends on an environment variable is the
// kind that fails on one machine and passes on every other.
//
// So candidate bases are tried in turn until one is both writable and
// outside a git working tree. Three, rather than one, because the first
// choice was wrong twice already: the system temp directory is inside the
// checkout when GOTMPDIR is set, and the user cache directory does not
// exist at all in a bare container.
func keyDirOutsideAnyRepo(t *testing.T) string {
	t.Helper()

	var tried []string
	for _, base := range candidateBases() {
		directory, err := os.MkdirTemp(base, "yourtal-keyring-")
		if err != nil {
			tried = append(tried, base+" (not writable)")
			continue
		}

		// The loader's own guard, asked in advance, so an unsuitable base is
		// skipped rather than failing inside the assertion.
		if _, err := keyring.FromDirectory(directory); err != nil &&
			contains(err.Error(), "git working tree") {
			_ = os.RemoveAll(directory)
			tried = append(tried, base+" (inside a git tree)")
			continue
		}

		t.Cleanup(func() { _ = os.RemoveAll(directory) })
		return directory
	}

	t.Skipf("no directory outside a git working tree to put master keys in; tried %v", tried)
	return ""
}

func candidateBases() []string {
	bases := []string{os.TempDir()}
	if cache, err := os.UserCacheDir(); err == nil {
		if err := os.MkdirAll(cache, 0o755); err == nil {
			bases = append(bases, cache)
		}
	}
	if home, err := os.UserHomeDir(); err == nil {
		bases = append(bases, home)
	}
	return bases
}

func writeKey(t *testing.T, directory, name string, key []byte) {
	t.Helper()
	encoded := make([]byte, hex.EncodedLen(len(key)))
	hex.Encode(encoded, key)
	if err := os.WriteFile(filepath.Join(directory, name), encoded, 0o600); err != nil {
		t.Fatalf("writing %s: %v", name, err)
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && bytes.Contains([]byte(haystack), []byte(needle))
}
