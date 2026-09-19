// Package proof computes and verifies the ledger's daily Merkle root.
// YT-0044.
//
// # What a root can and cannot do
//
// It cannot PREVENT an edit. The ledger role holds no UPDATE or DELETE grant
// (docs/14 §8), so altering an entry already requires a superuser — and
// nothing at the database layer stops someone who has one.
//
// What the root does is make that edit **provable afterwards**. docs/14 §3
// names the threat precisely: a direct UPDATE on balances via a leaked
// credential, caught because "a published root makes silent edits detectable
// next day". The difference it buys is between a silent restatement and an
// incident with a date on it.
package proof

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

// Leaf is one entry, reduced to the fields that must not change.
//
// Deliberately not the whole row. `created_at` is excluded because it is set
// by the database default and a restore can legitimately alter it; the
// fields here are the ones whose change would mean money moved differently.
type Leaf struct {
	ID          int64
	TransferID  string
	AccountID   string
	AmountMinor int64
	Currency    string
}

// leafHash renders one entry canonically and hashes it.
//
// The separator is a unit separator (0x1F) rather than a comma or a colon,
// because account ids and transfer ids are caller-supplied strings: with a
// printable separator, an account literally named `a\x1Fb` could produce the
// same canonical form as two different fields, and two distinct ledgers
// would hash identically. That is a collision an attacker chooses, not one
// they wait for.
func leafHash(leaf Leaf) string {
	canonical := fmt.Sprintf("%d\x1F%s\x1F%s\x1F%d\x1F%s",
		leaf.ID, leaf.TransferID, leaf.AccountID, leaf.AmountMinor, leaf.Currency)

	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:])
}

// Root computes the Merkle root over an ordered set of leaves.
//
// The empty day is a defined value, not an error: a day with no entries is
// an ordinary day, and a checker that could not record one would have a hole
// in its history exactly where it is least expected — over a weekend, or
// during an outage.
//
// Odd levels promote the last node rather than duplicating it. Duplicating
// is the common shortcut and it is the CVE-2012-2459 shape: two different
// leaf sets can produce the same root, because a promoted-and-duplicated
// final node is indistinguishable from a genuine pair. Promotion has no such
// ambiguity.
func Root(leaves []Leaf) string {
	if len(leaves) == 0 {
		sum := sha256.Sum256([]byte("yourtal:ledger:empty-day"))
		return hex.EncodeToString(sum[:])
	}

	level := make([]string, 0, len(leaves))
	for _, leaf := range leaves {
		level = append(level, leafHash(leaf))
	}

	for len(level) > 1 {
		next := make([]string, 0, (len(level)+1)/2)

		for index := 0; index < len(level); index += 2 {
			if index+1 == len(level) {
				// Promote, never duplicate. See the doc comment.
				next = append(next, level[index])
				continue
			}
			next = append(next, pairHash(level[index], level[index+1]))
		}
		level = next
	}

	return level[0]
}

func pairHash(left, right string) string {
	sum := sha256.Sum256([]byte(left + right))
	return hex.EncodeToString(sum[:])
}
