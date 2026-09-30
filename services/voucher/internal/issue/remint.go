package issue

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/chain"
	"github.com/yourtal/services/voucher/internal/code"
	"github.com/yourtal/services/voucher/internal/keyring"
	"github.com/yourtal/services/voucher/internal/lifecycle"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// ErrNotUnused — only an active voucher with its whole value left and time
// on its clock can change hands (a gift or an auction listing).
var ErrNotUnused = errors.New("issue: only an unused, unexpired, active voucher can change hands")

// checkUnused is the shared precondition for void-and-remint.
func checkUnused(source sqlcgen.LockOwnedVoucherRow, now time.Time) error {
	if lifecycle.State(source.State) != lifecycle.Active ||
		source.RemainingValueMinor != source.FaceValueMinor ||
		!source.ExpiresAt.Time.After(now) {
		return fmt.Errorf("%w: voucher %s is %s with %d of %d left",
			ErrNotUnused, asUUID(source.ID), source.State, source.RemainingValueMinor, source.FaceValueMinor)
	}
	return nil
}

// remint is docs/09 §7's void-and-remint: the source's code dies now, and a
// replacement with the same terms and a new code waits in Allocated, owned
// by nobody, under sagaID until the caller hands it on. `link` names what
// moved it (e.g. "gift_id", id) on both vouchers' chains.
func (m *Minter) remint(
	ctx context.Context, queries *sqlcgen.Queries,
	source sqlcgen.LockOwnedVoucherRow, sagaID string, link ...string,
) (uuid.UUID, error) {
	now := m.now()
	sourceID := asUUID(source.ID)
	newID := uuid.New()

	if _, err := Move(ctx, queries, MoveRequest{
		VoucherID: sourceID, From: lifecycle.Active, To: lifecycle.Voided,
		Reason: lifecycle.ReasonTransfer, RemainingMinor: source.RemainingValueMinor,
		Version: source.Version, EventType: chain.TypeTransferred,
		Detail: chain.Detail(append([]string{"to_voucher", newID.String()}, link...)...),
		At:     now,
	}); err != nil {
		return uuid.Nil, err
	}

	plaintext, err := code.Mint()
	if err != nil {
		return uuid.Nil, fmt.Errorf("minting a code: %w", err)
	}
	digest := sha256.Sum256([]byte(plaintext))
	sealed, err := m.keys.Seal(keyring.PurposeVoucherCode, []byte(plaintext))
	if err != nil {
		return uuid.Nil, fmt.Errorf("sealing a code: %w", err)
	}

	if err := queries.InsertRemintedVoucher(ctx, sqlcgen.InsertRemintedVoucherParams{
		ID: pgUUID(newID), ListingID: source.ListingID, MerchantID: source.MerchantID,
		MerchantName: source.MerchantName, Title: source.Title, FaceValueMinor: source.FaceValueMinor,
		PartialRedemptionPolicy: source.PartialRedemptionPolicy, MinimumSpendMinor: source.MinimumSpendMinor,
		Transferable: source.Transferable, ExpiresAt: source.ExpiresAt, LocationID: source.LocationID,
		Currency: source.Currency, Region: source.Region,
	}); err != nil {
		return uuid.Nil, fmt.Errorf("inserting the reminted voucher: %w", err)
	}
	if err := queries.InsertCodeCustody(ctx, sqlcgen.InsertCodeCustodyParams{
		VoucherID: pgUUID(newID), CodeHash: hex.EncodeToString(digest[:]),
		WrappedDataKey: sealed.WrappedDataKey, Nonce: sealed.Nonce, Ciphertext: sealed.Ciphertext,
		KeyPurpose: string(sealed.Purpose), KeyVersion: int32(sealed.Version),
	}); err != nil {
		if isUniqueViolation(err) {
			return uuid.Nil, fmt.Errorf("%w: %s", ErrCodeCollision, newID)
		}
		return uuid.Nil, fmt.Errorf("storing custody for %s: %w", newID, err)
	}

	if err := appendEvent(ctx, queries, now, newID, chain.GenesisHash, 1, chain.TypeMinted,
		chain.Detail(append([]string{
			"remint_of", sourceID.String(),
			"face_value_minor", chain.Amount(source.FaceValueMinor),
			"policy", source.PartialRedemptionPolicy,
		}, link...)...),
	); err != nil {
		return uuid.Nil, err
	}

	if _, err := Move(ctx, queries, MoveRequest{
		VoucherID: newID, From: lifecycle.Minted, To: lifecycle.Allocated,
		RemainingMinor: source.FaceValueMinor, Version: 1, SagaID: &sagaID,
		EventType: chain.TypeAllocated, Detail: chain.Detail("saga_id", sagaID), At: now,
	}); err != nil {
		return uuid.Nil, err
	}
	return newID, nil
}

// handOver moves a reminted voucher out of Allocated into owner's wallet.
func (m *Minter) handOver(
	ctx context.Context, queries *sqlcgen.Queries, voucherID, owner uuid.UUID, detail ...string,
) error {
	current, err := queries.GetVoucher(ctx, pgUUID(voucherID))
	if err != nil {
		return fmt.Errorf("reading voucher %s: %w", voucherID, err)
	}
	_, err = Move(ctx, queries, MoveRequest{
		VoucherID: voucherID, From: lifecycle.State(current.State), To: lifecycle.Active,
		Owner: &owner, RemainingMinor: current.RemainingValueMinor, Version: current.Version,
		EventType: chain.TypeActivated, Detail: chain.Detail(detail...), At: m.now(),
	})
	return err
}
