import { expect, test } from "@playwright/test";
import { apiGet, REGIONS, requireDemoEnv } from "./demo";

/**
 * Journey 11 (product-intent §2.2): an anonymous visitor watches a whole
 * opted-in video. The page shows the reward they are passing up and offers
 * sign-up; nothing is ever claimable.
 */
for (const r of REGIONS) {
  test(`J11 ${r.region}: an anonymous visitor plays an Open View video, sees the foregone reward, and can claim nothing`, async ({
    page,
    request,
  }) => {
    requireDemoEnv();
    const feed = await apiGet<{
      items: { campaignId: string; kind: string; openViewing: boolean; audience: string }[];
    }>(request, null, `/api/feed?surface=home&region=${r.region}`);
    const open = feed.items.find(
      (i) => i.openViewing && i.kind === "long_form" && i.audience === "all_ages",
    );
    expect(open, "the demo world has an Open View video").toBeDefined();

    // One anonymous session per IP at a time (F12): each run comes from its own
    // documentation-range address, so the two regions and reruns never collide.
    await page.setExtraHTTPHeaders({
      "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 254)}`,
    });
    await page.goto(`/${r.slug}/c/${open?.campaignId}/watch`);
    // The foregone reward, said plainly, and a sign-up that brings them back here.
    await expect(
      page.getByText(/won't earn anything this time|tidak mendapatkan poin/).first(),
    ).toBeVisible();
    const signUp = page.getByRole("link", {
      name: /Sign up to earn on your next video|Daftar untuk mulai dapat poin/,
    });
    await expect(signUp).toHaveAttribute("href", new RegExp(`returnTo=.*${open?.campaignId}`));

    // It plays to the end, in real time: the player keeps a watch honest.
    await page
      .getByRole("button", { name: /^(Play|Putar) / })
      .first()
      .click();
    await expect
      .poll(async () => page.evaluate(() => document.querySelector("video")?.currentTime ?? 0), {
        timeout: 30_000,
      })
      .toBeGreaterThan(0.5);
    await expect(
      page.getByText(/You watched the whole video|sudah menonton video ini sampai selesai/),
    ).toBeVisible({
      timeout: 200_000,
    });
    await expect(
      page.getByRole("link", { name: /pick up where you left off|lanjutkan dari sini/ }),
    ).toHaveAttribute("href", new RegExp(`returnTo=.*${open?.campaignId}`));

    // Nothing to claim, anywhere on the page.
    await expect(page.getByRole("button", { name: /claim|earn|klaim|dapatkan/i })).toHaveCount(0);
    // And no session was ever created for it.
    expect((await page.context().cookies()).find((c) => c.name === "yt_session")).toBeUndefined();
  });
}
