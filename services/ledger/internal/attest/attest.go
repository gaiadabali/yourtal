// Package attest verifies apps/api's completion attestation (4.4.c, EW-12):
// the evidence a campaign reward is paid on. apps/api signs it when a watch
// session completes; the ledger pays only a completion it can verify, and
// computes the points from the terms version the attestation names.
package attest

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// MinSecretBytes refuses a secret too short to be a real key.
const MinSecretBytes = 32

var (
	ErrInvalid = errors.New("attest: the completion attestation does not verify")
	ErrShape   = errors.New("attest: the completion attestation is malformed")
)

// Completion is what apps/api attests about one finished reward session.
type Completion struct {
	SessionID    string
	UserID       string
	CampaignID   string
	TermsVersion int
	CompletedAt  time.Time
	Asked        int
	Correct      int
}

// Canonical is the signed string: versioned and newline-joined, so no field
// can smuggle in another. apps/api builds the same string in TypeScript.
func Canonical(c Completion) string {
	return strings.Join([]string{
		"v1", c.SessionID, c.UserID, c.CampaignID, strconv.Itoa(c.TermsVersion),
		c.CompletedAt.UTC().Format(time.RFC3339), strconv.Itoa(c.Asked), strconv.Itoa(c.Correct),
	}, "\n")
}

// Sign is the hex HMAC-SHA256 of Canonical. For tests and Go callers.
func Sign(secret []byte, c Completion) string {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(Canonical(c)))
	return hex.EncodeToString(mac.Sum(nil))
}

// Verify checks the attestation's shape and signature, in constant time.
func Verify(secret []byte, c Completion, signature string) error {
	switch {
	case c.SessionID == "" || c.UserID == "" || c.CampaignID == "", c.TermsVersion < 1,
		c.Asked < 0, c.Correct < 0, c.Correct > c.Asked, c.CompletedAt.IsZero():
		return fmt.Errorf("%w: %+v", ErrShape, c)
	}
	given, err := hex.DecodeString(signature)
	if err != nil || len(given) != sha256.Size {
		return ErrInvalid
	}
	want, _ := hex.DecodeString(Sign(secret, c))
	if !hmac.Equal(given, want) {
		return ErrInvalid
	}
	return nil
}
