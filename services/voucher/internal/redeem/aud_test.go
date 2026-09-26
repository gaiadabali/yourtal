package redeem_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/yourtal/services/voucher/internal/issue"
	"github.com/yourtal/services/voucher/internal/redeem"
)

// mintAUD is mintOne for an AU listing priced in AUD.
func (f *fixture) mintAUD(t *testing.T, faceMinor int64) (uuid.UUID, string) {
	t.Helper()
	ctx := context.Background()
	listingID := uuid.New()
	if _, err := f.owner.Exec(ctx, `
		INSERT INTO store.listings
		  (id, merchant_id, merchant_name, title, description, category,
		   face_value_minor, settlement_value_minor, price_in_points,
		   stock_remaining, stock_total, transferable, partial_redemption_policy,
		   minimum_spend_minor, expires_at, status, currency, region, audience,
		   content_category, image_url, channel, partial_redemption)
		VALUES ($1, $2, 'Test Merchant', 'AU Test Listing', 'an AUD listing for one test', 'food-and-drink',
		        $3, $4, 1, 1, 1, false, 'balance_carrying',
		        NULL, $5, 'available', 'AUD', 'AU', 'all_ages',
		        'food-and-drink', 'http://127.0.0.1:26900/yourtal-media/listings/placeholder.jpg', 'both', 'single_use')`,
		listingID, f.merchantID, faceMinor, faceMinor/3, time.Now().UTC().Add(90*24*time.Hour)); err != nil {
		t.Fatalf("inserting an AUD listing: %v", err)
	}
	if _, err := f.owner.Exec(ctx,
		`INSERT INTO store.listing_location (listing_id, location_id) VALUES ($1, $2)`,
		listingID, f.locationID); err != nil {
		t.Fatalf("inserting the listing's location: %v", err)
	}
	batchID := uuid.New()
	if err := f.minter.RequestBatch(ctx, issue.BatchRequest{
		ID: batchID, ListingID: listingID, SupplierBusinessID: f.merchantID,
		RequestedBy: "test-requester", Quantity: 1, FundingReference: "probe-funding",
	}); err != nil {
		t.Fatalf("RequestBatch: %v", err)
	}
	if err := f.minter.Approve(ctx, batchID, "test-approver"); err != nil {
		t.Fatalf("Approve: %v", err)
	}
	if _, err := f.minter.Mint(ctx, batchID); err != nil {
		t.Fatalf("Mint: %v", err)
	}
	sagaID := uuid.NewString()
	if _, err := f.minter.Reserve(ctx, listingID, sagaID); err != nil {
		t.Fatalf("Reserve: %v", err)
	}
	reservation, err := f.minter.ActivateReservation(ctx, sagaID, uuid.New())
	if err != nil {
		t.Fatalf("ActivateReservation: %v", err)
	}
	plaintext, err := f.minter.Reveal(ctx, reservation.VoucherID)
	if err != nil {
		t.Fatalf("Reveal: %v", err)
	}
	return reservation.VoucherID, plaintext
}

// D10: an AUD voucher was always refused (only IDR passed), logged as
// wrong_merchant, and twenty honest tries throttled the till. Now AUD
// redeems like IDR, and repeated AUD redemptions never throttle.
func TestAnAUDVoucherRedeemsInAustralia(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	for attempt := 0; attempt < redeem.FailureThreshold+2; attempt++ {
		voucherID, plaintext := f.mintAUD(t, 2_000) // AUD 20.00
		authorization, err := f.network.Authorize(ctx, redeem.AuthorizeRequest{
			Code: plaintext, MerchantID: f.merchantID, AmountMinor: 1_500,
			Currency: "AUD", OrderRef: orderRef(),
		})
		if err != nil {
			t.Fatalf("attempt %d: an AUD authorize was refused: %v", attempt, err)
		}
		capture, err := f.network.Capture(ctx, authorization.ID, f.merchantID, 1_500, orderRef())
		if err != nil {
			t.Fatalf("attempt %d: an AUD capture was refused: %v", attempt, err)
		}
		if capture.RemainingMinor != 500 {
			t.Errorf("remaining %d, want 500 (AUD 5.00)", capture.RemainingMinor)
		}
		if state := f.stateOf(t, voucherID); state != "active" {
			t.Errorf("a part-spent AUD voucher is %q, want active", state)
		}
	}
}
