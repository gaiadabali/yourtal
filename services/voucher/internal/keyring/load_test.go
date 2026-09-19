package keyring_test

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"

	"github.com/yourtal/services/voucher/internal/keyring"
)

// Loading master keys from disk: where they may live, what a key file has to
// look like, and which purposes a deployment must hold.
//
// Split from keyring_test.go to stay under docs/15 rule 6's 300 lines. The
// seam is that nothing here exercises the cryptography — it is all about
// where the key material comes from.

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
