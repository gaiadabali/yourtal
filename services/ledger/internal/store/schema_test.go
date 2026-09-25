package store_test

import (
	"context"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/ledger/internal/testdb"
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

// A column name: lowercase, may contain digits. The digits matter — see
// `columnsDeclaredFor` for what the old `[a-z_]+` did to names containing
// one, which was nothing, silently.
var identifierPattern = regexp.MustCompile(`^[a-z_][a-z0-9_]*$`)

// Table-level clauses that appear at the same indentation as a column and
// are not one.
var tableLevelClauses = map[string]bool{
	"constraint": true,
	"primary":    true,
	"unique":     true,
	"foreign":    true,
	"check":      true,
	"exclude":    true,
}

func TestSqlcSchemaMatchesTheLiveDatabase(t *testing.T) {
	url := testdb.URL(t, "LEDGER_DATABASE_URL")

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
	for _, table := range []string{"account", "transfer", "entry", "backing_rate"} {
		t.Run(table, func(t *testing.T) {
			want, err := columnsDeclaredFor(string(declared), table)
			if err != nil {
				// A parse failure is a FAILURE, never a skip. That is the
				// whole of YT-0565: the previous version could not recognise
				// a column name containing a digit and simply did not compare
				// it, so the guard's coverage was whatever the pattern
				// happened to match rather than a set anyone had reviewed.
				t.Fatalf("cannot read ledger.%s from db/schema.sql: %v", table, err)
			}
			if len(want) == 0 {
				// An empty expectation compares nothing and passes. A
				// renamed table would otherwise make this guard green by
				// having no opinion at all.
				t.Fatalf("no columns found for ledger.%s in db/schema.sql", table)
			}
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
//
// # Every line is classified, and anything unrecognised is an error
//
// This used to be a regex scan: `^\s{2}([a-z_]+)\s`, collecting whatever
// matched. The defect (YT-0565) was not the character class — it was that an
// unmatched line was **silently dropped**. A column named `sha256_hash`
// simply was not compared, and the guard reported success over a table it
// had only partly read. The identical pattern in services/voucher dropped
// `manifest_sha256` and then reported a drift that did not exist.
//
// Widening the class to `[a-z0-9_]+` would have fixed that instance and left
// the shape intact, so instead every line inside the block is accounted for:
// a column, a table-level clause, a comment, or an error. **The guard now
// fails on input it does not understand rather than covering less of it.**
//
// `docs/13c`: every parser-based check needs one question asked of it — what
// does it do with input it does not recognise? "Skips it" means the coverage
// is whatever the pattern happens to match.
func columnsDeclaredFor(schema, table string) ([]string, error) {
	header := "CREATE TABLE ledger." + table + " ("
	start := strings.Index(schema, header)
	if start < 0 {
		return nil, fmt.Errorf("no %q block found", header)
	}

	body := schema[start+len(header):]
	end := strings.Index(body, "\n);")
	if end < 0 {
		return nil, fmt.Errorf("%q block has no closing );", header)
	}
	body = body[:end]

	var columns []string
	for number, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "--") {
			continue
		}

		// The first token, stripped of the punctuation a column line ends or
		// continues with.
		first := strings.ToLower(strings.FieldsFunc(trimmed, func(r rune) bool {
			return r == ' ' || r == '\t' || r == '(' || r == ','
		})[0])

		if tableLevelClauses[first] {
			continue
		}
		if !identifierPattern.MatchString(first) {
			return nil, fmt.Errorf(
				"line %d of ledger.%s is neither a column nor a table-level clause: %q. "+
					"Refusing to guess — an unreadable line used to be skipped, which is how "+
					"a guard reports success over a table it only partly read",
				number+1, table, trimmed,
			)
		}
		columns = append(columns, first)
	}

	sort.Strings(columns)
	return columns, nil
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
