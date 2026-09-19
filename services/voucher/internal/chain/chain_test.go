package chain_test

import (
	"errors"
	"testing"
	"time"

	"github.com/yourtal/services/voucher/internal/chain"
)

func event(seq int, at time.Time) chain.Event {
	return chain.Event{
		VoucherID:  "11111111-1111-4111-8111-111111111111",
		Seq:        seq,
		Type:       chain.TypeCaptured,
		Detail:     chain.Detail("amount_minor", "1200", "receipt_id", "rcpt_1"),
		OccurredAt: at,
	}
}

// build a valid chain of n events.
func build(t *testing.T, count int) ([]chain.Event, []string) {
	t.Helper()
	base := time.Date(2026, 9, 20, 3, 0, 0, 0, time.UTC)

	events := make([]chain.Event, 0, count)
	hashes := make([]string, 0, count)
	previous := chain.GenesisHash

	for index := 1; index <= count; index++ {
		next := event(index, base.Add(time.Duration(index)*time.Second))
		hash, err := chain.Hash(previous, next)
		if err != nil {
			t.Fatalf("Hash: %v", err)
		}
		events = append(events, next)
		hashes = append(hashes, hash)
		previous = hash
	}
	return events, hashes
}

func TestAValidChainVerifies(t *testing.T) {
	events, hashes := build(t, 5)
	if err := chain.Verify(events, hashes); err != nil {
		t.Fatalf("a chain this package built does not verify: %v", err)
	}
}

/**
 * The bug this package shipped and the database found.
 *
 * The first version hashed `UnixNano()`. Postgres `timestamptz` keeps
 * MICROseconds, so the instant written and the instant read back were
 * different numbers, and every chain failed to verify on the way out —
 * presenting as "the chain is broken at seq 1", which is precisely what
 * tampering looks like.
 *
 * This asserts the property that fixes it: an event's hash must survive the
 * round trip through the storage's precision. A test that only hashed values
 * it kept in memory would never have caught it, which is why it reached a
 * database before anything objected.
 */
func TestAHashSurvivesTheDatabasesPrecision(t *testing.T) {
	// A time with nanoseconds that Postgres cannot keep.
	precise := time.Date(2026, 9, 20, 3, 14, 15, 926_535_897, time.UTC)
	stored := precise.Truncate(time.Microsecond)

	if precise.Equal(stored) {
		t.Fatal("the fixture has no sub-microsecond component, so it tests nothing")
	}

	before, err := chain.Hash(chain.GenesisHash, event(1, precise))
	if err != nil {
		t.Fatalf("Hash: %v", err)
	}
	after, err := chain.Hash(chain.GenesisHash, event(1, stored))
	if err != nil {
		t.Fatalf("Hash: %v", err)
	}

	if before != after {
		t.Errorf("an event hashes differently before and after a round trip through "+
			"microsecond storage: %s vs %s", before[:12], after[:12])
	}
}

// The same claim about the helper callers use.
func TestInstantMatchesWhatTheColumnKeeps(t *testing.T) {
	precise := time.Date(2026, 9, 20, 3, 14, 15, 926_535_897, time.UTC)
	got := chain.Instant(precise)

	if got.Nanosecond()%1000 != 0 {
		t.Errorf("Instant left sub-microsecond precision: %d ns", got.Nanosecond())
	}
	if want := precise.Truncate(time.Microsecond); !got.Equal(want) {
		t.Errorf("Instant(%v) = %v, want %v", precise, got, want)
	}
}

// Editing a row in place breaks its own hash, and every hash after it. This
// is the whole reason the log is chained rather than merely appended.
func TestEditingAnEventBreaksTheChain(t *testing.T) {
	events, hashes := build(t, 5)

	// The inconvenient row, quietly changed: a capture of 1,200 becomes 200.
	events[2].Detail["amount_minor"] = "200"

	err := chain.Verify(events, hashes)
	if !errors.Is(err, chain.ErrBroken) {
		t.Fatalf("an edited event verified: %v", err)
	}
	if !contains(err.Error(), "seq 3") {
		t.Errorf("the failure does not name the event: %v", err)
	}
}

// Deleting the LAST event leaves every remaining hash perfectly valid. Only
// the sequence being dense from 1 catches it — which is why Verify checks
// that rather than trusting the hashes alone.
func TestTruncatingTheChainIsDetected(t *testing.T) {
	events, hashes := build(t, 5)

	// Both the event and its hash removed, as a deletion would.
	if err := chain.Verify(events[:4], hashes[:4]); err != nil {
		t.Fatalf("a truncated-but-consistent prefix should still verify on its own: %v", err)
	}

	// The realistic tamper: remove a row from the MIDDLE, which leaves the
	// sequence numbers non-consecutive.
	spliced := append(append([]chain.Event{}, events[:2]...), events[3:]...)
	splicedHashes := append(append([]string{}, hashes[:2]...), hashes[3:]...)

	err := chain.Verify(spliced, splicedHashes)
	if !errors.Is(err, chain.ErrOutOfOrder) {
		t.Errorf("a spliced chain verified: %v", err)
	}
}

// Reordering two events must not verify, even though every individual hash
// is one this package produced.
func TestReorderingIsDetected(t *testing.T) {
	events, hashes := build(t, 5)

	events[1], events[2] = events[2], events[1]

	if err := chain.Verify(events, hashes); err == nil {
		t.Error("a reordered chain verified")
	}
}

// The detail map is hashed in sorted order, so Go's randomised map iteration
// cannot make the same event hash differently on two runs.
func TestTheDetailOrderDoesNotChangeTheHash(t *testing.T) {
	at := time.Date(2026, 9, 20, 3, 0, 0, 0, time.UTC)

	first := chain.Event{
		VoucherID: "v", Seq: 1, Type: chain.TypeMinted, OccurredAt: at,
		Detail: map[string]string{"a": "1", "b": "2", "c": "3"},
	}
	second := chain.Event{
		VoucherID: "v", Seq: 1, Type: chain.TypeMinted, OccurredAt: at,
		Detail: map[string]string{"c": "3", "b": "2", "a": "1"},
	}

	for attempt := 0; attempt < 50; attempt++ {
		left, err := chain.Hash(chain.GenesisHash, first)
		if err != nil {
			t.Fatalf("Hash: %v", err)
		}
		right, err := chain.Hash(chain.GenesisHash, second)
		if err != nil {
			t.Fatalf("Hash: %v", err)
		}
		if left != right {
			t.Fatalf("two identical events hashed differently: %s vs %s", left[:12], right[:12])
		}
	}
}

// Length prefixes, not separators. Without them {"a": "b=c"} and
// {"a=b": "c"} hash the same, and a forged detail map is indistinguishable
// from an honest one.
func TestAmbiguousDetailPairsHashDifferently(t *testing.T) {
	at := time.Date(2026, 9, 20, 3, 0, 0, 0, time.UTC)

	left, err := chain.Hash(chain.GenesisHash, chain.Event{
		VoucherID: "v", Seq: 1, Type: chain.TypeMinted, OccurredAt: at,
		Detail: map[string]string{"a": "b=c"},
	})
	if err != nil {
		t.Fatalf("Hash: %v", err)
	}
	right, err := chain.Hash(chain.GenesisHash, chain.Event{
		VoucherID: "v", Seq: 1, Type: chain.TypeMinted, OccurredAt: at,
		Detail: map[string]string{"a=b": "c"},
	})
	if err != nil {
		t.Fatalf("Hash: %v", err)
	}

	if left == right {
		t.Error("two different detail maps produced the same hash")
	}
}

func TestAnUnknownEventTypeIsRefused(t *testing.T) {
	_, err := chain.Hash(chain.GenesisHash, chain.Event{
		VoucherID: "v", Seq: 1, Type: "something_someone_invented",
		OccurredAt: time.Now(),
	})
	if !errors.Is(err, chain.ErrUnknownType) {
		t.Errorf("an invented event type was hashed: %v", err)
	}
}

func contains(haystack, needle string) bool {
	for index := 0; index+len(needle) <= len(haystack); index++ {
		if haystack[index:index+len(needle)] == needle {
			return true
		}
	}
	return false
}
