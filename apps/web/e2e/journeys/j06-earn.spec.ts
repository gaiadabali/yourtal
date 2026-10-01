import { expect, test } from "@playwright/test";
import { apiGet, apiRegister, REGIONS, requireDemoEnv, useSession } from "./demo";

type FeedItem = {
  campaignId: string;
  title: string;
  kind: string;
  durationSeconds: number;
  rewardPoints: number;
  maxRewardPoints: number;
  questionCount: number;
  audience: string;
};
type Wallet = { region: string; availablePoints: number; pendingPoints: number; pending: { points: number }[] };

/**
 * Journey 6 (product-intent §2.2): the terms are shown before the start, the
 * whole video is played in real time, the questions come part-way, and the
 * points land as pending with an unlock date. The figure on screen is the one
 * the server wrote to the wallet.
 */
for (const r of REGIONS) {
  test(`J6 ${r.region}: watch a long video with questions → points pending with an unlock date, as the wallet records`, async ({
    page,
    context,
    request,
    baseURL,
  }) => {
    requireDemoEnv();
    const viewer = await apiRegister(request, r, `j6-${r.slug}`);
    await useSession(context, baseURL!, viewer.token, r);

    const feed = await apiGet<{ items: FeedItem[] }>(request, viewer.token, `/api/feed?surface=home&region=${r.region}`);
    const video = feed.items
      // Under a minute the server asks no questions, whatever the card says.
      .filter((i) => i.kind === "long_form" && i.durationSeconds >= 60 && i.questionCount > 0 && i.audience === "all_ages")
      .sort((a, b) => a.durationSeconds - b.durationSeconds)[0];
    expect(video, "the demo world has a long video with questions").toBeDefined();
    test.setTimeout((video!.durationSeconds + 180) * 1000);

    const before = await apiGet<Wallet>(request, viewer.token, "/api/wallet");
    expect(before.region).toBe(r.region);

    await page.goto(`/watch/${video!.campaignId}`);
    // The terms, before anything starts.
    const terms = page.getByRole("region", { name: /^(Reward terms|Syarat reward)$/ });
    await expect(terms).toContainText(String(video!.maxRewardPoints));
    await expect(terms).toContainText(/question|pertanyaan/i);

    await page.getByRole("button", { name: new RegExp(`^(Play|Putar) `) }).first().click();

    // Answer each checkpoint as it comes, until the earn moment says what landed.
    const earned = page.locator("[aria-label^='Plus ']");
    const unlocks = page.getByText(/^(Unlocks|Terbuka) /);
    let answered = 0;
    const deadline = Date.now() + (video!.durationSeconds + 120) * 1000;
    while (Date.now() < deadline && !(await unlocks.isVisible())) {
      const dialog = page.getByRole("dialog");
      if (await dialog.isVisible()) {
        await dialog.getByRole("radio").first().click();
        answered += 1;
        await expect(dialog).toBeHidden({ timeout: 30_000 });
      }
      await page.waitForTimeout(1_000);
    }
    await expect(unlocks).toBeVisible();
    expect(answered, "the questions came part-way").toBe(video!.questionCount);
    const label = (await earned.first().getAttribute("aria-label")) ?? "";
    const shown = Number(label.match(/\d+/)?.[0]);
    expect(shown).toBeGreaterThanOrEqual(video!.rewardPoints);
    expect(shown).toBeLessThanOrEqual(video!.maxRewardPoints);

    // The ledger agrees: pending, not spendable yet, by exactly what was shown.
    const after = await apiGet<Wallet>(request, viewer.token, "/api/wallet");
    expect(after.pendingPoints - before.pendingPoints).toBe(shown);
    expect(after.availablePoints).toBe(before.availablePoints);
    const sessions = await apiGet<{ sessions: { campaignId: string; coveredSeconds: number; durationSeconds: number }[] }>(
      request,
      viewer.token,
      "/api/watch/sessions",
    );
    const session = sessions.sessions.find((s) => s.campaignId === video!.campaignId);
    expect(session?.coveredSeconds).toBe(session?.durationSeconds);
  });
}
