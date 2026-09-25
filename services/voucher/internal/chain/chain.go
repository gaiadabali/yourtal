// Package chain is the per-voucher hash-chained event log. YT-0140.
//
// # What a hash chain buys that an audit table does not
//
// docs/09 §10 promises the merchant an audit trail that is "replayable,
// exportable". An ordinary append-only table proves nothing to a merchant in
// a dispute, because the party they are disputing with also operates the
// database. Each event committing to its predecessor changes that: a removed
// or edited row breaks every hash after it, and the break is detectable by
// somebody holding only an old copy of the head — without needing to know
// what the row used to say.
//
// It does not prove the operator cannot rewrite the whole chain. What it
// proves is that they cannot rewrite PART of it, which is what actually
// happens: a single inconvenient row, edited quietly.
//
// # Why the detail is strings and only strings
//
// The chain is verified by re-computing hashes from stored data, so the
// encoding has to survive a round trip through the database byte for byte.
// `detail` is a jsonb column, and jsonb normalises: it sorts keys, drops
// duplicates, and — the one that would silently break this — stores numbers
// as numerics, so `1e2` comes back as `100`. Hashing anything numeric would
// make verification depend on formatting nobody controls.
//
// So values are strings. An amount is a decimal string, an id is a string,
// and the canonical encoding below is built from them with explicit length
// prefixes rather than a separator, because a separator is something a value
// can contain: without prefixes, {"a": "b=c"} and {"a=b": "c"} hash the same,
// and that is a forgery, not a curiosity.
//
// # And the same argument, for time
//
// The first version of this hashed `UnixNano()`, and every chain it wrote
// failed to verify on the way back. Go's `time.Time` carries nanoseconds;
// Postgres `timestamptz` keeps MICROSECONDS. So the value that went in and
// the value that came out were different numbers, and the hash computed over
// the second one could never match the hash stored from the first.
//
// It presented as "the event chain is broken at seq 1", which is exactly what
// tampering looks like — and it was simply a unit mismatch across a boundary.
// The fix is to hash the precision the storage actually has, and to truncate
// at the point of creation so the in-memory value and the stored one are the
// same instant rather than two instants that usually agree.
package chain

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// GenesisHash is what a voucher's first event commits to. Sixty-four zeroes
// rather than the voucher id, so "is this the first event?" is answerable
// without knowing which voucher you are looking at.
const GenesisHash = "0000000000000000000000000000000000000000000000000000000000000000"

// Event types. A closed set, because an event type invented at a call site
// is one no report groups and no dispute can be explained with.
const (
	TypeMinted      = "minted"
	TypeAllocated   = "allocated"
	TypeActivated   = "activated"
	TypeAuthorized  = "authorized"
	TypeCaptured    = "captured"
	TypeVoided      = "voided"
	TypeRefunded    = "refunded"
	TypeExpired     = "expired"
	TypeRestored    = "restored"
	TypeTransferred = "transferred"
	// TypeHoldExpired — a hold timed out and the sweeper released the voucher.
	TypeHoldExpired = "hold_expired"
)

var Types = []string{
	TypeMinted, TypeAllocated, TypeActivated, TypeAuthorized, TypeCaptured,
	TypeVoided, TypeRefunded, TypeExpired, TypeRestored, TypeTransferred, TypeHoldExpired,
}

var (
	// ErrUnknownType — see the note on the constants.
	ErrUnknownType = errors.New("chain: unknown event type")
	// ErrBroken — the chain does not verify. The error names the sequence
	// number, because "somewhere in this voucher's history" is not an
	// actionable thing to tell an investigator.
	ErrBroken = errors.New("chain: the event chain is broken")
	// ErrOutOfOrder — sequence numbers that skip or repeat. A gap is as
	// much a tampering signal as a bad hash: deleting the last event of a
	// chain leaves every remaining hash valid.
	ErrOutOfOrder = errors.New("chain: sequence numbers are not consecutive from 1")
)

// Event is one thing that happened to one voucher.
type Event struct {
	VoucherID  string
	Seq        int
	Type       string
	Detail     map[string]string
	OccurredAt time.Time
}

// Hash computes an event's hash from its predecessor's.
//
// Every field is length-prefixed; see the package comment for why a
// separator would not do. The time is MICROseconds since the epoch in UTC —
// microseconds because that is the precision `timestamptz` preserves, and an
// epoch integer because a timestamp's textual rendering varies by session
// timezone and by driver.
func Hash(prevHash string, event Event) (string, error) {
	if !known(event.Type) {
		return "", fmt.Errorf("%w: %q is not one of %v", ErrUnknownType, event.Type, Types)
	}

	digest := sha256.New()
	writeField(digest, prevHash)
	writeField(digest, event.VoucherID)
	writeUint(digest, uint64(event.Seq))
	writeField(digest, event.Type)
	writeUint(digest, uint64(Instant(event.OccurredAt).UnixMicro()))

	// Sorted, so the hash does not depend on Go's map iteration order —
	// which is deliberately randomised, and would otherwise make this
	// function return a different answer each run.
	keys := make([]string, 0, len(event.Detail))
	for key := range event.Detail {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	writeUint(digest, uint64(len(keys)))
	for _, key := range keys {
		writeField(digest, key)
		writeField(digest, event.Detail[key])
	}

	return hex.EncodeToString(digest.Sum(nil)), nil
}

// Verify replays a voucher's whole history.
//
// `stored` are the hashes as the database holds them, in sequence order.
// Recomputing and comparing is the entire point: a row edited in place
// produces a hash that no longer matches its own stored value, and every
// later row inherits the break.
func Verify(events []Event, stored []string) error {
	if len(events) != len(stored) {
		return fmt.Errorf("%w: %d events against %d stored hashes",
			ErrBroken, len(events), len(stored))
	}

	previous := GenesisHash
	for index, event := range events {
		// A gap or a repeat is tampering too: deleting the LAST event of a
		// chain leaves every remaining hash perfectly valid, so the only
		// thing that catches it is the sequence being dense from 1.
		if event.Seq != index+1 {
			return fmt.Errorf("%w: event %d carries seq %d", ErrOutOfOrder, index+1, event.Seq)
		}

		computed, err := Hash(previous, event)
		if err != nil {
			return err
		}
		if computed != stored[index] {
			return fmt.Errorf("%w: at seq %d the stored hash is %s but the event hashes to %s",
				ErrBroken, event.Seq, abbreviate(stored[index]), abbreviate(computed))
		}
		previous = computed
	}
	return nil
}

// Instant truncates a time to what the database will keep.
//
// Called at the point an event is created, so the value hashed, the value
// stored and the value read back are one instant rather than three that
// usually agree. Truncation rather than rounding, to match Postgres.
func Instant(at time.Time) time.Time { return at.UTC().Truncate(time.Microsecond) }

// Head is the hash a caller keeps to detect later tampering: the last hash
// in a verified chain, or the genesis for a voucher with no history.
func Head(stored []string) string {
	if len(stored) == 0 {
		return GenesisHash
	}
	return stored[len(stored)-1]
}

func known(eventType string) bool {
	for _, candidate := range Types {
		if candidate == eventType {
			return true
		}
	}
	return false
}

func writeField(digest interface{ Write([]byte) (int, error) }, value string) {
	writeUint(digest, uint64(len(value)))
	_, _ = digest.Write([]byte(value))
}

func writeUint(digest interface{ Write([]byte) (int, error) }, value uint64) {
	var buffer [8]byte
	binary.BigEndian.PutUint64(buffer[:], value)
	_, _ = digest.Write(buffer[:])
}

func abbreviate(hash string) string {
	if len(hash) <= 12 {
		return hash
	}
	return hash[:12] + "…"
}

// Detail is a small helper for building an event's detail map from pairs,
// so call sites read as a list of facts rather than as map literals.
func Detail(pairs ...string) map[string]string {
	if len(pairs)%2 != 0 {
		// A programming error, and one that would otherwise silently drop
		// the last fact from an audit record.
		panic("chain: Detail needs an even number of arguments")
	}
	detail := make(map[string]string, len(pairs)/2)
	for index := 0; index < len(pairs); index += 2 {
		detail[pairs[index]] = pairs[index+1]
	}
	return detail
}

// Amount renders a minor-unit amount for a detail map. One place, so an
// audit trail does not carry two spellings of the same number.
func Amount(minor int64) string { return strings.TrimSpace(fmt.Sprintf("%d", minor)) }
