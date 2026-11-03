package api_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yourtal/services/voucher/internal/testdb"
)

// 2.8 T2: the holding read, over real Postgres. The rule under test is the
// boundary: only the owner's own code answers, and every other case (another
// person's code, an unknown code, a voided voucher) answers the identical
// `{"held":false}`.

type holdingFixture struct {
	owner     uuid.UUID
	hash      string
	voucherID uuid.UUID
}

// seedHolding inserts a bound AU listing with a branch, one voucher in the
// given state owned by a fresh user, and its code custody row. The code
// itself is never needed: the route is keyed on the hash.
func seedHolding(t *testing.T, state string, expires time.Time, partner *string) holdingFixture {
	t.Helper()
	ctx := context.Background()
	owner, err := pgxpool.New(ctx, testdb.URL(t, "DATABASE_OWNER_URL"))
	if err != nil {
		t.Fatalf("connect as owner: %v", err)
	}
	t.Cleanup(owner.Close)

	listingID, merchantID, locationID, voucherID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	channel := "both"
	if partner != nil {
		channel = "online"
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := owner.Exec(ctx, query, args...); err != nil {
			t.Fatalf("seeding: %v\n%s", err, query)
		}
	}
	exec(`INSERT INTO store.listings
	  (id, merchant_id, merchant_name, title, description, category,
	   face_value_minor, settlement_value_minor, price_in_points, stock_remaining, stock_total,
	   transferable, partial_redemption_policy, minimum_spend_minor, expires_at, status,
	   currency, region, audience, content_category, image_url, channel, partial_redemption, redeem_partner_id)
	 VALUES ($1, $2, 'Holding Test', '50 scans', 'seeded', 'food-and-drink', 500, 500, 200, 1, 1,
	   false, 'single_use_forfeit', NULL, $3, 'available', 'AUD', 'AU', 'all_ages',
	   'food-and-drink', 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg', $4, 'single_use', $5)`,
		listingID, merchantID, time.Now().Add(90*24*time.Hour), channel, partner)
	exec(`INSERT INTO store.merchant_location (id, merchant_id, name, address, district)
	      VALUES ($1, $2, 'Online', '1 Test St', 'Test')`, locationID, merchantID)
	exec(`INSERT INTO store.listing_location (listing_id, location_id) VALUES ($1, $2)`, listingID, locationID)

	ownerID := uuid.New()
	remaining := int64(500)
	if state == "redeemed" {
		remaining = 0
	}
	exec(`INSERT INTO voucher.vouchers
	  (id, listing_id, owner_id, merchant_id, merchant_name, title, face_value_minor, remaining_value_minor,
	   partial_redemption_policy, transferable, issued_at, expires_at, location_id, state, currency, region, void_reason)
	  VALUES ($1, $2, $3, $4, 'Holding Test', '50 scans', 500, $5, 'single_use_forfeit', false,
	    LEAST(now(), $6::timestamptz - interval '1 day'), $6, $7, $8, 'AUD', 'AU', CASE WHEN $8 = 'voided' THEN 'admin' END)`,
		voucherID, listingID, ownerID, merchantID, remaining, expires, locationID, state)
	hash := hexOf(voucherID)
	exec(`INSERT INTO voucher.code_custody (voucher_id, code_hash, wrapped_data_key, nonce, ciphertext, key_purpose, key_version)
	      VALUES ($1, $2, '\x00', '\x00', '\x00', 'voucher_code', 1)`, voucherID, hash)
	return holdingFixture{owner: ownerID, hash: hash, voucherID: voucherID}
}

// hexOf is a unique 64-digit lower-case hex string per voucher id.
func hexOf(id uuid.UUID) string {
	h := strings.ReplaceAll(id.String(), "-", "")
	return h + h
}

func holdingCall(t *testing.T, s *webhookServer, hash string, owner uuid.UUID) (int, map[string]any) {
	t.Helper()
	var out map[string]any
	status := s.call("/vouchers/holding", map[string]any{"codeSha256": hash, "ownerId": owner.String()}, &out)
	return status, out
}

func TestHoldingAnswersFactsForTheOwnersOwnCode(t *testing.T) {
	s := newWebhookServer(t)
	partner := "snap-app"
	f := seedHolding(t, "active", time.Now().Add(30*24*time.Hour), &partner)

	status, got := holdingCall(t, s, f.hash, f.owner)
	if status != http.StatusOK || got["held"] != true || got["status"] != "active" ||
		got["faceValueMinor"] != float64(500) || got["currency"] != "AUD" ||
		got["region"] != "AU" || got["redeemPartnerId"] != "snap-app" || got["expiresAt"] == nil {
		t.Fatalf("got %d %v", status, got)
	}
	if _, leaked := got["voucherId"]; leaked {
		t.Errorf("the read must not return ids: %v", got)
	}
}

func TestHoldingAnswersTheSameForAnotherPersonsOrAnUnknownCode(t *testing.T) {
	s := newWebhookServer(t)
	partner := "snap-app"
	f := seedHolding(t, "active", time.Now().Add(30*24*time.Hour), &partner)

	_, otherPerson := holdingCall(t, s, f.hash, uuid.New())
	_, unknownCode := holdingCall(t, s, hexOf(uuid.New()), f.owner)
	a, _ := json.Marshal(otherPerson)
	b, _ := json.Marshal(unknownCode)
	if string(a) != `{"held":false}` || string(a) != string(b) {
		t.Fatalf("another person's code %s, unknown code %s; both must be {\"held\":false}", a, b)
	}
}

func TestHoldingStatusesAndUnboundVouchers(t *testing.T) {
	s := newWebhookServer(t)
	partner := "snap-app"
	future, past := time.Now().Add(30*24*time.Hour), time.Now().Add(-time.Hour)

	cases := []struct {
		name    string
		state   string
		expires time.Time
		held    bool
		status  string
	}{
		{"redeemed", "redeemed", future, true, "redeemed"},
		{"expired by the sweep", "expired", past, true, "expired"},
		{"past expiry before the sweep", "active", past, true, "expired"},
		{"a hold past expiry", "held", past, true, "expired"},
		{"a live hold", "held", future, true, "held"},
		{"voided is nothing to redeem", "voided", future, false, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := seedHolding(t, c.state, c.expires, &partner)
			_, got := holdingCall(t, s, f.hash, f.owner)
			if (got["held"] == true) != c.held || (c.held && got["status"] != c.status) {
				t.Fatalf("got %v, want held=%v status=%q", got, c.held, c.status)
			}
		})
	}

	// An ordinary store voucher is still "held" by its owner; T4 refuses it
	// because redeemPartnerId is not the caller, not this route.
	f := seedHolding(t, "active", future, nil)
	_, got := holdingCall(t, s, f.hash, f.owner)
	if got["held"] != true {
		t.Fatalf("got %v", got)
	}
	if _, bound := got["redeemPartnerId"]; bound {
		t.Errorf("an unbound voucher reports a partner: %v", got)
	}
}

func TestHoldingRefusesMalformedInput(t *testing.T) {
	s := newWebhookServer(t)
	for name, body := range map[string]map[string]any{
		"short hash":     {"codeSha256": "abc", "ownerId": uuid.NewString()},
		"upper-case":     {"codeSha256": "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789", "ownerId": uuid.NewString()},
		"owner not uuid": {"codeSha256": hexOf(uuid.New()), "ownerId": "nope"},
	} {
		var out map[string]any
		if status := s.call("/vouchers/holding", body, &out); status != http.StatusBadRequest {
			t.Errorf("%s: %d %v, want 400", name, status, out)
		}
	}
}
