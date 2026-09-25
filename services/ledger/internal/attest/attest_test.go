package attest

import (
	"errors"
	"testing"
	"time"
)

var secret = []byte("test-only-reward-attestation-secret-32")

func completion() Completion {
	return Completion{SessionID: "s1", UserID: "u1", CampaignID: "c1", TermsVersion: 2,
		CompletedAt: time.Date(2026, 9, 26, 10, 0, 0, 0, time.UTC), Asked: 3, Correct: 2}
}

// EW-12: every field the ledger pays on is signed, so none can be changed.
func TestEveryFieldIsSigned(t *testing.T) {
	signature := Sign(secret, completion())
	if err := Verify(secret, completion(), signature); err != nil {
		t.Fatalf("the genuine attestation: %v", err)
	}
	for name, change := range map[string]func(*Completion){
		"session":  func(c *Completion) { c.SessionID = "s2" },
		"user":     func(c *Completion) { c.UserID = "u2" },
		"campaign": func(c *Completion) { c.CampaignID = "c2" },
		"terms":    func(c *Completion) { c.TermsVersion = 3 },
		"time":     func(c *Completion) { c.CompletedAt = c.CompletedAt.Add(time.Second) },
		"asked":    func(c *Completion) { c.Asked = 4 },
		"correct":  func(c *Completion) { c.Correct = 3 },
	} {
		changed := completion()
		change(&changed)
		if err := Verify(secret, changed, signature); !errors.Is(err, ErrInvalid) {
			t.Errorf("a changed %s verified: %v", name, err)
		}
	}
	if err := Verify([]byte("another-secret-that-is-32-bytes-long"), completion(), signature); !errors.Is(err, ErrInvalid) {
		t.Errorf("another secret verified: %v", err)
	}
}

func TestAMalformedAttestationIsRefused(t *testing.T) {
	for name, change := range map[string]func(*Completion){
		"more correct than asked": func(c *Completion) { c.Correct = 4 },
		"no session":              func(c *Completion) { c.SessionID = "" },
		"terms version 0":         func(c *Completion) { c.TermsVersion = 0 },
		"no completion time":      func(c *Completion) { c.CompletedAt = time.Time{} },
	} {
		changed := completion()
		change(&changed)
		if err := Verify(secret, changed, Sign(secret, changed)); !errors.Is(err, ErrShape) {
			t.Errorf("%s: %v", name, err)
		}
	}
}

// The same vector apps/api's reward-attestation.test.ts asserts, so the two
// canonical strings cannot drift apart.
func TestTheSharedVector(t *testing.T) {
	if got := Sign(secret, completion()); got != "6a7e21138773bb39109cdfb82c83d629c9a7bc14c8dfdd652e26bda936b9903a" {
		t.Fatalf("Sign = %s", got)
	}
}
