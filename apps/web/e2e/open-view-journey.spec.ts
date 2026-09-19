import { expect, test } from "@playwright/test";
import { BONUS_ACCURACY_CAMPAIGN_ID } from "./fixture-ids";

/**
 * YT-0450's first acceptance criterion, Open-view leg: a public page under
 * `/id/...` (`app/(public)/[locale]/`) -> anonymous full playback with no
 * reward UI and no claim affordance -> the sign-up prompt at the point a
 * rewarded viewer would have been paid.
 *
 * Shares Earn's video blocker: `OpenViewPlayer` reuses `useWatchSession`
 * (`features/player/use-watch-session.ts`) exactly like the rewarded
 * player, so `hasEnded` — the trigger for `OpenViewSignupPrompt`, YT-0432's
 * third criterion — needs the same real, network-loaded HLS segment to
 * reach its `ended` event, which reliably does not happen in this
 * environment (see earn-journey.spec.ts's top comment). The interstitial
 * at the "you'd have been paid here" moment is therefore UNVERIFIED below,
 * not faked. Everything reachable without that event IS driven for real:
 * the public landing page, the real click into anonymous playback, and a
 * DOM-wide sweep proving no reward or claim affordance exists anywhere on
 * the page — not merely hidden by CSS, actually absent from the markup.
 */
test.describe("Open-view journey", () => {
  test("public campaign page links to anonymous playback with no reward UI and no claim affordance anywhere in the DOM", async ({
    page,
  }) => {
    // Clicking Play attempts a real, network-loaded HLS fetch before the
    // start overlay clears; under full-suite parallel load that can take
    // longer than the default per-test budget (see earn-journey.spec.ts's
    // matching comment).
    test.slow();
    await page.goto(`/id/c/${BONUS_ACCURACY_CAMPAIGN_ID}`);

    // The honest, signed-in-facing facts (reused from CampaignEntryCard's
    // own formatters) are shown here — this is the page that is allowed to
    // show them, before the anonymous branch.
    await expect(page.getByText("Reward dasar", { exact: true })).toBeVisible();

    const watchAnonymouslyLink = page.getByRole("link", { name: "Tonton tanpa mendaftar" });
    await expect(watchAnonymouslyLink).toBeVisible();

    // Real click, not page.goto: proves the public page's secondary CTA
    // genuinely reaches Open Viewing for the SAME campaign.
    await watchAnonymouslyLink.click();
    await expect(page).toHaveURL(`/id/c/${BONUS_ACCURACY_CAMPAIGN_ID}/watch`);

    // Foregone-reward notice: honest and visible from the start, not a
    // ticking "you're missing X points right now" pressure counter.
    await expect(page.getByText(/Kamu menonton tanpa akun/)).toBeVisible();

    // The DOM-wide sweep: no claim affordance anywhere, in any form. This
    // deliberately checks broader than "the claim button is absent" — it
    // rules out a claim link, a hidden-but-present claim form, and any
    // stray reward-points figure a rewarded-path component might leak if
    // ever reused here by mistake.
    await expect(page.getByRole("button", { name: /klaim|claim/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /klaim|claim/i })).toHaveCount(0);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText.toLowerCase()).not.toContain("klaim");
    expect(bodyText.toLowerCase()).not.toMatch(/\bclaim\b/);

    // Real playback controls exist (this is genuine full playback, not a
    // teaser) — but no accrual/progress indicator, which is a
    // rewarded-only surface.
    await expect(page.getByRole("button", { name: /^Play /i })).toBeVisible();
    await expect(page.getByRole("list", { name: "Chapters" })).toBeVisible();

    // Starting playback must not summon any reward UI either — clicking
    // Play is real user interaction, not a shortcut past a step.
    await page.getByRole("button", { name: /^Play /i }).click();
    await expect(page.getByRole("button", { name: /^Play /i })).toBeHidden({ timeout: 20_000 });
    const bodyTextAfterPlay = await page.locator("body").innerText();
    expect(bodyTextAfterPlay.toLowerCase()).not.toContain("klaim");
    expect(bodyTextAfterPlay.toLowerCase()).not.toMatch(/\bclaim\b/);

    // UNVERIFIED (video blocker, see top comment): the sign-up prompt that
    // should appear at `session.hasEnded` (`OpenViewSignupPrompt`,
    // "Kamu sudah menonton video ini sampai selesai") never mounts in this
    // environment because the shared placeholder segment does not reach
    // the video's real `ended` event. Not asserted here — asserting it
    // would require dispatching a synthetic `ended` event, which is
    // exactly the "fake playback" this suite is instructed not to do.
  });
});
