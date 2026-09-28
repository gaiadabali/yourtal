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

	"context"

	"github.com/yourtal/services/voucher/internal/chain"
	"github.com/yourtal/services/voucher/internal/code"
	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/lifecycle"
	"github.com/yourtal/services/voucher/internal/qrtoken"
	"github.com/yourtal/services/voucher/internal/redeem"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// TASKS.md 8.2.a (found running 8.2.e's Check, this ticket's own report):
// "scan the QR (camera) or type the code" names two ways to present a
// voucher, but only the typed code ever reached the counter -- a token
// minted by qrToken (4.5.b/4.8.a) had nowhere in this file to be verified.
// Both prove possession the same way, so both resolve here identically:
// code.Parse first (the existing, narrower format), then qrtoken.Verify as
// a fallback -- never a caller-supplied id trusted on its own (see
// db/query/issue.sql's own note on GetVoucher for why that distinction
// matters), only an id a signed token just proved. pgx.ErrNoRows on a bad
// token reuses the exact "no voucher matches this code" path a bad code
// already takes -- one caller-facing refusal for either kind of miss.
func (a *API) resolveDeviceVoucher(
	ctx context.Context, queries *sqlcgen.Queries, presented string,
) (sqlcgen.VoucherVoucher, error) {
	if canonical, err := code.Parse(presented); err == nil {
		digest := sha256.Sum256([]byte(canonical))
		return queries.FindVoucherByCodeHash(ctx, hex.EncodeToString(digest[:]))
	}
	voucherID, err := qrtoken.Verify(a.keys, presented, time.Now())
	if err != nil {
		return sqlcgen.VoucherVoucher{}, pgx.ErrNoRows
	}
	return queries.GetVoucher(ctx, pgUUID(voucherID))
}

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

// TASKS.md 8.2.a: a read-only preview before a hold is placed, so a cashier
// can see the merchant/offer/remaining value and decide the amount BEFORE
// committing to authorizeAsDevice. Added by Phase 8 (Area C, apps/api's own
// module), not Phase 4/A — see that ticket's own report for why this
// touches services/voucher: the two mutating device operations above are
// the only ones this service exposed for the device path, and neither is
// safe to call just to look, since authorizeAsDevice already places a hold.
// No new column, no new table -- purely a narrower read of the same row
// authorizeAsDevice already loads.
type lookupAsDeviceBody struct {
	VoucherCode string `json:"voucherCode"`
	MerchantID  string `json:"merchantId"`
}

type voucherPreviewView struct {
	VoucherID               string `json:"voucherId"`
	MerchantName            string `json:"merchantName"`
	OfferTitle              string `json:"offerTitle"`
	RemainingValueMinor     int64  `json:"remainingValueMinor"`
	Currency                string `json:"currency"`
	PartialRedemptionPolicy string `json:"partialRedemptionPolicy"`
}

func (a *API) lookupAsDevice(w http.ResponseWriter, r *http.Request) {
	var body lookupAsDeviceBody
	if !a.decode(w, r, &body) {
		return
	}
	merchantID, err := uuid.Parse(body.MerchantID)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "merchantId is not a uuid")
		return
	}

	queries := sqlcgen.New(a.pool)
	voucher, err := a.resolveDeviceVoucher(r.Context(), queries, body.VoucherCode)
	if errors.Is(err, pgx.ErrNoRows) {
		a.fail(w, fmt.Errorf("%w: no voucher matches this code", errAudienceBlocked))
		return
	}
	if err != nil {
		a.fail(w, err)
		return
	}
	if asUUID(voucher.MerchantID) != merchantID {
		a.fail(w, fmt.Errorf("%w: this voucher belongs to a different merchant", errAudienceBlocked))
		return
	}
	if !lifecycle.Spendable(lifecycle.State(voucher.State)) {
		a.fail(w, fmt.Errorf("%w: voucher is %s", errBadRequest, voucher.State))
		return
	}

	httpx.WriteJSON(w, a.logger, http.StatusOK, voucherPreviewView{
		VoucherID:               asUUID(voucher.ID).String(),
		MerchantName:            voucher.MerchantName,
		OfferTitle:              voucher.Title,
		RemainingValueMinor:     voucher.RemainingValueMinor,
		Currency:                voucher.Currency,
		PartialRedemptionPolicy: voucher.PartialRedemptionPolicy,
	})
}

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

	var view authorizationView
	txErr := pgx.BeginTxFunc(r.Context(), a.pool, pgx.TxOptions{}, func(tx pgx.Tx) error {
		queries := sqlcgen.New(tx)

		voucher, err := a.resolveDeviceVoucher(r.Context(), queries, body.VoucherCode)
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

		// 4.6.f: same transaction as the capture — see the migration's own
		// comment.
		if err := queries.InsertCaptureOutbox(r.Context(), sqlcgen.InsertCaptureOutboxParams{
			CaptureID: pgUUID(captureID), Region: voucher.Region, MerchantID: pgUUID(merchantID),
			AmountMinor: resolved.AmountMinor, Currency: resolved.Currency,
		}); err != nil {
			return fmt.Errorf("recording the capture outbox row: %w", err)
		}

		// 8.3.e: same outbox redeem.Capture writes for the merchant HMAC path
		// — one source for voucher.captured whichever route settled it, so
		// apps/api's counter controller no longer publishes this itself
		// (double-notify otherwise: this row AND its own direct publish).
		if err := redeem.RecordWebhookOutbox(r.Context(), queries, redeem.WebhookOutboxEvent{
			EventType:      "voucher.captured",
			MerchantID:     merchantID,
			IdempotencyKey: captureID.String(),
			Payload: map[string]any{
				"captureId":   captureID.String(),
				"voucherId":   asUUID(voucher.ID).String(),
				"amountMinor": resolved.AmountMinor,
				"currency":    resolved.Currency,
				"capturedAt":  time.Now().UTC().Format(time.RFC3339),
				"orderRef":    resolved.MerchantOrderRef,
			},
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
