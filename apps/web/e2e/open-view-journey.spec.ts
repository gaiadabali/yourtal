import { expect, test } from "@playwright/test";
import { findBonusAccuracyCampaign } from "./find-bonus-accuracy-campaign";

/**
 * Any campaign that shows a "Reward dasar" figure on its public entry page
 * proves this journey's seam; the accuracy-bonus property this shares with
 * earn-journey.spec.ts is not actually load-bearing here (open viewing shows
 * no reward UI at all past the anonymous playback link), but reusing the
 * same selection keeps this spec pointed at a real, checkpoint-bearing
 * long_form campaign rather than an arbitrary one, and — like
 * earn-journey.spec.ts — never breaks when the campaign generator's draw
 * order shifts.
 */
const BONUS_ACCURACY_CAMPAIGN_ID = findBonusAccuracyCampaign().id;

/**
 * YT-0450's first acceptance criterion, Open-view leg: a public page under
 * `/id/...` (`app/(public)/[locale]/`) -> anonymous full playback with no
 * reward UI and no claim affordance -> the sign-up prompt at the point a
 * rewarded viewer would have been paid.
 *
 * Shared Earn's video blocker: `OpenViewPlayer` reuses `useWatchSession`
 * (`features/player/use-watch-session.ts`) exactly like the rewarded
 * player, so `hasEnded` — the trigger for `OpenViewSignupPrompt`, YT-0432's
 * third criterion — needed the same real, network-loaded HLS segment to
 * reach its `ended` event. UNBLOCKED 2026-09-20 alongside earn-journey.spec.ts:
 * the player now plays a real 20-second local ladder to a genuine end, so
 * this test waits out that real playback and asserts the sign-up prompt
 * for real, rather than leaving it unverified.
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

    // Real playback, not a shortcut: wait out the actual ~20-second local
    // ladder to its genuine end (see earn-journey.spec.ts's top comment on
    // why this cannot be skipped with a seek), then assert the sign-up
    // interstitial YT-0432's third criterion names — the point a rewarded
    // viewer would have been paid, honestly named for an anonymous one
    // instead.
    // Scoped to the prompt's own `role="status"` container: the page also
    // has other, unrelated "Daftar…" links (top-level nav CTAs, an inline
    // "next video" nudge), so asserting a bare `getByRole("link", { name:
    // /daftar/i })` against the whole page is a strict-mode violation, not
    // proof of the interstitial's own CTA.
    const signupPrompt = page
      .getByRole("status")
      .filter({ hasText: "Kamu sudah menonton video ini sampai selesai" });
    await expect(
      signupPrompt,
      "playback reaching its real end must surface the open-view sign-up prompt",
    ).toBeVisible({ timeout: 45_000 });
    const signupLink = signupPrompt.getByRole("link", { name: /daftar|sign up/i });
    await expect(signupLink, "the interstitial must offer one next action: sign up").toBeVisible();

    // Still never a reward claim of its own — the interstitial's own body
    // must not leak claim language either.
    const bodyTextAfterEnded = await page.locator("body").innerText();
    expect(bodyTextAfterEnded.toLowerCase()).not.toContain("klaim");
    expect(bodyTextAfterEnded.toLowerCase()).not.toMatch(/\bclaim\b/);
  });
});
