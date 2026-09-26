package main

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/yourtal/services/voucher/internal/keyring"
)

// D2: compose's keygen wrote only voucher_code, the service required
// merchant_hmac too, and the container crash-looped at boot. Build a key
// directory exactly as docker-compose.yml's voucher-keygen does, and boot
// the service's own key loader on it.
func TestTheComposeKeygenBootsTheService(t *testing.T) {
	compose, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "docker-compose.yml"))
	if err != nil {
		t.Fatalf("reading docker-compose.yml: %v", err)
	}
	loop := regexp.MustCompile(`for k in ([a-z_ ]+); do \[ -f /keys/\$\$k\.v1\.key \]`).FindSubmatch(compose)
	if loop == nil {
		t.Fatal("docker-compose.yml's voucher-keygen loop was not found; update this test with it")
	}

	dir := t.TempDir() // outside the git tree, as keyring.FromDirectory requires
	for _, purpose := range strings.Fields(string(loop[1])) {
		key := make([]byte, 32)
		if _, err := rand.Read(key); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, purpose+".v1.key"), []byte(hex.EncodeToString(key)), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv(keyring.KeyDirEnvVar, dir)
	if _, err := loadKeys(); err != nil {
		t.Fatalf("the service does not boot on the keys compose generates (%s): %v", loop[1], err)
	}
}
