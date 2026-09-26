package ledger_test

import (
	"strings"
	"testing"

	"github.com/yourtal/services/ledger/internal/ledger"
	"github.com/yourtal/services/ledger/internal/ledgertest"
)

// 4.10.b (EM-02): the ledger role cannot issue points without a grant, a
// grant cannot account for more or fewer points than it issued, and partner
// points come only from a partner allocation.
func TestPointsAreIssuedOnlyByAGrant(t *testing.T) {
	book, pool := newLedger(t)
	owner := ownerPool(t)
	user := unique("u")
	for _, a := range append(ledger.PlatformChart(au), ledger.UserAccounts(user, au)...) {
		insert(t, pool, a)
	}
	refused := func(what string, err error) {
		t.Helper()
		if err == nil || !strings.Contains(err.Error(), "no grant accounts for") {
			t.Errorf("%s: err = %v, want refused at commit", what, err)
		}
	}

	_, err := transfer(book, ledger.GrantPartner(au, user, 100))
	refused("partner points with no grant", err)
	_, err = transfer(book, ledger.GrantMarketing(au, user, 100))
	refused("marketing points with no grant", err)

	partner := ledgertest.PartnerAllocation(t, pool, au)
	_, err = ledgertest.TryGrant(pool, au, partner, user, 50, ledger.GrantPartner(au, user, 100))
	refused("a 50-point grant row for 100 points", err)
	_, err = ledgertest.TryGrant(pool, au, marketingAllocation(t, owner, au), user, 100, ledger.GrantPartner(au, user, 100))
	refused("partner points from a marketing allocation", err)

	if _, err := ledgertest.TryGrant(pool, au, partner, user, 100, ledger.GrantPartner(au, user, 100)); err != nil {
		t.Fatalf("a grant the way the engine posts one: %v", err)
	}
	if b, _ := book.Balance(t.Context(), ledger.UserAccountID(user, ledger.PurposePending)); b != 100 {
		t.Errorf("pending = %d, want only the granted 100", b)
	}
}
