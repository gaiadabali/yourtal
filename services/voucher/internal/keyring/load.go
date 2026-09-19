package keyring

import (
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// The file name a master key is stored under: `<purpose>.v<version>.key`,
// holding 64 hex characters.
//
// Hex rather than raw bytes so a key can be moved, diffed and eyeballed
// without a binary tool, and so a truncated copy is a length error rather
// than a silently shorter key.
var keyFileName = regexp.MustCompile(`^([a-z_]+)\.v([0-9]+)\.key$`)

// KeyDirEnvVar names the directory holding master keys.
const KeyDirEnvVar = "VOUCHER_KEY_DIR"

// FromDirectory loads every master key in a directory.
//
// # It refuses to load keys from inside a git working tree
//
// YT-0533's second criterion: "keys live outside the repo and outside the
// build artifact". That is the criterion most likely to be satisfied on the
// day it is written and violated six weeks later by somebody who needed the
// tests to pass on their laptop — so it is checked rather than documented.
// An ancestor directory containing `.git` means these keys are one `git add
// -A` away from being public, and the failure says so.
func FromDirectory(directory string) (*Keyring, error) {
	if repo, inside := insideGitTree(directory); inside {
		return nil, fmt.Errorf(
			"keyring: refusing to load master keys from %s — it is inside the git working tree at %s. "+
				"YT-0533 requires keys to live outside the repo and outside the build artifact",
			directory, repo)
	}

	entries, err := os.ReadDir(directory)
	if err != nil {
		return nil, fmt.Errorf("keyring: reading %s: %w", directory, err)
	}

	keys := make(map[Purpose]map[int][]byte)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		match := keyFileName.FindStringSubmatch(entry.Name())
		if match == nil {
			continue // not a key file; a README next to the keys is fine
		}

		purpose := Purpose(match[1])
		if !known(purpose) {
			return nil, fmt.Errorf(
				"keyring: %s names purpose %q, which is not one of %v — a key nobody can select "+
					"is either a typo or a purpose somebody forgot to register",
				entry.Name(), purpose, Purposes)
		}

		version, err := strconv.Atoi(match[2])
		if err != nil {
			return nil, fmt.Errorf("keyring: %s has an unreadable version: %w", entry.Name(), err)
		}

		raw, err := os.ReadFile(filepath.Join(directory, entry.Name()))
		if err != nil {
			return nil, fmt.Errorf("keyring: reading %s: %w", entry.Name(), err)
		}
		key, err := hex.DecodeString(strings.TrimSpace(string(raw)))
		if err != nil {
			return nil, fmt.Errorf("keyring: %s is not hex: %w", entry.Name(), err)
		}

		if keys[purpose] == nil {
			keys[purpose] = make(map[int][]byte)
		}
		keys[purpose][version] = key
	}

	return New(keys)
}

// RequirePurposes fails if any named purpose has no key.
//
// Called at startup with the purposes the service actually needs, so a
// deployment missing the voucher-code key fails to BOOT rather than failing
// at the first mint. The distinction matters: a boot failure is noticed by
// whoever deployed, and a first-mint failure is noticed by a customer.
//
// The same reasoning `packages/drivers` applies to a `live` driver with no
// credential — refuse at construction, never per call.
func (k *Keyring) RequirePurposes(purposes ...Purpose) error {
	var missing []string
	for _, purpose := range purposes {
		if versions, held := k.keys[purpose]; !held || len(versions) == 0 {
			missing = append(missing, string(purpose))
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("%w: %s (set %s to a directory holding <purpose>.v1.key)",
			ErrNoKeyForPurpose, strings.Join(missing, ", "), KeyDirEnvVar)
	}
	return nil
}

// Versions reports the key versions held for a purpose, so a rotation can be
// verified rather than assumed. YT-0533 asks for the rotation procedure to
// be "written down and run once"; this is what the run checks.
func (k *Keyring) Versions(purpose Purpose) []int {
	versions := make([]int, 0, len(k.keys[purpose]))
	for version := range k.keys[purpose] {
		versions = append(versions, version)
	}
	return versions
}

func known(purpose Purpose) bool {
	for _, candidate := range Purposes {
		if candidate == purpose {
			return true
		}
	}
	return false
}

// insideGitTree walks up from a directory looking for `.git`.
func insideGitTree(directory string) (string, bool) {
	current, err := filepath.Abs(directory)
	if err != nil {
		return "", false
	}

	for {
		if _, err := os.Stat(filepath.Join(current, ".git")); err == nil {
			return current, true
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", false
		}
		current = parent
	}
}
