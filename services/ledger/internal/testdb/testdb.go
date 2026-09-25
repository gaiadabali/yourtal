// Package testdb guards every Postgres-backed test in this service against
// running against a real database. YT-0571: engine_test.go hard-coded
// "postgres://.../yourtal" — a real dev database — as a fallback, so a Go
// test run outside `pnpm --filter @yourtal/ledger-service test` wrote fake
// AUD rates and coverage fixtures straight into dev data.
package testdb

import (
	"net/url"
	"os"
	"strings"
	"testing"
)

// testDBPrefix is the prefix packages/db/scripts/with-test-db.mjs gives
// every database it creates before handing tests a URL.
const testDBPrefix = "yourtal_test_"

// URL reads envVar and fails the test immediately if it is unset or names a
// database that is not one of with-test-db.mjs's own. There is no fallback
// URL here — a hard-coded one is the exact defect this package exists to
// close.
func URL(t testing.TB, envVar string) string {
	t.Helper()

	raw := os.Getenv(envVar)
	if raw == "" {
		t.Fatalf(
			"%s is not set. This suite refuses to guess a database — run it via "+
				"`pnpm --filter @yourtal/ledger-service test`, which creates a fresh "+
				"%s* database and sets %s to it.",
			envVar, testDBPrefix, envVar,
		)
	}

	name, err := dbName(raw)
	if err != nil {
		t.Fatalf("%s=%q could not be parsed as a database URL: %v", envVar, raw, err)
	}
	if !strings.HasPrefix(name, testDBPrefix) {
		t.Fatalf(
			"%s names database %q, which is not a %s* database — refusing to run "+
				"against it. Run this suite via `pnpm --filter @yourtal/ledger-service test`, "+
				"which points %s at a fresh %s* database instead.",
			envVar, name, testDBPrefix, envVar, testDBPrefix,
		)
	}
	return raw
}

func dbName(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	return strings.TrimPrefix(u.Path, "/"), nil
}
