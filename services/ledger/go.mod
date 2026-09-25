// The ledger service. docs/15 makes it one of the six Phase 1 deployables and
// the sole writer of every point and cash balance.
//
// A module per service rather than one at the repo root: docs/13 draws module
// boundaries and enforces them twice, and a shared Go module would let the
// voucher service import the ledger's internals by accident. `internal/` then
// means what it says.
module github.com/yourtal/services/ledger

go 1.26.0

toolchain go1.26.8

require (
	github.com/go-chi/chi/v5 v5.3.2
	github.com/jackc/pgx/v5 v5.11.0
)

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	golang.org/x/sync v0.23.0 // indirect
	golang.org/x/text v0.42.0 // indirect
)
