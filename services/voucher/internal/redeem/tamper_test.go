package redeem_test

import (
	"context"
	"testing"

	"github.com/yourtal/services/voucher/internal/redeem"
)

// docs/09 §10 promises the merchant an audit trail that is "replayable,
// exportable". That promise is only worth something if editing it is
// detectable — so this edits it.
//
// Against the real table rather than an in-memory slice, because the claim
// is about what happens to rows in Postgres. `chain_test.go` proves the
// hashing; this proves the hashing is actually wired to the rows that get
// written, which is the half that silently comes undone.
func TestEditingAStoredEventBreaksVerification(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	voucherID, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)

	authorization, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 30_000,
		Currency: "IDR", OrderRef: orderRef(),
	})
	if err != nil {
		t.Fatalf("Authorize: %v", err)
	}
	if _, err := f.network.Capture(ctx, authorization.ID, f.merchantID, 30_000, orderRef()); err != nil {
		t.Fatalf("Capture: %v", err)
	}

	// It verifies before the edit. Without this the test could pass because
	// verification never worked at all.
	if err := f.minter.VerifyChain(ctx, voucherID); err != nil {
		t.Fatalf("the chain did not verify before tampering: %v", err)
	}

	// The realistic tamper: somebody with database access quietly reduces
	// what a capture took, so a merchant appears to be owed less. Every other
	// column, including the row's own hash, is left exactly as it was —
	// which is what makes it invisible to an ordinary audit table.
	//
	// As the OWNER. The first version of this used the service's own pool and
	// failed with "permission denied for table event" — which was the grant
	// working, not the test failing: `yourtal_voucher` can append to the log
	// and cannot rewrite it. An attacker who could only reach the service's
	// credential therefore cannot do this at all, so the scenario worth
	// testing is the one where they have more.
	owner := f.asOwner(t)
	tag, err := owner.Exec(ctx,
		`UPDATE voucher.event
		    SET detail = jsonb_set(detail, '{amount_minor}', '"1"')
		  WHERE voucher_id = $1 AND event_type = 'captured'`,
		voucherID)
	if err != nil {
		t.Fatalf("tampering: %v", err)
	}
	// Confirm the sabotage actually landed. A green run after an edit that
	// changed nothing is indistinguishable from an edit that was caught —
	// the specific trap `docs/13c-lessons.md` records.
	if tag.RowsAffected() != 1 {
		t.Fatalf("the tamper touched %d rows; it needs to touch exactly 1", tag.RowsAffected())
	}

	if err := f.minter.VerifyChain(ctx, voucherID); err == nil {
		t.Fatal("an edited event verified — the chain is decorative")
	}
}

// Deleting the last event leaves every remaining hash valid, so only the
// sequence being dense from 1 catches it. Proved against the table for the
// same reason as above.
func TestDeletingAStoredEventBreaksVerification(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	voucherID, plaintext := f.mintOne(t, "balance_carrying", 50_000, nil)
	if _, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
		Code: plaintext, MerchantID: f.merchantID, AmountMinor: 30_000,
		Currency: "IDR", OrderRef: orderRef(),
	}); err != nil {
		t.Fatalf("Authorize: %v", err)
	}

	if err := f.minter.VerifyChain(ctx, voucherID); err != nil {
		t.Fatalf("the chain did not verify before tampering: %v", err)
	}

	// The middle event — `allocated`, seq 2 — removed. As the owner, because
	// `yourtal_voucher` deliberately has no DELETE on the event table: the
	// service that writes the log cannot erase it, which is the point, and
	// is also why this test has to reach past its own role to do the damage.
	owner := f.asOwner(t)
	tag, err := owner.Exec(ctx,
		`DELETE FROM voucher.event WHERE voucher_id = $1 AND seq = 2`, voucherID)
	if err != nil {
		t.Fatalf("deleting: %v", err)
	}
	if tag.RowsAffected() != 1 {
		t.Fatalf("the delete touched %d rows; it needs to touch exactly 1", tag.RowsAffected())
	}

	if err := f.minter.VerifyChain(ctx, voucherID); err == nil {
		t.Fatal("a chain with a hole in it verified")
	}
}

// The grant underneath the chain: the service that writes the audit log
// cannot rewrite or erase it. A hash chain an attacker can recompute end to
// end proves nothing, and holding no UPDATE is what makes recomputation
// require a second credential.
func TestTheVoucherServiceCannotRewriteItsOwnAuditLog(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	voucherID, _ := f.mintOne(t, "balance_carrying", 50_000, nil)

	if _, err := f.pool.Exec(ctx,
		`DELETE FROM voucher.event WHERE voucher_id = $1`, voucherID); err == nil {
		t.Error("the voucher service deleted from its own event log")
	}
	if _, err := f.pool.Exec(ctx,
		`UPDATE voucher.event SET hash = repeat('0', 64) WHERE voucher_id = $1`,
		voucherID); err == nil {
		t.Error("the voucher service rewrote a hash in its own event log")
	}
}
