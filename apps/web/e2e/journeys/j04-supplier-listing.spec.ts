import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { API, REGIONS, apiRegister, testIp, useSession } from "./demo";
import type { RegionCase } from "./demo";
import {
  addMember,
  callerFor,
  closeDb,
  db,
  exact,
  msg,
  one,
  requireBusinessEnv,
  staffCaller,
  verifiedBusiness,
} from "./business";

/** Face value and S in each region's minor units (AUD cents, whole rupiah). */
const VALUES = {
  AU: { face: 1_000, s: 700, up: 750, down: 600, down2: 550 },
  ID: { face: 50_000, s: 35_000, up: 37_500, down: 30_000, down2: 28_000 },
} as const;
const STOCK = 5;
const RAISED_STOCK = 8;
/** A 1x1 PNG: a real picture the platform accepts, a few dozen bytes. */
const PICTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/** What a person types for an amount: dollars with cents, or whole rupiah. */
function typed(minor: number, r: RegionCase): string {
  return r.region === "AU" ? (minor / 100).toFixed(2) : String(minor);
}

/**
 * Journey 4 (product-intent §2.2): the Merchandiser adds a location and
 * declares a listing in Studio's Inventory (face value, S, stock, location,
 * channel, transferability, partial-redemption policy and expiry) and the
 * platform computes its price, which the screen shows. A rise in S applies at
 * once; any cut needs a second person (docs/17 §2.1): the merchandiser's request
 * has no approve button, the owner's click applies it, and the owner cannot
 * approve a cut they requested themselves. Checks the location, listing,
 * price revision, decrease request and voucher rows, the region wall on the
 * catalogue, and screenshots with axe at 390 and 1280 px, light and dark.
 *
 * Everything the Merchandiser does is on screen: the picture is uploaded through the
 * form, the voucher batch is requested from the listing (a YourTal moderator, who
 * works in the staff console, approves it through the API), and the title, stock
 * and expiry are edited in place without touching the price.
 */
test.afterAll(closeDb);

async function signInAs(page: Page, baseURL: string, token: string, r: RegionCase) {
  await page.context().clearCookies();
  await useSession(page.context(), baseURL, token, r);
}

/** The list, the approval state and the listing form, at both widths in both themes. */
async function captureScreens(
  page: Page,
  url: string,
  r: RegionCase,
  t: (key: string) => string,
  title: string,
) {
  for (const viewport of [
    { name: "390", width: 390, height: 844 },
    { name: "1280", width: 1280, height: 900 },
  ]) {
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(url);
      await expect(page.getByText(t("inventory.awaitingSecondApproval"))).toBeVisible();
      const tag = `${r.slug}-${viewport.name}-${scheme}`;
      await page.screenshot({ path: `test-results/j04-inventory-${tag}.png`, fullPage: true });
      const list = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
      expect(
        list.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
      ).toEqual([]);

      await page.getByRole("button", { name: t("inventory.newListing") }).click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByLabel(t("inventory.form.titleLabel"), { exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: `test-results/j04-listing-form-${tag}.png` });
      const form = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
      expect(
        form.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
      ).toEqual([]);
      await page.keyboard.press("Escape");

      for (const [button, shot] of [
        [t("inventory.voucherRequest.openFor").replace("{title}", title), "request"],
        [t("inventory.edit.openFor").replace("{title}", title), "edit"],
      ] as const) {
        await page.getByRole("button", { name: button }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.screenshot({ path: `test-results/j04-${shot}-${tag}.png` });
        const opened = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
        expect(
          opened.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`),
        ).toEqual([]);
        await page.keyboard.press("Escape");
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: "light" });
}

for (const r of REGIONS) {
  test(`J4 ${r.region}: a merchandiser lists a reward in Studio; the platform prices it; a cut in S needs a second approver`, async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(480_000);
    requireBusinessEnv();
    const v = VALUES[r.region];
    const t = (key: string) => msg(r, "studio", key);
    const { owner, businessId } = await verifiedBusiness(
      request,
      r,
      ["supplier", "redeemer"],
      "j04",
    );
    const merchandiser = await addMember(request, owner, businessId, r, "merchandiser");
    const inventory = `/studio/inventory?business=${businessId}`;

    // The merchandiser adds a location on screen.
    await signInAs(page, baseURL!, merchandiser.token, r);
    await page.goto(inventory);
    const locationName = r.region === "AU" ? "Journey Laneway" : "Journey Seminyak";
    await page.getByRole("button", { name: t("inventory.addLocation") }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel(t("inventory.location.nameLabel"), { exact: true }).fill(locationName);
    await dialog
      .getByLabel(t("inventory.location.addressLabel"), { exact: true })
      .fill(r.region === "AU" ? "12 Degraves St" : "Jl. Kayu Aya 8");
    await dialog
      .getByLabel(t("inventory.location.districtLabel"), { exact: true })
      .fill(r.region === "AU" ? "Melbourne" : "Badung");
    await dialog.getByRole("button", { name: t("inventory.location.save") }).click();
    await expect(dialog.getByRole("status")).toHaveText(
      t("inventory.location.added").replace("{name}", locationName),
    );
    await dialog.getByRole("button", { name: t("inventory.done") }).click();
    await expect(page.getByText(locationName, { exact: false }).first()).toBeVisible();
    const location = await one<{ name: string; merchant_id: string }>(
      `SELECT name, merchant_id::text FROM store.merchant_location WHERE merchant_id = $1`,
      [businessId],
    );
    expect(location).toEqual({ name: locationName, merchant_id: businessId });

    // ...and declares a listing. The form has no price field, and the picture is uploaded.
    let title = `Journey 4 flat white ${r.region} ${Date.now().toString(36)}`;
    const expiresOn = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
    await page.getByRole("button", { name: t("inventory.newListing") }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(/points price|harga poin/i)).toHaveCount(0);
    await dialog.getByLabel(t("inventory.form.titleLabel"), { exact: true }).fill(title);
    await dialog
      .getByLabel(t("inventory.form.descriptionLabel"), { exact: true })
      .fill("One flat white at the counter.");
    await dialog
      .getByLabel(t("inventory.form.imageLabel"), { exact: true })
      .setInputFiles({ name: "flat-white.png", mimeType: "image/png", buffer: PICTURE });
    await expect(dialog.getByText(t("inventory.form.image.ready"))).toBeVisible();
    await dialog.getByLabel(exact(t("inventory.form.faceValueLabel"))).fill(typed(v.face, r));
    await dialog.getByLabel(exact(t("inventory.form.settlementLabel"))).fill(typed(v.s, r));
    await dialog.getByLabel(t("inventory.form.stockLabel"), { exact: true }).fill(String(STOCK));
    await dialog.getByLabel(t("inventory.form.expiresOnLabel"), { exact: true }).fill(expiresOn);
    await dialog.getByRole("button", { name: locationName }).click();
    await dialog.getByRole("switch", { name: t("inventory.transferable") }).click();
    await dialog.getByRole("button", { name: t("inventory.form.submit") }).click();
    await expect(dialog.getByRole("status")).toHaveText(t("inventory.form.created"));
    const shownPrice = Number(
      (await dialog.getByLabel(exact(t("billing.points"))).getAttribute("aria-label"))?.replace(
        /\D/g,
        "",
      ),
    );
    await dialog.getByRole("button", { name: t("inventory.done") }).click();

    const row = await one<{
      id: string;
      region: string;
      currency: string;
      face: string;
      s: string;
      price: string;
      transferable: boolean;
      channel: string;
      policy: string;
      stock: number;
      image: string;
    }>(
      `SELECT id::text, region, currency, face_value_minor::text AS face,
              settlement_value_minor::text AS s, price_in_points::text AS price, transferable,
              channel, partial_redemption_policy AS policy, stock_total AS stock,
              image_url AS image
         FROM store.listings WHERE merchant_id = $1 AND title = $2`,
      [businessId, title],
    );
    expect(row).toMatchObject({
      region: r.region,
      currency: r.region === "AU" ? "AUD" : "IDR",
      face: String(v.face),
      s: String(v.s),
      transferable: true,
      channel: "in_store",
      policy: "single_use_forfeit",
      stock: STOCK,
    });
    // The picture is the one that was uploaded, under this business's own folder, and it is served.
    expect(row.image).toContain(`/posters/listings/${businessId}/`);
    const served = await request.get(row.image);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toContain("image/png");
    // The price on screen is the one the platform stored, not anything typed.
    expect(shownPrice).toBe(Number(row.price));
    expect(shownPrice).toBeGreaterThan(1);
    const listing = { id: row.id, priceInPoints: Number(row.price) };

    // Stock is minted vouchers: the merchandiser asks on screen, a moderator approves the batch.
    await page.goto(inventory);
    let listed = page.getByRole("listitem").filter({ hasText: title });
    await expect(listed.getByText(t("inventory.requests.empty"))).toBeVisible();
    const requestVouchers = t("inventory.voucherRequest.openFor").replace("{title}", title);
    await listed.getByRole("button", { name: requestVouchers }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel(t("inventory.voucherRequest.quantityLabel"), { exact: true })
      .fill(String(STOCK));
    await dialog
      .getByLabel(t("inventory.voucherRequest.reasonLabel"), { exact: true })
      .fill("Opening stock.");
    await dialog.getByRole("button", { name: t("inventory.voucherRequest.submit") }).click();
    await expect(dialog.getByRole("status")).toContainText(String(STOCK));
    await dialog.getByRole("button", { name: t("inventory.done") }).click();
    const batch = await one<{ id: string; state: string; quantity: number; by: string }>(
      `SELECT id::text, state, quantity, requested_by::text AS by
         FROM store.voucher_batch_request WHERE listing_id = $1`,
      [listing.id],
    );
    expect(batch).toMatchObject({ state: "pending", quantity: STOCK, by: merchandiser.userId });
    await expect(listed.getByText(t("inventory.requests.state.pending"))).toBeVisible();

    // All the stock is already asked for, so asking for more is refused on screen.
    await listed.getByRole("button", { name: requestVouchers }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel(t("inventory.voucherRequest.quantityLabel"), { exact: true }).fill("1");
    await dialog.getByRole("button", { name: t("inventory.voucherRequest.submit") }).click();
    await expect(
      dialog.getByText(exact(t("inventory.voucherRequest.error.overStock"))),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    const moderator = await staffCaller(request, "moderator");
    await moderator.post(`/api/staff/moderation/voucher-batches/${batch.id}/approve`, {
      reason: "Opening stock for a verified merchant.",
    });
    const { rows: minted } = await db().query<{ n: string }>(
      `SELECT count(*)::text AS n FROM voucher.vouchers WHERE listing_id = $1`,
      [listing.id],
    );
    expect(minted[0]?.n).toBe(String(STOCK));
    await page.goto(inventory);
    await expect(listed.getByText(t("inventory.requests.state.approved"))).toBeVisible();

    // The merchandiser edits title, stock and expiry on screen; the price does not move.
    const original = await one<{ expires: number }>(
      `SELECT EXTRACT(EPOCH FROM expires_at)::float8 AS expires FROM store.listings WHERE id = $1`,
      [listing.id],
    );
    const renamed = `${title} large`;
    const longer = new Date(Date.now() + 120 * 86_400_000).toISOString().slice(0, 10);
    await listed
      .getByRole("button", { name: t("inventory.edit.openFor").replace("{title}", title) })
      .click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(/points price|harga poin|settlement|penyelesaian/i)).toHaveCount(
      0,
    );
    await dialog.getByRole("button", { name: t("inventory.edit.save") }).click();
    await expect(dialog.getByRole("alert")).toHaveText(t("inventory.edit.unchanged"));
    await dialog.getByLabel(t("inventory.form.titleLabel"), { exact: true }).fill(renamed);
    await dialog
      .getByLabel(t("inventory.form.stockLabel"), { exact: true })
      .fill(String(RAISED_STOCK));
    await dialog.getByLabel(t("inventory.form.expiresOnLabel"), { exact: true }).fill(longer);
    await dialog.getByRole("button", { name: t("inventory.edit.save") }).click();
    await expect(dialog.getByRole("status")).toHaveText(t("inventory.edit.saved"));
    await dialog.getByRole("button", { name: t("inventory.done") }).click();
    const edited = await one<{
      title: string;
      stock: number;
      s: string;
      price: string;
      expires: number;
    }>(
      `SELECT title, stock_total AS stock, settlement_value_minor::text AS s,
              price_in_points::text AS price, EXTRACT(EPOCH FROM expires_at)::float8 AS expires
         FROM store.listings WHERE id = $1`,
      [listing.id],
    );
    expect(edited).toMatchObject({
      title: renamed,
      stock: RAISED_STOCK,
      s: String(v.s),
      price: String(listing.priceInPoints),
    });
    // 90 days became 120: about 30 days later, whatever the browser's time zone.
    expect(edited.expires - original.expires).toBeGreaterThan(29 * 86_400);
    expect(edited.expires - original.expires).toBeLessThan(31 * 86_400);
    title = renamed;

    // A rise in S, on screen, applies at once and reprices the listing.
    await page.goto(inventory);
    listed = page.getByRole("listitem").filter({ hasText: title });
    await expect(listed.getByText(t("inventory.status.available"), { exact: true })).toBeVisible();
    const changeValue = t("inventory.changeValueFor").replace("{title}", title);
    await listed.getByRole("button", { name: changeValue }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel(exact(t("inventory.settlement.newLabel"))).fill(typed(v.up, r));
    await dialog
      .getByLabel(t("inventory.settlement.reasonLabel"), { exact: true })
      .fill("Bean costs went up.");
    await dialog.getByRole("button", { name: t("inventory.settlement.apply") }).click();
    await expect(dialog.getByRole("status")).toHaveText(exact(t("inventory.settlement.applied")));
    await dialog.getByRole("button", { name: t("inventory.done") }).click();
    const raised = await one<{ s: string; price: string }>(
      `SELECT settlement_value_minor::text AS s, price_in_points::text AS price
         FROM store.listings WHERE id = $1`,
      [listing.id],
    );
    expect(raised.s).toBe(String(v.up));
    expect(Number(raised.price)).toBeGreaterThan(listing.priceInPoints);

    // A cut cannot be set directly (the server refuses); on screen it becomes a request.
    await merchandiser.post(
      `/api/${businessId}/store/listings/${listing.id}/settlement-value`,
      { newSettlementValueMinor: v.down, reason: "Promotion." },
      403,
    );
    await page.goto(inventory);
    await listed.getByRole("button", { name: changeValue }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel(exact(t("inventory.settlement.newLabel"))).fill(typed(v.down, r));
    await expect(dialog.getByText(t("inventory.settlement.hintCut"))).toBeVisible();
    await dialog
      .getByLabel(t("inventory.settlement.reasonLabel"), { exact: true })
      .fill("Winter promotion.");
    await dialog.getByRole("button", { name: t("inventory.settlement.request") }).click();
    await expect(dialog.getByRole("status")).toHaveText(t("inventory.settlement.requested"));
    await dialog.getByRole("button", { name: t("inventory.done") }).click();
    const cut = await one<{ id: string; state: string; requested_by: string }>(
      `SELECT id::text, state, requested_by::text FROM store.settlement_decrease_request
        WHERE listing_id = $1`,
      [listing.id],
    );
    expect(cut).toMatchObject({ state: "pending", requested_by: merchandiser.userId });

    // The merchandiser sees the request waiting, and has no way to approve it.
    await expect(page.getByText(t("inventory.awaitingSecondApproval"))).toBeVisible();
    await expect(page.getByText(t("inventory.approval.needsOwner"))).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: t("inventory.approval.approveFor").replace("{title}", title),
      }),
    ).toHaveCount(0);
    await merchandiser.post(
      `/api/${businessId}/store/listings/${listing.id}/settlement-decrease-requests/${cut.id}/approve`,
      {},
      403,
    );

    // The owner sees it, in the shapes the founder reviews, and approves it.
    await signInAs(page, baseURL!, owner.token, r);
    await captureScreens(page, inventory, r, t, title);
    await page.goto(inventory);
    await page
      .getByRole("button", { name: t("inventory.approval.approveFor").replace("{title}", title) })
      .click();
    await expect(page.getByText(t("inventory.awaitingSecondApproval"))).toHaveCount(0);
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

    // The owner's own cut: no approve button for them, and the API refuses them too.
    await page.goto(inventory);
    await listed.getByRole("button", { name: changeValue }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel(exact(t("inventory.settlement.newLabel"))).fill(typed(v.down2, r));
    await dialog
      .getByLabel(t("inventory.settlement.reasonLabel"), { exact: true })
      .fill("Clearance.");
    await dialog.getByRole("button", { name: t("inventory.settlement.request") }).click();
    await expect(dialog.getByRole("status")).toHaveText(t("inventory.settlement.requested"));
    await dialog.getByRole("button", { name: t("inventory.done") }).click();
    await expect(page.getByText(t("inventory.approval.selfRequested"))).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: t("inventory.approval.approveFor").replace("{title}", title),
      }),
    ).toHaveCount(0);
    const own = await one<{ id: string }>(
      `SELECT id::text FROM store.settlement_decrease_request WHERE listing_id = $1 AND state = 'pending'`,
      [listing.id],
    );
    await owner.post(
      `/api/${businessId}/store/listings/${listing.id}/settlement-decrease-requests/${own.id}/approve`,
      {},
      403,
    );

    // In this region's catalogue, priced by the platform; absent from the other's.
    const viewer = callerFor(request, await apiRegister(request, r, "j04-viewer"));
    const { data } = await viewer.get<{ data: { id: string; priceInPoints: number }[] }>(
      `/api/store/listings?region=${r.region}&limit=50&sort=newest`,
    );
    expect(data.find((l) => l.id === listing.id)?.priceInPoints).toBe(
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
