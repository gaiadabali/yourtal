package issue

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/voucher/internal/chain"
	"github.com/yourtal/services/voucher/internal/lifecycle"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// ErrStaleVersion is optimistic concurrency biting: somebody else moved this
// voucher between the caller's read and its write.
//
// Distinct from an illegal transition on purpose. "You cannot do that" and
// "somebody else just did something, look again" lead to different actions —
// the first is a bug or an attack, the second is a retry.
var ErrStaleVersion = errors.New("issue: the voucher changed under this write; re-read and retry")

// listingTerms is the part of a listing a voucher denormalises at issuance.
//
// Copied onto the voucher rather than joined at read time, because a voucher
// must stay honourable offline (docs/17 §3's wallet QR) and because a later
// edit to the listing must not change the terms of a voucher already issued.
type listingTerms struct {
	merchantID   pgtype.UUID
	merchantName string
	title        string
	locationID   pgtype.UUID
}

// listingFor reads the terms and picks the branch this batch's vouchers are
// honoured at.
//
// The FIRST branch the listing offers, deterministically. A voucher's branch
// is constrained by a composite foreign key to one its own listing actually
// serves, so this cannot be an arbitrary location — and choosing at random
// would make a batch unreproducible for no benefit. Which branch a given
// voucher should name when a merchant has several is a product question
// (nearest to the user? the one they redeemed at?) that nobody has answered;
// picking the first is the honest placeholder rather than a decision smuggled
// in here.
func (m *Minter) listingFor(
	ctx context.Context, queries *sqlcgen.Queries, batch sqlcgen.VoucherBatch,
) (listingTerms, error) {
	row, err := queries.GetListingTerms(ctx, batch.ListingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return listingTerms{}, fmt.Errorf("%w: listing %v has no branches, so no voucher can be issued",
			ErrNotFound, batch.ListingID)
	}
	if err != nil {
		return listingTerms{}, fmt.Errorf("reading listing terms: %w", err)
	}

	return listingTerms{
		merchantID:   row.MerchantID,
		merchantName: row.MerchantName,
		title:        row.Title,
		locationID:   row.LocationID,
	}, nil
}

// transition moves a voucher and appends the matching event, atomically.
//
// The two belong in one transaction because the event log is the audit
// trail: a state change with no event is a change nobody can explain
// afterwards, and an event with no state change is a record of something
// that did not happen. Either alone is worse than neither.
func (m *Minter) transition(
	ctx context.Context, voucherID uuid.UUID, to lifecycle.State,
	reason lifecycle.VoidReason, owner *uuid.UUID, eventType string,
) error {
	return pgx.BeginTxFunc(ctx, m.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)

		current, err := queries.GetVoucher(ctx, pgUUID(voucherID))
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: voucher %s", ErrNotFound, voucherID)
		}
		if err != nil {
			return fmt.Errorf("reading voucher %s: %w", voucherID, err)
		}

		if err := lifecycle.Check(lifecycle.State(current.State), to, reason); err != nil {
			return err
		}

		_, err = Move(ctx, queries, MoveRequest{
			VoucherID:      voucherID,
			From:           lifecycle.State(current.State),
			To:             to,
			Reason:         reason,
			Owner:          owner,
			RemainingMinor: current.RemainingValueMinor,
			Version:        current.Version,
			EventType:      eventType,
			Detail:         chain.Detail("from", current.State, "to", string(to)),
			At:             m.now(),
		})
		return err
	})
}

// MoveRequest is one state transition plus the event that records it.
type MoveRequest struct {
	VoucherID uuid.UUID
	// From is the state the caller read at Version. Move checks From -> To
	// against the lifecycle table, and the database checks it again (D3).
	From lifecycle.State
	To   lifecycle.State
	// ValueAdjustment marks the one same-state write: a refund restoring
	// value to an active voucher.
	ValueAdjustment bool
	Reason          lifecycle.VoidReason
	Owner           *uuid.UUID
	RemainingMinor  int64
	Version         int32
	EventType       string
	Detail          map[string]string
	At              time.Time
}

// Move applies a transition inside a caller's transaction.
//
// Exported because the redemption path needs to move a voucher in the same
// transaction as an authorization or a capture — splitting those across two
// transactions would leave a window where a voucher is held with no hold, or
// captured with value it still shows as available.
func Move(
	ctx context.Context, queries *sqlcgen.Queries, req MoveRequest,
) (sqlcgen.TransitionVoucherRow, error) {
	if req.ValueAdjustment {
		if req.From != lifecycle.Active || req.To != lifecycle.Active {
			return sqlcgen.TransitionVoucherRow{}, fmt.Errorf("%w: only an active voucher takes a value adjustment, not %s",
				lifecycle.ErrIllegalTransition, req.From)
		}
	} else if err := lifecycle.Check(req.From, req.To, req.Reason); err != nil {
		return sqlcgen.TransitionVoucherRow{}, err
	}

	var voidReason *string
	if req.Reason != "" {
		value := string(req.Reason)
		voidReason = &value
	}

	// Invalid, not nil: the query COALESCEs a NULL owner to the existing
	// one, so "do not change the owner" and "set this owner" are the same
	// parameter in two states.
	owner := noUUID()
	if req.Owner != nil {
		owner = pgUUID(*req.Owner)
	}

	moved, err := queries.TransitionVoucher(ctx, sqlcgen.TransitionVoucherParams{
		ID:                  pgUUID(req.VoucherID),
		State:               string(req.To),
		VoidReason:          voidReason,
		Version:             req.Version,
		RemainingValueMinor: req.RemainingMinor,
		OwnerID:             owner,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlcgen.TransitionVoucherRow{}, fmt.Errorf("%w: voucher %s at version %d",
			ErrStaleVersion, req.VoucherID, req.Version)
	}
	if err != nil {
		return sqlcgen.TransitionVoucherRow{}, fmt.Errorf("moving voucher: %w", err)
	}

	head, seq, err := chainHead(ctx, queries, req.VoucherID)
	if err != nil {
		return sqlcgen.TransitionVoucherRow{}, err
	}

	if err := appendEvent(ctx, queries, req.At, req.VoucherID, head, seq+1,
		req.EventType, req.Detail); err != nil {
		return sqlcgen.TransitionVoucherRow{}, err
	}

	return moved, nil
}

// chainHead is the last event's hash and sequence number, or the genesis.
func chainHead(
	ctx context.Context, queries *sqlcgen.Queries, voucherID uuid.UUID,
) (string, int32, error) {
	latest, err := queries.LatestEvent(ctx, pgUUID(voucherID))
	if errors.Is(err, pgx.ErrNoRows) {
		return chain.GenesisHash, 0, nil
	}
	if err != nil {
		return "", 0, fmt.Errorf("reading the event chain head: %w", err)
	}
	return latest.Hash, latest.Seq, nil
}

// appendEvent computes the hash and writes the row.
//
// The (voucher_id, seq) primary key is what serialises the chain: two
// writers racing to append event 4 cannot both succeed, so a fork is
// unrepresentable rather than merely unlikely. A unique violation here
// therefore means a concurrent writer won, and the caller's transaction
// should fail rather than retry blindly — the state change it accompanies
// was computed from a version that is no longer current.
func appendEvent(
	ctx context.Context, queries *sqlcgen.Queries, at time.Time,
	voucherID uuid.UUID, prevHash string, seq int32,
	eventType string, detail map[string]string,
) error {
	// Truncated to the precision the column keeps, BEFORE hashing, so the
	// hash commits to the instant that will actually be stored. See the note
	// on chain.Instant.
	occurred := chain.Instant(at)

	event := chain.Event{
		VoucherID:  voucherID.String(),
		Seq:        int(seq),
		Type:       eventType,
		Detail:     detail,
		OccurredAt: occurred,
	}

	hash, err := chain.Hash(prevHash, event)
	if err != nil {
		return err
	}

	encoded, err := json.Marshal(detail)
	if err != nil {
		return fmt.Errorf("encoding event detail: %w", err)
	}

	if err := queries.InsertEvent(ctx, sqlcgen.InsertEventParams{
		VoucherID:  pgUUID(voucherID),
		Seq:        seq,
		EventType:  eventType,
		Detail:     encoded,
		PrevHash:   prevHash,
		Hash:       hash,
		OccurredAt: pgTime(occurred),
	}); err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("%w: another writer appended event %d for %s",
				ErrStaleVersion, seq, voucherID)
		}
		return fmt.Errorf("appending event: %w", err)
	}
	return nil
}

// VerifyChain replays a voucher's history and checks every hash.
//
// This is what makes the log worth more than an audit table: a row edited in
// place produces a hash that no longer matches its own stored value, and
// every later row inherits the break.
func (m *Minter) VerifyChain(ctx context.Context, voucherID uuid.UUID) error {
	rows, err := sqlcgen.New(m.pool).ListEvents(ctx, pgUUID(voucherID))
	if err != nil {
		return fmt.Errorf("reading the event chain: %w", err)
	}

	events := make([]chain.Event, 0, len(rows))
	stored := make([]string, 0, len(rows))

	for _, row := range rows {
		var detail map[string]string
		if err := json.Unmarshal(row.Detail, &detail); err != nil {
			return fmt.Errorf("decoding event %d of %s: %w", row.Seq, voucherID, err)
		}
		events = append(events, chain.Event{
			VoucherID:  voucherID.String(),
			Seq:        int(row.Seq),
			Type:       row.EventType,
			Detail:     detail,
			OccurredAt: row.OccurredAt.Time,
		})
		stored = append(stored, row.Hash)
	}

	if err := chain.Verify(events, stored); err != nil {
		return err
	}

	// The chain cannot see its own latest events deleted, nor an edit to the
	// voucher row it describes (D6). Every write bumps the version and appends
	// one event, so version == max(seq); and the value the events replay to
	// must be the value the row holds.
	voucher, err := sqlcgen.New(m.pool).GetVoucher(ctx, pgUUID(voucherID))
	if err != nil {
		return fmt.Errorf("reading voucher %s: %w", voucherID, err)
	}
	if int(voucher.Version) != len(events) {
		return fmt.Errorf("%w: voucher %s is at version %d but its chain has %d events",
			chain.ErrBroken, voucherID, voucher.Version, len(events))
	}
	replayed, err := replayRemaining(events)
	if err != nil {
		return err
	}
	if replayed != voucher.RemainingValueMinor {
		return fmt.Errorf("%w: voucher %s holds %d but its history replays to %d",
			chain.ErrBroken, voucherID, voucher.RemainingValueMinor, replayed)
	}
	return nil
}

// replayRemaining is the value a voucher's hash-protected history leaves it
// with: the face value at mint, then each capture's and refund's recorded
// remainder.
func replayRemaining(events []chain.Event) (int64, error) {
	var remaining int64
	for _, event := range events {
		field := ""
		switch event.Type {
		case chain.TypeMinted:
			field = "face_value_minor"
		case chain.TypeCaptured, chain.TypeRefunded:
			field = "remaining_minor"
		default:
			continue
		}
		value, err := strconv.ParseInt(event.Detail[field], 10, 64)
		if err != nil {
			return 0, fmt.Errorf("%w: event %d has no readable %s", chain.ErrBroken, event.Seq, field)
		}
		remaining = value
	}
	return remaining, nil
}

const uniqueViolation = "23505"

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == uniqueViolation
}
