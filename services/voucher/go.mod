// The voucher service. docs/15 makes it one of the six Phase 1 deployables:
// voucher lifecycle plus the redemption network.
//
// Its OWN module, like the ledger's, so `internal/` means what it says and
// neither service can reach into the other's internals by accident
// (docs/13, module boundaries enforced twice). The two talk over HTTP or
// not at all.
module github.com/yourtal/services/voucher

go 1.27.0

toolchain go1.27.1

require (
	github.com/go-chi/chi/v5 v5.3.2
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.11.0
)

require (
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	golang.org/x/sync v0.23.0 // indirect
	golang.org/x/text v0.42.0 // indirect
)
