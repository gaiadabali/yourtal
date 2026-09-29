package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/lifecycle"
	"github.com/yourtal/services/voucher/internal/qrtoken"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// 4.5's wallet reads and the owner-only operations (reveal, QR). Every one
// of these resolves ownership itself — GetOwnedVoucher's WHERE clause — so
// a caller cannot read or reveal a voucher that is not theirs by supplying
// somebody else's voucher id, the same boundary `requireOwnedAuthorization`
// enforces in the merchant network.

func ownedVoucher(ctx context.Context, pool *pgxpool.Pool, voucherID, ownerID uuid.UUID) (sqlcgen.GetOwnedVoucherRow, error) {
	row, err := sqlcgen.New(pool).GetOwnedVoucher(ctx, sqlcgen.GetOwnedVoucherParams{
		ID: pgUUID(voucherID), OwnerID: pgUUID(ownerID),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return row, errAudienceBlocked
	}
	return row, err
}

type revealBody struct {
	VoucherID string `json:"voucherId"`
	OwnerID   string `json:"ownerId"`
}

func (a *API) reveal(w http.ResponseWriter, r *http.Request) {
	var body revealBody
	if !a.decode(w, r, &body) {
		return
	}
	voucherID, ownerID, ok := parseTwoIDs(w, a, body.VoucherID, body.OwnerID)
	if !ok {
		return
	}

	if _, err := ownedVoucher(r.Context(), a.pool, voucherID, ownerID); err != nil {
		a.fail(w, err)
		return
	}

	code, err := a.minter.Reveal(r.Context(), voucherID)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]string{"voucherId": voucherID.String(), "code": code})
}

type voidVoucherBody struct {
	VoucherID string `json:"voucherId"`
	OwnerID   string `json:"ownerId"`
	Reason    string `json:"reason"`
}

// voidVoucher is 4.7.c / K13 (requested by A): the owner disputes a voucher
// the merchant would not honour, before it was ever captured. Legal only
// from Active (`lifecycle.Transitions[Active]` already includes Voided) —
// Held or Redeemed refuse with `already_granted`, the closest code in the
// closed enum to "a merchant transaction is already in flight or done".
// Already-Voided replays rather than refusing, so a retried call after a
// lost response is safe.
func (a *API) voidVoucher(w http.ResponseWriter, r *http.Request) {
	var body voidVoucherBody
	if !a.decode(w, r, &body) {
		return
	}
	voucherID, ownerID, ok := parseTwoIDs(w, a, body.VoucherID, body.OwnerID)
	if !ok {
		return
	}
	if body.Reason == "" {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "missing_reason", "reason is required")
		return
	}

	voucher, err := ownedVoucher(r.Context(), a.pool, voucherID, ownerID)
	if err != nil {
		a.fail(w, err)
		return
	}

	switch lifecycle.State(voucher.State) {
	case lifecycle.Voided:
		httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]bool{"voided": true})
	case lifecycle.Active:
		// The structural VoidReason is closed (fraud/transfer/refund_reversal
		// /admin); this is a staff/system-mediated dispute resolution, which
		// "admin" is the closest fit for. The caller's free-text `reason`
		// this handler receives is for the caller's own audit trail, not
		// threaded into the chain event today.
		if err := a.minter.Void(r.Context(), voucherID, lifecycle.ReasonAdmin); err != nil {
			a.fail(w, err)
			return
		}
		httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]bool{"voided": true})
	default:
		a.fail(w, fmt.Errorf("%w: voucher %s is %s, not active", errAlreadyCaptured, voucherID, voucher.State))
	}
}

type qrTokenBody struct {
	VoucherID string `json:"voucherId"`
	OwnerID   string `json:"ownerId"`
}

// qrTokenView is wider than the voucher-internal contract's `QrToken`
// (token, voucherId, expiresAt): `tokens` carries all twelve 5-minute-window
// tokens 4.5.b asks for, so a widened client (or the wallet fetching this
// route directly) can cache them for offline display. HttpVoucherClient
// picks `tokens[0]` for the narrower interface — see its own comment.
type qrTokenView struct {
	Token     string          `json:"token"`
	VoucherID string          `json:"voucherId"`
	ExpiresAt string          `json:"expiresAt"`
	Tokens    []qrTokenWindow `json:"tokens"`
}

type qrTokenWindow struct {
	Token     string `json:"token"`
	ExpiresAt string `json:"expiresAt"`
}

func (a *API) qrToken(w http.ResponseWriter, r *http.Request) {
	var body qrTokenBody
	if !a.decode(w, r, &body) {
		return
	}
	voucherID, ownerID, ok := parseTwoIDs(w, a, body.VoucherID, body.OwnerID)
	if !ok {
		return
	}

	if _, err := ownedVoucher(r.Context(), a.pool, voucherID, ownerID); err != nil {
		a.fail(w, err)
		return
	}

	tokens, err := qrtoken.Mint(a.keys, voucherID, time.Now().UTC())
	if err != nil || len(tokens) == 0 {
		a.logger.Error("minting QR tokens failed", "error", err)
		httpx.WriteError(w, a.logger, http.StatusInternalServerError, "api_error", "internal_error", "something went wrong")
		return
	}

	windows := make([]qrTokenWindow, len(tokens))
	for i, t := range tokens {
		windows[i] = qrTokenWindow{Token: t.Value, ExpiresAt: iso(t.ExpiresAt)}
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, qrTokenView{
		Token: tokens[0].Value, VoucherID: voucherID.String(), ExpiresAt: iso(tokens[0].ExpiresAt), Tokens: windows,
	})
}

type verifyQrTokenBody struct {
	Token string `json:"token"`
}

func (a *API) verifyQrToken(w http.ResponseWriter, r *http.Request) {
	var body verifyQrTokenBody
	if !a.decode(w, r, &body) {
		return
	}

	voucherID, err := qrtoken.Verify(a.keys, body.Token, time.Now().UTC())
	if err != nil {
		httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{"valid": false, "voucherId": nil})
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{"valid": true, "voucherId": voucherID.String()})
}

type listForUserBody struct {
	UserID        string `json:"userId"`
	Limit         int32  `json:"limit"`
	StartingAfter string `json:"startingAfter"`
}

func (a *API) listForUser(w http.ResponseWriter, r *http.Request) {
	var body listForUserBody
	if !a.decode(w, r, &body) {
		return
	}
	userID, err := uuid.Parse(body.UserID)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "userId is not a uuid")
		return
	}
	limit := body.Limit
	if limit <= 0 {
		limit = 20
	}

	var after pgtype.UUID
	if body.StartingAfter != "" {
		id, err := uuid.Parse(body.StartingAfter)
		if err != nil {
			httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "startingAfter is not a uuid")
			return
		}
		after = pgUUID(id)
	}

	// One extra row, so `hasMore` is known without a second query.
	rows, err := sqlcgen.New(a.pool).ListVouchersForOwner(r.Context(), sqlcgen.ListVouchersForOwnerParams{
		OwnerID: pgUUID(userID), Column2: after, Limit: limit + 1,
	})
	if err != nil {
		a.fail(w, err)
		return
	}

	hasMore := len(rows) > int(limit)
	if hasMore {
		rows = rows[:limit]
	}
	vouchers := make([]walletVoucherView, len(rows))
	for i, row := range rows {
		vouchers[i] = toWalletVoucherView(walletVoucherSource{
			ID: row.ID, ListingID: row.ListingID, SagaID: row.SagaID, State: row.State,
			VoidReason: row.VoidReason, MerchantName: row.MerchantName, Title: row.Title,
			Currency: row.Currency, FaceValueMinor: row.FaceValueMinor,
			RemainingValueMinor:     row.RemainingValueMinor,
			PartialRedemptionPolicy: row.PartialRedemptionPolicy, ExpiresAt: row.ExpiresAt,
			LocationName: row.LocationName, LocationAddress: row.LocationAddress,
			LocationDistrict: row.LocationDistrict,
		})
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]any{"vouchers": vouchers, "hasMore": hasMore})
}

// contractState maps the engine's full lifecycle onto the three states
// `Reservation` names (reserved/activated/released) — kept for `reserve`/
// `activate` (the checkout saga's own read), which never needed more than
// this. The wallet's own read (below) is where redeemed/held/expired/voided
// vouchers surface their real state; this contract shape only promises
// enough to track a reservation through the burn saga.
func contractState(state string) string {
	switch state {
	case "allocated":
		return "reserved"
	case "minted":
		return "released"
	default:
		return "activated"
	}
}

// walletLocationView is the branch that honours a voucher — TASKS.md 4.8.c,
// joined in `GetOwnedVoucherRow`/`ListVouchersForOwnerRow`. `nil` for a
// voucher minted before locations existed (pre-20260919000009): the LEFT
// JOIN leaves every field null rather than the row disappearing.
type walletLocationView struct {
	Name     string `json:"name"`
	Address  string `json:"address"`
	District string `json:"district"`
}

// walletVoucherView is TASKS.md 4.8.c's widened wallet read: `get` and
// `listForUser` return this instead of `reservationView` now. `State` stays
// the same three-bucket collapse `reservationView` already sends (a caller
// on the OLD contract shape is unaffected); `LifecycleState` is the engine's
// real state (`lifecycle.State`: minted/allocated/active/held/redeemed/
// expired/voided — though `GetOwnedVoucher`'s own `owner_id = $2` means only
// active/held/redeemed/expired/voided can ever come back here, the same
// boundary `lifecycle`'s own package doc draws between "internal" and
// "owner-visible"). `RemainingValueMinor` is what makes "partially redeemed"
// a fact this view can show without a state of its own: `docs/09` §8.2's
// balance_carrying policy leaves a voucher `active` with a reduced
// remaining value rather than moving it to a distinct state.
type walletVoucherView struct {
	VoucherID               string              `json:"voucherId"`
	ListingID               string              `json:"listingId"`
	SagaID                  string              `json:"sagaId"`
	State                   string              `json:"state"`
	LifecycleState          string              `json:"lifecycleState"`
	VoidReason              *string             `json:"voidReason"`
	MerchantName            string              `json:"merchantName"`
	Title                   string              `json:"title"`
	Currency                string              `json:"currency"`
	FaceValueMinor          int64               `json:"faceValueMinor"`
	RemainingValueMinor     int64               `json:"remainingValueMinor"`
	PartialRedemptionPolicy string              `json:"partialRedemptionPolicy"`
	ExpiresAt               string              `json:"expiresAt"`
	Location                *walletLocationView `json:"location"`
}

// walletVoucherSource is the common shape `GetOwnedVoucherRow` and
// `ListVouchersForOwnerRow` both have (two sqlc-generated types with
// identical fields, since Go gives no structural typing across them) —
// built once per row so `toWalletVoucherView` is written once, not twice.
type walletVoucherSource struct {
	ID                      pgtype.UUID
	ListingID               pgtype.UUID
	SagaID                  *string
	State                   string
	VoidReason              *string
	MerchantName            string
	Title                   string
	Currency                string
	FaceValueMinor          int64
	RemainingValueMinor     int64
	PartialRedemptionPolicy string
	ExpiresAt               pgtype.Timestamptz
	LocationName            *string
	LocationAddress         *string
	LocationDistrict        *string
}

func toWalletVoucherView(row walletVoucherSource) walletVoucherView {
	var location *walletLocationView
	if row.LocationName != nil && row.LocationAddress != nil && row.LocationDistrict != nil {
		location = &walletLocationView{
			Name: *row.LocationName, Address: *row.LocationAddress, District: *row.LocationDistrict,
		}
	}
	return walletVoucherView{
		VoucherID: asUUID(row.ID).String(), ListingID: asUUID(row.ListingID).String(),
		SagaID: sagaOrVoucherID(row.SagaID, row.ID), State: contractState(row.State),
		LifecycleState: row.State, VoidReason: row.VoidReason,
		MerchantName: row.MerchantName, Title: row.Title, Currency: row.Currency,
		FaceValueMinor: row.FaceValueMinor, RemainingValueMinor: row.RemainingValueMinor,
		PartialRedemptionPolicy: row.PartialRedemptionPolicy, ExpiresAt: iso(row.ExpiresAt.Time),
		Location: location,
	}
}

type getVoucherBody struct {
	VoucherID string `json:"voucherId"`
	OwnerID   string `json:"ownerId"`
}

func (a *API) get(w http.ResponseWriter, r *http.Request) {
	var body getVoucherBody
	if !a.decode(w, r, &body) {
		return
	}
	voucherID, ownerID, ok := parseTwoIDs(w, a, body.VoucherID, body.OwnerID)
	if !ok {
		return
	}

	row, err := ownedVoucher(r.Context(), a.pool, voucherID, ownerID)
	if err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, toWalletVoucherView(walletVoucherSource{
		ID: row.ID, ListingID: row.ListingID, SagaID: row.SagaID, State: row.State,
		VoidReason: row.VoidReason, MerchantName: row.MerchantName, Title: row.Title,
		Currency: row.Currency, FaceValueMinor: row.FaceValueMinor,
		RemainingValueMinor:     row.RemainingValueMinor,
		PartialRedemptionPolicy: row.PartialRedemptionPolicy, ExpiresAt: row.ExpiresAt,
		LocationName: row.LocationName, LocationAddress: row.LocationAddress,
		LocationDistrict: row.LocationDistrict,
	}))
}

// sagaOrVoucherID: `Reservation.sagaId` is `min(1)` in the contract, but a
// voucher minted before 4.5's saga_id column (or reached through a path
// this API does not yet cover) may have none. The voucher's own id is a
// stable, non-empty stand-in — never confused for a real saga id, since
// those are generated by apps/api's checkout saga, not by this service.
func sagaOrVoucherID(saga *string, voucherID pgtype.UUID) string {
	if saga != nil && *saga != "" {
		return *saga
	}
	return asUUID(voucherID).String()
}

func parseTwoIDs(w http.ResponseWriter, a *API, first, second string) (uuid.UUID, uuid.UUID, bool) {
	id1, err := uuid.Parse(first)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "voucherId is not a uuid")
		return uuid.UUID{}, uuid.UUID{}, false
	}
	id2, err := uuid.Parse(second)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "ownerId is not a uuid")
		return uuid.UUID{}, uuid.UUID{}, false
	}
	return id1, id2, true
}
