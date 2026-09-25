package issue

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/yourtal/services/voucher/internal/chain"
	"github.com/yourtal/services/voucher/internal/lifecycle"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// 4.5.a: `reserve` IS the stock reservation. Stock is the count of
// unallocated (`minted`) vouchers in approved batches for a listing, and
// reserving one is a state move (Minted -> Allocated) under
// `FOR UPDATE SKIP LOCKED`, not a counter.
const ReservationTTL = 15 * time.Minute

// ErrOutOfStock — no unallocated voucher exists for this listing.
var ErrOutOfStock = errors.New("issue: no unallocated voucher for this listing")

// Reservation is what the saga sees: enough to activate or release it later
// by saga id alone.
type Reservation struct {
	VoucherID uuid.UUID
	ListingID uuid.UUID
	SagaID    string
	State     lifecycle.State
}

// Reserve claims one minted voucher for a listing, idempotently per saga: a
// retried call for a saga that already holds a reservation returns it
// rather than claiming a second voucher.
func (m *Minter) Reserve(ctx context.Context, listingID uuid.UUID, sagaID string) (Reservation, error) {
	var result Reservation

	err := pgx.BeginTxFunc(ctx, m.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)

		if existing, err := queries.GetVoucherBySaga(ctx, &sagaID); err == nil {
			result = Reservation{
				VoucherID: asUUID(existing.ID), ListingID: asUUID(existing.ListingID),
				SagaID: sagaID, State: lifecycle.Allocated,
			}
			return nil
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("checking for an existing reservation: %w", err)
		}

		candidate, err := queries.SelectMintedForListing(ctx, pgUUID(listingID))
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrOutOfStock, listingID)
		}
		if err != nil {
			return fmt.Errorf("selecting a voucher to reserve: %w", err)
		}

		until := m.now().Add(ReservationTTL)
		moved, err := Move(ctx, queries, MoveRequest{
			VoucherID:      asUUID(candidate.ID),
			From:           lifecycle.Minted,
			To:             lifecycle.Allocated,
			RemainingMinor: candidate.RemainingValueMinor,
			Version:        candidate.Version,
			SagaID:         &sagaID,
			ReservedUntil:  &until,
			EventType:      chain.TypeAllocated,
			Detail:         chain.Detail("saga_id", sagaID),
			At:             m.now(),
		})
		if err != nil {
			return err
		}

		result = Reservation{
			VoucherID: asUUID(moved.ID), ListingID: listingID, SagaID: sagaID, State: lifecycle.Allocated,
		}
		return nil
	})
	if err != nil {
		return Reservation{}, err
	}
	return result, nil
}

// bySaga resolves the one live (Allocated) reservation a saga holds.
func bySaga(ctx context.Context, queries *sqlcgen.Queries, sagaID string) (sqlcgen.GetVoucherBySagaRow, error) {
	row, err := queries.GetVoucherBySaga(ctx, &sagaID)
	if errors.Is(err, pgx.ErrNoRows) {
		return row, fmt.Errorf("%w: no live reservation for saga %s", ErrNotFound, sagaID)
	}
	if err != nil {
		return row, fmt.Errorf("reading the reservation for saga %s: %w", sagaID, err)
	}
	return row, nil
}

// ReleaseReservation returns a reservation to inventory: Allocated -> Minted.
//
// Callable at any time; it does NOT itself check whether a burn exists for
// this saga (services/voucher has no reason to call the ledger). The burn
// saga (4.7, apps/api) calls `getBurn` first and only releases when the
// ledger reports none — see TASKS.md 4.5.a.
func (m *Minter) ReleaseReservation(ctx context.Context, sagaID string) (Reservation, error) {
	var result Reservation

	err := pgx.BeginTxFunc(ctx, m.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)

		voucher, err := bySaga(ctx, queries, sagaID)
		if err != nil {
			return err
		}

		moved, err := Move(ctx, queries, MoveRequest{
			VoucherID:      asUUID(voucher.ID),
			From:           lifecycle.Allocated,
			To:             lifecycle.Minted,
			RemainingMinor: voucher.RemainingValueMinor,
			Version:        voucher.Version,
			EventType:      chain.TypeReleased,
			Detail:         chain.Detail("saga_id", sagaID),
			At:             m.now(),
		})
		if err != nil {
			return err
		}

		result = Reservation{VoucherID: asUUID(moved.ID), ListingID: asUUID(voucher.ListingID), SagaID: sagaID, State: lifecycle.Minted}
		return nil
	})
	if err != nil {
		return Reservation{}, err
	}
	return result, nil
}

// ActivateReservation hands a reservation to its owner: Allocated -> Active.
// Idempotent: activating a saga that is already active (this saga's own
// voucher, already the caller's own owner) returns the same voucher rather
// than refusing a retry.
func (m *Minter) ActivateReservation(ctx context.Context, sagaID string, owner uuid.UUID) (Reservation, error) {
	var result Reservation

	err := pgx.BeginTxFunc(ctx, m.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)

		voucher, err := bySaga(ctx, queries, sagaID)
		if errors.Is(err, ErrNotFound) {
			// Not (any longer) Allocated under this saga. If it is already
			// Active and owned by the caller, this is a retried activate
			// after a prior call's response was lost — return it rather
			// than refusing a call that already succeeded.
			active, activeErr := queries.GetVoucherBySagaAnyState(ctx, &sagaID)
			if activeErr == nil && lifecycle.State(active.State) == lifecycle.Active &&
				active.OwnerID.Valid && asUUID(active.OwnerID) == owner {
				result = Reservation{VoucherID: asUUID(active.ID), ListingID: asUUID(active.ListingID), SagaID: sagaID, State: lifecycle.Active}
				return nil
			}
			return err
		}
		if err != nil {
			return err
		}

		moved, err := Move(ctx, queries, MoveRequest{
			VoucherID:      asUUID(voucher.ID),
			From:           lifecycle.Allocated,
			To:             lifecycle.Active,
			RemainingMinor: voucher.RemainingValueMinor,
			Version:        voucher.Version,
			Owner:          &owner,
			EventType:      chain.TypeActivated,
			Detail:         chain.Detail("saga_id", sagaID),
			At:             m.now(),
		})
		if err != nil {
			return err
		}

		result = Reservation{VoucherID: asUUID(moved.ID), ListingID: asUUID(voucher.ListingID), SagaID: sagaID, State: lifecycle.Active}
		return nil
	})
	if err != nil {
		return Reservation{}, err
	}
	return result, nil
}
