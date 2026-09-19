package store_test

import (
	"context"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// `db/schema.sql` is a COPY. Atlas owns the real schema
// (packages/db/migrations); sqlc only reads this file to type the generated
// Go. That makes it the most dangerous kind of duplicate: when the two drift,
// nothing fails — sqlc generates confidently wrong types against a schema
// that no longer exists, and the mismatch surfaces as a runtime scan error
// weeks later, or as a column the code cannot see at all.
//
// So the copy is checked against the live database here. If this fails after
// a migration, the fix is to update db/schema.sql and re-run sqlc, not to
// relax the test.

const ledgerURL = "postgres://yourtal_ledger:ledger_local_only@127.0.0.1:26432/yourtal"

var columnPattern = regexp.MustCompile(`(?m)^\s{2}([a-z_]+)\s`)

func TestSqlcSchemaMatchesTheLiveDatabase(t *testing.T) {
	url := os.Getenv("LEDGER_DATABASE_URL")
	if url == "" {
		url = ledgerURL
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		t.Skipf("no local Postgres (run `pnpm dev:up`): %v", err)
	}

	declared, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatalf("reading db/schema.sql: %v", err)
	}

	// `backing_rate` joined the list with YT-0130's pricing engine. A table
	// sqlc types against but this loop does not name is one the guard cannot
	// see drift in, which is the same fail-open shape the guard exists to
	// prevent — the list is the coverage.
	//
	// ⚠️ `columnPattern` above is `[a-z_]+` and therefore cannot match a
	// column name containing a digit. No ledger column has one today, so it
	// works here; the identical pattern in services/voucher silently dropped
	// `manifest_sha256` and reported a drift that did not exist. Worth
	// widening to `[a-z_0-9]+` before a digit-bearing column arrives.
	for _, table := range []string{"account", "transfer", "entry", "backing_rate"} {
		t.Run(table, func(t *testing.T) {
			want := columnsDeclaredFor(string(declared), table)
			got := columnsInDatabase(ctx, t, pool, table)

			if strings.Join(want, ",") != strings.Join(got, ",") {
				t.Errorf(
					"ledger.%s drifted.\n  db/schema.sql: %v\n  database:      %v\n"+
						"Update db/schema.sql to match the migration and re-run sqlc.",
					table, want, got,
				)
			}
		})
	}
}

// Pulls the column names out of one CREATE TABLE block in the sqlc schema.
// Crude on purpose: a parser would be a second thing to get wrong, and the
// file it reads is one we control and keep simple.
func columnsDeclaredFor(schema, table string) []string {
	start := strings.Index(schema, "CREATE TABLE ledger."+table+" (")
	if start < 0 {
		return nil
	}
	body := schema[start:]
	if end := strings.Index(body, "\n);"); end >= 0 {
		body = body[:end]
	}

	var columns []string
	for _, match := range columnPattern.FindAllStringSubmatch(body, -1) {
		name := match[1]
		// Skip table-level constraint clauses, which are not columns.
		if name == "constraint" || name == "primary" || name == "unique" {
			continue
		}
		columns = append(columns, name)
	}
	sort.Strings(columns)
	return columns
}

func columnsInDatabase(ctx context.Context, t *testing.T, pool *pgxpool.Pool, table string) []string {
	t.Helper()

	rows, err := pool.Query(ctx,
		`SELECT column_name FROM information_schema.columns
		  WHERE table_schema = 'ledger' AND table_name = $1
		  ORDER BY column_name`, table)
	if err != nil {
		t.Fatalf("reading columns: %v", err)
	}
	defer rows.Close()

	var columns []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan: %v", err)
		}
		columns = append(columns, name)
	}
	sort.Strings(columns)
	return columns
}
