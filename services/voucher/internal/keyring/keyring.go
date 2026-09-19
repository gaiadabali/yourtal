// Package keyring is envelope encryption for the things that must never be
// readable from a database dump: voucher codes, merchant HMAC secrets, PII.
//
// YT-0533 — "secrets and keys without a KMS". docs/15's seventh rule says
// voucher codes are KMS-encrypted from the first code ever minted, and the
// Helios decision means there is no KMS to encrypt them with. That is not a
// reason to store them in plaintext until one arrives; it is a reason to put
// the KMS-shaped seam in now and give it a weaker implementation behind it.
//
// # The separation is the part that has to survive
//
// YT-0533's first criterion is "separate keys for voucher codes, PII and
// signing — THE SEPARATION IS THE POINT, and it survives the move to a real
// KMS". So a Purpose is not a label on one key, it selects a different key,
// and the purpose is bound into the ciphertext as additional authenticated
// data. A ciphertext sealed for voucher codes cannot be opened as a merchant
// secret even by a caller that asks for exactly that: the AEAD refuses.
//
// Without that binding, "separate keys" is a naming convention, and the
// blast radius of one compromised key is everything the process can decrypt.
//
// # Why envelope encryption rather than encrypting with the master directly
//
// Each record gets its own data key, encrypted under the master. Three
// consequences, all of which are why every KMS works this way:
//
//   - Rotating the master re-wraps data keys — a few hundred bytes per
//     record — instead of re-encrypting every voucher in the platform.
//   - The master key encrypts only 32-byte data keys, so it never
//     accumulates enough ciphertext under one key for that to matter.
//   - YT-0026's eventual move to Cloud KMS becomes a change of WHO
//     unwraps the data key. The records do not move, and neither does this
//     package's interface.
//
// # ⚠️ What this is not
//
// YT-0533's last criterion, recorded here because the code is where somebody
// will be standing when it matters: single-host key custody is weaker than a
// KMS and must not be carried into production. The master keys are files on
// the same machine as the database. An attacker with host access has both.
// A real KMS keeps the unwrap operation somewhere the attacker has not
// reached, and that is the property this cannot have.
package keyring

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"
)

// Purpose selects a key. Distinct purposes are distinct keys, always.
type Purpose string

const (
	// PurposeVoucherCode protects the codes themselves.
	PurposeVoucherCode Purpose = "voucher_code"
	// PurposeMerchantHMAC protects the shared secrets merchants sign with.
	PurposeMerchantHMAC Purpose = "merchant_hmac"
	// PurposePII protects personal data at rest.
	PurposePII Purpose = "pii"
	// PurposeSigning protects private signing keys — the Ed25519 key behind
	// the in-store QR (YT-0143), for one.
	PurposeSigning Purpose = "signing"
)

// Purposes is the closed set, so a caller cannot invent one that silently
// has no key behind it.
var Purposes = []Purpose{PurposeVoucherCode, PurposeMerchantHMAC, PurposePII, PurposeSigning}

const (
	masterKeyLength = 32 // AES-256
	dataKeyLength   = 32
)

var (
	// ErrNoKeyForPurpose — nothing is configured for this purpose. Returned
	// rather than falling back to another purpose's key, which would undo
	// the separation this package exists for.
	ErrNoKeyForPurpose = errors.New("keyring: no key is configured for this purpose")
	// ErrUnknownVersion — the ciphertext names a key version this process
	// does not hold. Usually a rotation that retired a key still in use.
	ErrUnknownVersion = errors.New("keyring: no key of that version")
	// ErrWrongPurpose — the ciphertext was sealed for a different purpose.
	// This is the separation biting, and it is a security event rather than
	// a bug: something asked to decrypt material it should not hold.
	ErrWrongPurpose = errors.New("keyring: this ciphertext was sealed for another purpose")
	// ErrBadKeyLength — a master key file that is not 32 bytes.
	ErrBadKeyLength = errors.New("keyring: a master key must be 32 bytes")
)

// Sealed is one encrypted value, in the shape the columns store it.
type Sealed struct {
	// WrappedDataKey is the per-record data key, encrypted under the master
	// key: nonce ‖ ciphertext, since the wrap has its own nonce.
	WrappedDataKey []byte
	// Nonce is the data ciphertext's nonce.
	Nonce []byte
	// Ciphertext is the value itself, under the data key.
	Ciphertext []byte
	// Purpose and Version say which master key unwraps this. Both are bound
	// into the AEAD's additional data, so neither can be edited in the
	// database to point somewhere more convenient.
	Purpose Purpose
	Version int
}

// Keyring holds the master keys this process can use.
type Keyring struct {
	// keys[purpose][version]. A purpose with several versions is a rotation
	// in progress: the highest seals, and every version still present can
	// open.
	keys map[Purpose]map[int][]byte
}

// New builds a keyring from already-loaded master key material.
//
// Takes bytes rather than reading files itself, so the decision of WHERE
// keys live stays in one place (see FromDirectory) and tests do not need a
// filesystem to exercise the cryptography.
func New(keys map[Purpose]map[int][]byte) (*Keyring, error) {
	held := make(map[Purpose]map[int][]byte, len(keys))

	for purpose, versions := range keys {
		held[purpose] = make(map[int][]byte, len(versions))
		for version, key := range versions {
			if len(key) != masterKeyLength {
				return nil, fmt.Errorf("%w: %s v%d is %d bytes",
					ErrBadKeyLength, purpose, version, len(key))
			}
			if version < 1 {
				return nil, fmt.Errorf("keyring: %s has version %d; versions start at 1",
					purpose, version)
			}
			held[purpose][version] = key
		}
	}

	return &Keyring{keys: held}, nil
}

// Seal encrypts a value under the newest key for a purpose.
func (k *Keyring) Seal(purpose Purpose, plaintext []byte) (Sealed, error) {
	version, master, err := k.newest(purpose)
	if err != nil {
		return Sealed{}, err
	}

	dataKey := make([]byte, dataKeyLength)
	if _, err := rand.Read(dataKey); err != nil {
		return Sealed{}, fmt.Errorf("keyring: generating a data key: %w", err)
	}

	dataNonce, ciphertext, err := seal(dataKey, plaintext, additionalData(purpose, version))
	if err != nil {
		return Sealed{}, fmt.Errorf("keyring: encrypting the value: %w", err)
	}

	wrapNonce, wrapped, err := seal(master, dataKey, additionalData(purpose, version))
	if err != nil {
		return Sealed{}, fmt.Errorf("keyring: wrapping the data key: %w", err)
	}

	return Sealed{
		WrappedDataKey: append(wrapNonce, wrapped...),
		Nonce:          dataNonce,
		Ciphertext:     ciphertext,
		Purpose:        purpose,
		Version:        version,
	}, nil
}

// Open reverses Seal.
//
// `want` is the purpose the CALLER believes it is handling. Passing it means
// a bug that reads a merchant secret row into voucher-code code fails here
// rather than succeeding quietly — the check is cheap and the alternative is
// discovered by an auditor.
func (k *Keyring) Open(want Purpose, sealed Sealed) ([]byte, error) {
	if sealed.Purpose != want {
		return nil, fmt.Errorf("%w: sealed for %s, opened as %s",
			ErrWrongPurpose, sealed.Purpose, want)
	}

	versions, held := k.keys[sealed.Purpose]
	if !held {
		return nil, fmt.Errorf("%w: %s", ErrNoKeyForPurpose, sealed.Purpose)
	}
	master, held := versions[sealed.Version]
	if !held {
		return nil, fmt.Errorf("%w: %s v%d", ErrUnknownVersion, sealed.Purpose, sealed.Version)
	}

	block, err := aes.NewCipher(master)
	if err != nil {
		return nil, fmt.Errorf("keyring: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("keyring: %w", err)
	}
	if len(sealed.WrappedDataKey) < aead.NonceSize() {
		return nil, errors.New("keyring: the wrapped data key is truncated")
	}

	extra := additionalData(sealed.Purpose, sealed.Version)
	dataKey, err := aead.Open(nil,
		sealed.WrappedDataKey[:aead.NonceSize()],
		sealed.WrappedDataKey[aead.NonceSize():], extra)
	if err != nil {
		return nil, fmt.Errorf("keyring: unwrapping the data key: %w", err)
	}

	return open(dataKey, sealed.Nonce, sealed.Ciphertext, extra)
}

// newest is the key a Seal uses: the highest version present for a purpose.
func (k *Keyring) newest(purpose Purpose) (int, []byte, error) {
	versions, held := k.keys[purpose]
	if !held || len(versions) == 0 {
		return 0, nil, fmt.Errorf("%w: %s", ErrNoKeyForPurpose, purpose)
	}

	newest := 0
	for version := range versions {
		if version > newest {
			newest = version
		}
	}
	return newest, versions[newest], nil
}

// additionalData binds a ciphertext to its purpose and version.
//
// This is what makes the separation structural rather than nominal: editing
// `key_purpose` in the database to point a voucher-code ciphertext at the
// PII key does not yield a decryptable record, it yields an authentication
// failure. Same for `key_version`, which stops a rotation being rolled back
// row by row.
func additionalData(purpose Purpose, version int) []byte {
	return []byte(fmt.Sprintf("yourtal/keyring/%s/v%d", purpose, version))
}

func seal(key, plaintext, extra []byte) (nonce, ciphertext []byte, err error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, nil, err
	}

	nonce = make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, nil, err
	}
	return nonce, aead.Seal(nil, nonce, plaintext, extra), nil
}

func open(key, nonce, ciphertext, extra []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("keyring: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("keyring: %w", err)
	}
	plaintext, err := aead.Open(nil, nonce, ciphertext, extra)
	if err != nil {
		return nil, fmt.Errorf("keyring: decrypting: %w", err)
	}
	return plaintext, nil
}
