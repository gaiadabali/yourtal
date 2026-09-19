// The voucher service. docs/15 makes it one of the six Phase 1 deployables:
// voucher lifecycle plus the redemption network.
//
// Its OWN module, like the ledger's, so `internal/` means what it says and
// neither service can reach into the other's internals by accident
// (docs/13, module boundaries enforced twice). The two talk over HTTP or
// not at all.
module github.com/yourtal/services/voucher

go 1.26
