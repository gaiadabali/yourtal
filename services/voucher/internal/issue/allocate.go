package issue

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/voucher/internal/chain"
	"github.com/yourtal/services/voucher/internal/keyring"
	"github.com/yourtal/services/voucher/internal/lifecycle"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// What happens to a voucher AFTER it is minted: revealing its code to its
// owner, and the two steps that move it out of inventory and into a wallet.
//
// Split from issue.go to stay under docs/15 rule 6's 300 lines.

// Reveal decrypts one voucher's code, for its owner.
//
// The single function in this package that puts a code back in memory. The
// caller is responsible for having established that the requester owns the
// voucher; this package will not guess at that, because an authorisation
// decision made in the layer that holds the plaintext is one nobody reviews.
func (m *Minter) Reveal(ctx context.Context, voucherID uuid.UUID) (string, error) {
	custody, err := sqlcgen.New(m.pool).GetCodeCustody(ctx, pgUUID(voucherID))
	if errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("%w: custody for %s", ErrNotFound, voucherID)
	}
	if err != nil {
		return "", fmt.Errorf("reading custody: %w", err)
	}

	plaintext, err := m.keys.Open(keyring.PurposeVoucherCode, keyring.Sealed{
		WrappedDataKey: custody.WrappedDataKey,
		Nonce:          custody.Nonce,
		Ciphertext:     custody.Ciphertext,
		Purpose:        keyring.Purpose(custody.KeyPurpose),
		Version:        int(custody.KeyVersion),
	})
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

// Allocate hands a minted voucher to a user: the step the redemption saga
// takes after debiting points.
func (m *Minter) Allocate(ctx context.Context, voucherID, owner uuid.UUID) error {
	return m.transition(ctx, voucherID, lifecycle.Allocated, "", &owner, chain.TypeAllocated)
}

// Activate puts an allocated voucher in the wallet.
func (m *Minter) Activate(ctx context.Context, voucherID uuid.UUID) error {
	return m.transition(ctx, voucherID, lifecycle.Active, "", nil, chain.TypeActivated)
}
