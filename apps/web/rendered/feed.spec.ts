import { expect, test } from "@playwright/test";

/**
 * TASKS.md 3.5.e (first half): the mounted-video cap has to hold in a real
 * browser, scrolling through a real feed — a unit test can fake
 * `IntersectionObserver`, but only this can show the cap survives real
 * scroll-snap and real intersection timing.
 */
test("VerticalFeed keeps at most 3 <video> elements mounted after scrolling through all 20 items", async ({
  page,
}) => {
  await page.goto("/lab/ui");

  const section = page.getByTestId("gallery-vertical-feed");
  await section.scrollIntoViewIfNeeded();
  const scroller = section.getByTestId("vertical-feed-scroller");
  await expect(scroller).toBeVisible();

  for (let step = 0; step < 20; step += 1) {
    await scroller.evaluate((el) => {
      el.scrollTop += el.clientHeight;
    });
    await page.waitForTimeout(150);
    const videoCount = await scroller.locator("video").count();
    expect(videoCount).toBeLessThanOrEqual(3);
  }

  await expect(scroller.getByText("You're all caught up")).toBeVisible();
});
