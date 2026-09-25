package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/voucher/internal/chain"
	"github.com/yourtal/services/voucher/internal/code"
	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/lifecycle"
	"github.com/yourtal/services/voucher/internal/redeem"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// 4.5's device-authorized path: apps/api (a web counter, 8.x) authorizing
// and capturing a voucher on a device's behalf, over serviceauth rather
// than a merchant's own HMAC key. Deliberately a SEPARATE, simpler
// implementation from the merchant network's Authorize/Capture (redeem
// package) rather than a thin wrapper over it: this request shape carries
// no order reference and no throttle/enumeration concern (the caller is
// apps/api itself, already trusted), and "no amount" means "the whole
// remaining value" — a distinction the merchant API's mandatory-amount
// design deliberately does not offer (see redeem.AuthorizeRequest's
// comment).
const deviceAuthorizationTTL = 5 * time.Minute

type authorizeAsDeviceBody struct {
	VoucherCode string `json:"voucherCode"`
	DeviceID    string `json:"deviceId"`
	MerchantID  string `json:"merchantId"`
	AmountMinor *int64 `json:"amountMinor,omitempty"`
	Currency    string `json:"currency"`
}

type authorizationView struct {
	AuthorizationID string `json:"authorizationId"`
	VoucherID       string `json:"voucherId"`
	AmountMinor     int64  `json:"amountMinor"`
	Currency        string `json:"currency"`
	ExpiresAt       string `json:"expiresAt"`
}

func (a *API) authorizeAsDevice(w http.ResponseWriter, r *http.Request) {
	var body authorizeAsDeviceBody
	if !a.decode(w, r, &body) {
		return
	}
	merchantID, err := uuid.Parse(body.MerchantID)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "merchantId is not a uuid")
		return
	}

	canonical, err := code.Parse(body.VoucherCode)
	if err != nil {
		a.fail(w, fmt.Errorf("%w: no voucher matches this code", errAudienceBlocked))
		return
	}
	digest := sha256.Sum256([]byte(canonical))
	hash := hex.EncodeToString(digest[:])

	var view authorizationView
	txErr := pgx.BeginTxFunc(r.Context(), a.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)

		voucher, err := queries.FindVoucherByCodeHash(r.Context(), hash)
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: no voucher matches this code", errAudienceBlocked)
		}
		if err != nil {
			return err
		}
		if asUUID(voucher.MerchantID) != merchantID {
			return fmt.Errorf("%w: this voucher belongs to a different merchant", errAudienceBlocked)
		}
		if voucher.Currency != body.Currency {
			return fmt.Errorf("%w: this voucher is denominated in %s", redeem.ErrCurrencyMismatch, voucher.Currency)
		}
		if !lifecycle.Spendable(lifecycle.State(voucher.State)) {
			return fmt.Errorf("%w: voucher is %s", errBadRequest, voucher.State)
		}

		amount := voucher.RemainingValueMinor
		if body.AmountMinor != nil {
			amount = *body.AmountMinor
		}
		if amount <= 0 || amount > voucher.RemainingValueMinor {
			return fmt.Errorf("%w: cannot authorize %d against %d remaining",
				errBadRequest, amount, voucher.RemainingValueMinor)
		}

		killed, err := queries.IsKilled(r.Context(), sqlcgen.IsKilledParams{
			ScopeID: pgUUID(merchantID), ScopeID_2: voucher.BatchID,
		})
		if err != nil {
			return fmt.Errorf("reading the kill switch: %w", err)
		}
		if killed {
			return redeem.ErrKilled
		}

		id := uuid.New()
		expires := time.Now().UTC().Add(deviceAuthorizationTTL)
		deviceID := body.DeviceID
		row, err := queries.InsertAuthorization(r.Context(), sqlcgen.InsertAuthorizationParams{
			ID: pgUUID(id), VoucherID: voucher.ID, MerchantID: pgUUID(merchantID),
			AmountMinor: amount, Currency: body.Currency,
			MerchantOrderRef: "device:" + deviceID + ":" + id.String(),
			ExpiresAt:        pgtype.Timestamptz{Time: expires, Valid: true},
			OrderTotalMinor:  &amount, DeviceID: &deviceID,
		})
		if err != nil {
			return fmt.Errorf("placing the hold: %w", err)
		}

		if _, err := issue.Move(r.Context(), queries, issue.MoveRequest{
			VoucherID: asUUID(voucher.ID), From: lifecycle.State(voucher.State), To: lifecycle.Held,
			RemainingMinor: voucher.RemainingValueMinor, Version: voucher.Version,
			EventType: chain.TypeAuthorized,
			Detail: chain.Detail("authorization_id", id.String(), "device_id", deviceID,
				"amount_minor", chain.Amount(amount)),
			At: time.Now().UTC(),
		}); err != nil {
			return err
		}

		view = authorizationView{
			AuthorizationID: id.String(), VoucherID: asUUID(voucher.ID).String(),
			AmountMinor: row.AmountMinor, Currency: row.Currency, ExpiresAt: iso(row.ExpiresAt.Time),
		}
		return nil
	})
	if txErr != nil {
		a.fail(w, txErr)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, view)
}

type captureAsDeviceBody struct {
	AuthorizationID string `json:"authorizationId"`
	DeviceID        string `json:"deviceId"`
	MerchantID      string `json:"merchantId"`
}

type captureView struct {
	CaptureID   string `json:"captureId"`
	VoucherID   string `json:"voucherId"`
	AmountMinor int64  `json:"amountMinor"`
	Currency    string `json:"currency"`
	CapturedAt  string `json:"capturedAt"`
}

// captureAsDevice discriminates its refusals (audience_blocked, quote_expired,
// already_granted) where the merchant-facing Capture deliberately does not —
// this path is only ever called by apps/api, which is already trusted, so
// there is no enumeration surface being protected by collapsing them.
func (a *API) captureAsDevice(w http.ResponseWriter, r *http.Request) {
	var body captureAsDeviceBody
	if !a.decode(w, r, &body) {
		return
	}
	authorizationID, err := uuid.Parse(body.AuthorizationID)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "authorizationId is not a uuid")
		return
	}
	merchantID, err := uuid.Parse(body.MerchantID)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "merchantId is not a uuid")
		return
	}

	var view captureView
	txErr := pgx.BeginTxFunc(r.Context(), a.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)

		authorization, err := queries.GetAuthorization(r.Context(), pgUUID(authorizationID))
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("%w: no such authorization", errNotFound)
		}
		if err != nil {
			return err
		}
		if asUUID(authorization.MerchantID) != merchantID {
			return fmt.Errorf("%w: authorization %s was not issued to this merchant", errAudienceBlocked, authorizationID)
		}
		if authorization.State != "held" {
			return fmt.Errorf("%w: authorization %s was already %s", errAlreadyCaptured, authorizationID, authorization.State)
		}
		if !authorization.ExpiresAt.Time.After(time.Now().UTC()) {
			return fmt.Errorf("%w: authorization %s", errAuthorizationExpired, authorizationID)
		}

		resolved, err := queries.ResolveAuthorization(r.Context(), sqlcgen.ResolveAuthorizationParams{
			ID: pgUUID(authorizationID), State: "captured", MerchantID: pgUUID(merchantID),
		})
		if err != nil {
			// Lost a race with the sweeper or another capture between the
			// checks above and here.
			return fmt.Errorf("%w: authorization %s", errAlreadyCaptured, authorizationID)
		}

		voucher, err := queries.GetVoucher(r.Context(), resolved.VoucherID)
		if err != nil {
			return fmt.Errorf("reading the voucher: %w", err)
		}
		if lifecycle.State(voucher.State) != lifecycle.Held {
			return fmt.Errorf("%w: voucher %s is %s", errAlreadyCaptured, asUUID(voucher.ID), voucher.State)
		}

		remaining, next := afterDeviceCapture(voucher.PartialRedemptionPolicy, voucher.RemainingValueMinor, resolved.AmountMinor)

		captureID := uuid.New()
		receiptID := "rcpt_" + captureID.String()
		if _, err := queries.InsertCapture(r.Context(), sqlcgen.InsertCaptureParams{
			ID: pgUUID(captureID), AuthorizationID: resolved.ID,
			AuthorizedAmountMinor: resolved.AmountMinor, AmountMinor: resolved.AmountMinor, ReceiptID: receiptID,
		}); err != nil {
			return fmt.Errorf("recording the capture: %w", err)
		}

		if _, err := issue.Move(r.Context(), queries, issue.MoveRequest{
			VoucherID: asUUID(voucher.ID), From: lifecycle.Held, To: next,
			RemainingMinor: remaining, Version: voucher.Version,
			EventType: chain.TypeCaptured,
			Detail: chain.Detail("authorization_id", authorizationID.String(), "receipt_id", receiptID,
				"amount_minor", chain.Amount(resolved.AmountMinor), "remaining_minor", chain.Amount(remaining)),
			At: time.Now().UTC(),
		}); err != nil {
			return err
		}

		view = captureView{
			CaptureID: captureID.String(), VoucherID: asUUID(voucher.ID).String(),
			AmountMinor: resolved.AmountMinor, Currency: resolved.Currency, CapturedAt: iso(time.Now().UTC()),
		}
		return nil
	})
	if txErr != nil {
		a.fail(w, txErr)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, view)
}

// afterDeviceCapture mirrors redeem.afterCapture (unexported there): the
// per-batch partial-redemption policy governs what happens to the voucher
// after a full-value device capture.
func afterDeviceCapture(policy string, remaining, captured int64) (int64, lifecycle.State) {
	if policy == "balance_carrying" {
		left := remaining - captured
		if left <= 0 {
			return 0, lifecycle.Redeemed
		}
		return left, lifecycle.Active
	}
	return 0, lifecycle.Redeemed
}
