import { expect, test } from "@playwright/test";
import { API, REGIONS, apiRegister, testIp, useSession } from "./demo";
import {
  addMember,
  callerFor,
  closeDb,
  db,
  msg,
  one,
  requireBusinessEnv,
  staffCaller,
  verifiedBusiness,
} from "./business";

/** Face value and S in each region's minor units (AUD cents, whole rupiah). */
const VALUES = {
  AU: { face: 1_000, s: 700, up: 750, down: 600 },
  ID: { face: 50_000, s: 35_000, up: 37_500, down: 30_000 },
} as const;
const STOCK = 5;

interface Listing {
  id: string;
  priceInPoints: number;
  settlementValueMinor: number;
  stockRemaining: number;
  stockTotal: number;
}

/**
 * Journey 4 (product-intent §2.2): the Merchandiser declares a listing (face
 * value, S, stock, locations, channel, transferability, partial-redemption
 * policy and expiry) and the platform computes its price. A rise in S applies
 * at once; any cut needs a second person (docs/17 §2.1): the merchandiser's
 * own approval is refused and the owner's applies it. Studio has no screen
 * for these steps yet (13.3.m), so they run through the API; the Inventory
 * screen shows the result. Checks the listing, price revision, decrease
 * request and voucher rows, and the region wall on the catalogue.
 */
test.afterAll(closeDb);

for (const r of REGIONS) {
  test(`J4 ${r.region}: a merchandiser lists a reward; the platform prices it; a cut in S needs a second approver`, async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    requireBusinessEnv();
    const v = VALUES[r.region];
    const { owner, businessId } = await verifiedBusiness(
      request,
      r,
      ["supplier", "redeemer"],
      "j04",
    );
    const merchandiser = await addMember(request, owner, businessId, r, "merchandiser");

    const location = await merchandiser.post<{ id: string }>(`/api/${businessId}/store/locations`, {
      name: r.region === "AU" ? "Journey Laneway" : "Journey Seminyak",
      address: r.region === "AU" ? "12 Degraves St" : "Jl. Kayu Aya 8",
      district: r.region === "AU" ? "Melbourne" : "Badung",
    });
    const { rows: images } = await db().query<{ image_url: string }>(
      `SELECT image_url FROM store.listings WHERE region = $1 LIMIT 1`,
      [r.region],
    );
    const expiresAt = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const title = `Journey 4 flat white ${r.region} ${Date.now().toString(36)}`;
    const listing = await merchandiser.post<Listing>(`/api/${businessId}/store/listings`, {
      merchantName: `j04 ${r.region}`,
      title,
      description: "One flat white at the counter.",
      category: "food_beverage",
      locationIds: [location.id],
      faceValueMinor: v.face,
      settlementValueMinor: v.s,
      stockTotal: STOCK,
      transferable: true,
      partialRedemptionPolicy: "single_use_forfeit",
      minimumSpendMinor: null,
      expiresAt,
      status: "available",
      audience: "all_ages",
      contentCategory: "food-and-drink",
      tags: ["coffee"],
      imageUrl: images[0]?.image_url ?? "https://images.example/flat-white.jpg",
      channel: "in_store",
      partialRedemption: "single_use",
      // A client cannot set the price: the server ignores it and computes its own.
      priceInPoints: 1,
    });
    expect(listing.priceInPoints).toBeGreaterThan(1);
    const row = await one<{
      region: string;
      currency: string;
      face: string;
      s: string;
      price: string;
      transferable: boolean;
      channel: string;
      policy: string;
      expires: string;
    }>(
      `SELECT region, currency, face_value_minor::text AS face, settlement_value_minor::text AS s,
              price_in_points::text AS price, transferable, channel,
              partial_redemption_policy AS policy, expires_at::text AS expires
         FROM store.listings WHERE id = $1 AND merchant_id = $2`,
      [listing.id, businessId],
    );
    expect(row).toMatchObject({
      region: r.region,
      currency: r.region === "AU" ? "AUD" : "IDR",
      face: String(v.face),
      s: String(v.s),
      price: String(listing.priceInPoints),
      transferable: true,
      channel: "in_store",
      policy: "single_use_forfeit",
    });

    // Stock is minted vouchers: the merchandiser asks, a moderator approves the batch.
    const batch = await merchandiser.post<{ id: string }>(
      `/api/${businessId}/store/voucher-batch-requests`,
      { listingId: listing.id, quantity: STOCK, reason: "Opening stock." },
    );
    const moderator = await staffCaller(request, "moderator");
    await moderator.post(`/api/staff/moderation/voucher-batches/${batch.id}/approve`, {
      reason: "Opening stock for a verified merchant.",
    });
    const { rows: minted } = await db().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM voucher.vouchers WHERE listing_id = $1`,
      [listing.id],
    );
    expect(minted[0]?.n).toBe(String(STOCK));

    // A rise in S applies at once and reprices the listing.
    const { updated: raised } = await merchandiser.post<{ updated: Listing }>(
      `/api/${businessId}/store/listings/${listing.id}/settlement-value`,
      { newSettlementValueMinor: v.up, reason: "Bean costs went up." },
    );
    expect(raised.settlementValueMinor).toBe(v.up);
    expect(raised.priceInPoints).toBeGreaterThan(listing.priceInPoints);

    // A cut cannot be set directly; it becomes a request for a second person.
    await merchandiser.post(
      `/api/${businessId}/store/listings/${listing.id}/settlement-value`,
      { newSettlementValueMinor: v.down, reason: "Promotion." },
      403,
    );
    const cut = await merchandiser.post<{ id: string; state: string }>(
      `/api/${businessId}/store/listings/${listing.id}/settlement-decrease-requests`,
      { proposedSettlementValueMinor: v.down, reason: "Winter promotion." },
    );
    expect(cut.state).toBe("pending");

    // The owner sees it waiting in Inventory.
    await useSession(page.context(), baseURL!, owner.token, r);
    await page.goto(`/studio/inventory?business=${businessId}`);
    await expect(
      page.getByText(msg(r, "studio", "inventory.awaitingSecondApproval")),
    ).toBeVisible();
    await expect(page.getByText(title).first()).toBeVisible();
    await page.screenshot({ path: `test-results/j04-inventory-${r.slug}.png`, fullPage: true });

    // The requester cannot approve their own cut; the owner can.
    await merchandiser.post(
      `/api/${businessId}/store/listings/${listing.id}/settlement-decrease-requests/${cut.id}/approve`,
      {},
      403,
    );
    await owner.post(
      `/api/${businessId}/store/listings/${listing.id}/settlement-decrease-requests/${cut.id}/approve`,
      {},
    );
    const decrease = await one<{ state: string; requested_by: string; approved_by: string }>(
      `SELECT state, requested_by, approved_by FROM store.settlement_decrease_request WHERE id = $1`,
      [cut.id],
    );
    expect(decrease).toEqual({
      state: "approved",
      requested_by: merchandiser.userId,
      approved_by: owner.userId,
    });
    const { rows: revisions } = await db().query<{
      from_s: string;
      to_s: string;
      from_price: string;
      to_price: string;
      request: string | null;
    }>(
      `SELECT previous_settlement_value_minor::text AS from_s, new_settlement_value_minor::text AS to_s,
              previous_price_in_points::text AS from_price, new_price_in_points::text AS to_price,
              settlement_decrease_request_id::text AS request
         FROM store.listing_price_revision WHERE listing_id = $1 ORDER BY created_at`,
      [listing.id],
    );
    expect(revisions.map((x) => [x.from_s, x.to_s, x.request])).toEqual([
      [String(v.s), String(v.up), null],
      [String(v.up), String(v.down), cut.id],
    ]);
    expect(Number(revisions[1]!.to_price)).toBeLessThan(Number(revisions[1]!.from_price));

    // In this region's catalogue, priced by the platform; absent from the other's.
    const viewer = callerFor(request, await apiRegister(request, r, "j04-viewer"));
    const { listings } = await viewer.get<{ listings: { id: string; priceInPoints: number }[] }>(
      `/api/store/listings?region=${r.region}&limit=100&sort=newest`,
    );
    expect(listings.find((l) => l.id === listing.id)?.priceInPoints).toBe(
      Number(revisions[1]!.to_price),
    );
    const other = REGIONS.find((x) => x.region !== r.region)!;
    const outsider = await apiRegister(request, other, "j04-outsider");
    const crossed = await request.get(`${API}/api/store/listings/${listing.id}`, {
      headers: { authorization: `Bearer ${outsider.token}`, "x-forwarded-for": testIp() },
    });
    expect([403, 404]).toContain(crossed.status());
  });
}
