package store_test

import (
	"strings"
	"testing"
)

// The drift guard's parser, tested without a database. YT-0565.
//
// `TestSqlcSchemaMatchesTheLiveDatabase` skips when Postgres is absent, which
// is correct for a unit run — but it meant the parser itself had no coverage
// in `go test ./...`, and the parser is where the defect was. These need no
// connection, so they run everywhere the module builds.
//
// The case that matters is the digit-bearing column. The old pattern,
// `^\s{2}([a-z_]+)\s`, could not match one and **did not report anything** —
// the column was dropped and the comparison ran over a partial set. That is
// the failure this file exists to make impossible to reintroduce.

const digitBearingTable = `
CREATE TABLE ledger.entry (
  id            bigserial   PRIMARY KEY,
  manifest_sha256 text      NOT NULL,
  amount_minor  bigint      NOT NULL
);
`

func TestDigitBearingColumnIsRead(t *testing.T) {
	columns, err := columnsDeclaredFor(digitBearingTable, "entry")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	joined := strings.Join(columns, ",")
	if joined != "amount_minor,id,manifest_sha256" {
		t.Fatalf("got %q, want all three columns including the one with digits", joined)
	}
}

func TestUnreadableLineIsAnErrorNotAnOmission(t *testing.T) {
	// The whole point. A line the parser cannot classify must FAIL rather
	// than be skipped — a guard that quietly covers less than it claims is
	// worse than one that is absent, because its green is believed.
	schema := `
CREATE TABLE ledger.entry (
  id bigserial PRIMARY KEY,
  "QuotedColumn" text NOT NULL
);
`
	columns, err := columnsDeclaredFor(schema, "entry")
	if err == nil {
		t.Fatalf("expected an error, got columns %v", columns)
	}
	if !strings.Contains(err.Error(), "neither a column nor a table-level clause") {
		t.Fatalf("error should name what it could not read, got: %v", err)
	}
}

func TestTableLevelClausesAreNotColumns(t *testing.T) {
	schema := `
CREATE TABLE ledger.entry (
  id bigserial PRIMARY KEY,
  amount_minor bigint NOT NULL,
  CONSTRAINT entry_amount_nonzero CHECK (amount_minor <> 0)
);
`
	columns, err := columnsDeclaredFor(schema, "entry")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.Join(columns, ",") != "amount_minor,id" {
		t.Fatalf("got %v, want the two columns and not the constraint", columns)
	}
}

func TestCommentsAndBlankLinesAreIgnored(t *testing.T) {
	schema := `
CREATE TABLE ledger.entry (
  -- Append-only; see docs/14.
  id bigserial PRIMARY KEY,

  amount_minor bigint NOT NULL
);
`
	columns, err := columnsDeclaredFor(schema, "entry")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if strings.Join(columns, ",") != "amount_minor,id" {
		t.Fatalf("got %v", columns)
	}
}

func TestMissingTableIsAnError(t *testing.T) {
	// A renamed table would otherwise yield an empty expectation, and an
	// empty expectation compares nothing and passes.
	if _, err := columnsDeclaredFor(digitBearingTable, "no_such_table"); err == nil {
		t.Fatal("expected an error for a table that is not in the schema")
	}
}

func TestUnterminatedBlockIsAnError(t *testing.T) {
	if _, err := columnsDeclaredFor("CREATE TABLE ledger.entry (\n  id bigserial", "entry"); err == nil {
		t.Fatal("expected an error for a block with no closing paren")
	}
}
