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
// NOTHING FAILS — sqlc generates confidently wrong types against a schema
// that no longer exists, and the mismatch surfaces as a runtime scan error
// weeks later, or as a column the code cannot see at all.
//
// So the copy is checked against the live database here. If this fails after
// a migration, the fix is to update db/schema.sql and re-run sqlc, not to
// relax the test.
//
// The same guard the ledger service has, for the same reason. It is written
// out twice rather than shared because the two services are separate Go
// modules on purpose (docs/13, module boundaries enforced twice) — a shared
// test helper would be the first thread of the dependency that separation
// exists to prevent.
const voucherURL = "postgres://yourtal_voucher:voucher_local_only@127.0.0.1:26432/yourtal"

// `[a-z_0-9]+`, and the digits matter. The ledger service's copy of this
// pattern is `[a-z_]+`, which happens to work there because no ledger column
// has a digit in its name — and silently dropped `manifest_sha256` here on
// this guard's first run, reporting a drift that did not exist. A parser
// that under-reports columns makes this whole check fail OPEN for any column
// it cannot see, so the bug was in the direction that eventually matters.
var columnPattern = regexp.MustCompile(`(?m)^\s{2}([a-z_0-9]+)\s`)

// Every table sqlc types against, and the schema it lives in.
var tables = map[string]string{
	"batch":               "voucher",
	"vouchers":            "voucher",
	"code_custody":        "voucher",
	"event":               "voucher",
	"authorization":       "voucher",
	"capture":             "voucher",
	"refund":              "voucher",
	"merchant_credential": "voucher",
	"kill_switch":         "voucher",
	"redemption_attempt":  "voucher",
	"listings":            "store",
	"listing_location":    "store",
}

func TestSqlcSchemaMatchesTheLiveDatabase(t *testing.T) {
	url := os.Getenv("VOUCHER_DATABASE_URL")
	if url == "" {
		url = voucherURL
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

	// The parser returning nothing would make every comparison below pass by
	// comparing two empty sets — the failure mode this file exists to stop,
	// reproduced inside the check itself.
	if got := columnsDeclaredFor(string(declared), "vouchers"); len(got) < 5 {
		t.Fatalf("the schema parser found %d columns on voucher.vouchers; it is broken", len(got))
	}

	for table, schema := range tables {
		t.Run(schema+"."+table, func(t *testing.T) {
			want := columnsDeclaredFor(string(declared), table)
			got := columnsInDatabase(ctx, t, pool, schema, table)

			if strings.Join(want, ",") != strings.Join(got, ",") {
				t.Errorf(
					"%s.%s drifted.\n  db/schema.sql: %v\n  database:      %v\n"+
						"Update db/schema.sql to match the migration and re-run sqlc.",
					schema, table, want, got)
			}
		})
	}
}

func columnsDeclaredFor(declared, table string) []string {
	start := strings.Index(declared, "CREATE TABLE ")
	for start >= 0 {
		rest := declared[start:]
		header := rest[:strings.Index(rest, "(")]
		if strings.HasSuffix(strings.TrimSpace(header), "."+table) {
			body := rest[strings.Index(rest, "(") : strings.Index(rest, ");")+1]
			var columns []string
			for _, match := range columnPattern.FindAllStringSubmatch(body, -1) {
				name := match[1]
				if name == "primary" || name == "constraint" || name == "unique" {
					continue
				}
				columns = append(columns, name)
			}
			sort.Strings(columns)
			return columns
		}
		next := strings.Index(declared[start+1:], "CREATE TABLE ")
		if next < 0 {
			break
		}
		start = start + 1 + next
	}
	return nil
}

func columnsInDatabase(
	ctx context.Context, t *testing.T, pool *pgxpool.Pool, schema, table string,
) []string {
	t.Helper()

	rows, err := pool.Query(ctx,
		`SELECT column_name FROM information_schema.columns
		  WHERE table_schema = $1 AND table_name = $2`, schema, table)
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
