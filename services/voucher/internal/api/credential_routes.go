package api

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/yourtal/services/voucher/internal/httpx"
	"github.com/yourtal/services/voucher/internal/keyring"
	"github.com/yourtal/services/voucher/internal/store/sqlcgen"
)

// 4.5.d: merchant HMAC credential issue/rotate/revoke. Every credential
// this route issues is device-scoped (`voucher.merchant_credential.device_id`
// NOT NULL here) — a legacy merchant-wide key with no device is a state
// nothing in this API creates, but void/refund (redeem package) still has
// to recognise one if it exists.

// rotationOverlap is how long a superseded key keeps verifying, so a
// merchant cannot swap a key atomically across their own device fleet — see
// SupersedeCredential's own comment.
const rotationOverlap = 24 * time.Hour

func newSecret() (plaintext, hex string, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", fmt.Errorf("generating a credential secret: %w", err)
	}
	encoded := hexEncode(raw)
	return string(raw), encoded, nil
}

func hexEncode(raw []byte) string { return hex.EncodeToString(raw) }

func newKeyID() string { return "mc_" + uuid.New().String() }

type credentialView struct {
	CredentialID string  `json:"credentialId"`
	MerchantID   string  `json:"merchantId"`
	DeviceID     string  `json:"deviceId"`
	Secret       *string `json:"secret,omitempty"`
	State        string  `json:"state"`
	IssuedAt     string  `json:"issuedAt"`
}

type issueMerchantCredentialBody struct {
	MerchantID string `json:"merchantId"`
	DeviceID   string `json:"deviceId"`
	IssuedBy   string `json:"issuedBy"`
}

func (a *API) issueMerchantCredential(w http.ResponseWriter, r *http.Request) {
	var body issueMerchantCredentialBody
	if !a.decode(w, r, &body) {
		return
	}
	merchantID, err := uuid.Parse(body.MerchantID)
	if err != nil {
		httpx.WriteError(w, a.logger, http.StatusBadRequest, "invalid_request_error", "malformed_id", "merchantId is not a uuid")
		return
	}

	secretPlain, secretHex, err := newSecret()
	if err != nil {
		a.logger.Error("generating a credential secret failed", "error", err)
		httpx.WriteError(w, a.logger, http.StatusInternalServerError, "api_error", "internal_error", "something went wrong")
		return
	}
	sealed, err := a.keys.Seal(keyring.PurposeMerchantHMAC, []byte(secretPlain))
	if err != nil {
		a.logger.Error("sealing a credential secret failed", "error", err)
		httpx.WriteError(w, a.logger, http.StatusInternalServerError, "api_error", "internal_error", "something went wrong")
		return
	}

	keyID := newKeyID()
	deviceID := body.DeviceID
	if err := sqlcgen.New(a.pool).InsertCredential(r.Context(), sqlcgen.InsertCredentialParams{
		KeyID: keyID, MerchantID: pgUUID(merchantID),
		WrappedDataKey: sealed.WrappedDataKey, Nonce: sealed.Nonce, Ciphertext: sealed.Ciphertext,
		KeyPurpose: string(sealed.Purpose), KeyVersion: int32(sealed.Version), DeviceID: &deviceID,
	}); err != nil {
		a.fail(w, err)
		return
	}

	secret := secretHex
	httpx.WriteJSON(w, a.logger, http.StatusOK, credentialView{
		CredentialID: keyID, MerchantID: merchantID.String(), DeviceID: deviceID,
		Secret: &secret, State: "active", IssuedAt: iso(time.Now().UTC()),
	})
}

type rotateCredentialBody struct {
	CredentialID string `json:"credentialId"`
	RotatedBy    string `json:"rotatedBy"`
}

func (a *API) rotateCredential(w http.ResponseWriter, r *http.Request) {
	var body rotateCredentialBody
	if !a.decode(w, r, &body) {
		return
	}

	queries := sqlcgen.New(a.pool)
	existing, err := queries.GetCredential(r.Context(), body.CredentialID)
	if errors.Is(err, pgx.ErrNoRows) {
		a.fail(w, fmt.Errorf("%w: credential %s", errNotFound, body.CredentialID))
		return
	}
	if err != nil {
		a.fail(w, err)
		return
	}

	if err := queries.SupersedeCredential(r.Context(), sqlcgen.SupersedeCredentialParams{
		KeyID: existing.KeyID, NotAfter: pgtype.Timestamptz{Time: time.Now().UTC().Add(rotationOverlap), Valid: true},
	}); err != nil {
		a.fail(w, err)
		return
	}

	secretPlain, secretHex, err := newSecret()
	if err != nil {
		a.logger.Error("generating a credential secret failed", "error", err)
		httpx.WriteError(w, a.logger, http.StatusInternalServerError, "api_error", "internal_error", "something went wrong")
		return
	}
	sealed, err := a.keys.Seal(keyring.PurposeMerchantHMAC, []byte(secretPlain))
	if err != nil {
		a.logger.Error("sealing a credential secret failed", "error", err)
		httpx.WriteError(w, a.logger, http.StatusInternalServerError, "api_error", "internal_error", "something went wrong")
		return
	}

	keyID := newKeyID()
	deviceID := ""
	if existing.DeviceID != nil {
		deviceID = *existing.DeviceID
	}
	if err := queries.InsertCredential(r.Context(), sqlcgen.InsertCredentialParams{
		KeyID: keyID, MerchantID: existing.MerchantID,
		WrappedDataKey: sealed.WrappedDataKey, Nonce: sealed.Nonce, Ciphertext: sealed.Ciphertext,
		KeyPurpose: string(sealed.Purpose), KeyVersion: int32(sealed.Version), DeviceID: existing.DeviceID,
	}); err != nil {
		a.fail(w, err)
		return
	}

	secret := secretHex
	httpx.WriteJSON(w, a.logger, http.StatusOK, credentialView{
		CredentialID: keyID, MerchantID: asUUID(existing.MerchantID).String(), DeviceID: deviceID,
		Secret: &secret, State: "active", IssuedAt: iso(time.Now().UTC()),
	})
}

type revokeCredentialBody struct {
	CredentialID string `json:"credentialId"`
	RevokedBy    string `json:"revokedBy"`
}

func (a *API) revokeCredential(w http.ResponseWriter, r *http.Request) {
	var body revokeCredentialBody
	if !a.decode(w, r, &body) {
		return
	}
	if err := sqlcgen.New(a.pool).RevokeCredential(r.Context(), body.CredentialID); err != nil {
		a.fail(w, err)
		return
	}
	httpx.WriteJSON(w, a.logger, http.StatusOK, map[string]bool{"revoked": true})
}
