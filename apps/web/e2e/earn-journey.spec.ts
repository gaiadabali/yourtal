import { expect, test } from "@playwright/test";
import { BONUS_ACCURACY_CAMPAIGN_ID } from "./fixture-ids";

/**
 * YT-0450's first acceptance criterion, Earn leg: `/` -> a campaign's entry
 * card -> `/watch/[id]` -> the checkpoint -> a result distinguishing base
 * reward from accuracy bonus. Every step below is a real click through
 * rendered UI, never `page.goto` to skip a step, up to the point documented
 * as blocked.
 *
 * KNOWN BLOCKER (do not "fix" by faking playback): every campaign points at
 * one shared public HLS placeholder whose ~59 MB segment reliably aborts
 * before the `<video>` element ever reports a finite `duration`
 * (`features/player/video-source.ts`; the same reason `keyboard-seek.spec.ts`
 * is `test.fixme`). `use-watch-session.ts`'s `hasEnded` only ever becomes
 * true on the video's real `ended` event, so `CompletionHandoff` (the
 * component that links from `/watch/[id]` into `/watch/[id]/checkpoint`)
 * can never mount in this environment — there is no real click that gets
 * from the player to the checkpoint today. This suite proves everything
 * around that gap instead: the entry card's terms genuinely reach the
 * player for the same campaign, the player's own UI renders correctly, and
 * — reached directly, since the real handoff is unreachable — the
 * checkpoint quiz genuinely produces a result that distinguishes base
 * reward from accuracy bonus.
 */
test.describe("Earn journey", () => {
  test("home board's card reaches the entry card, whose terms and start action reach the same campaign's player", async ({
    page,
  }) => {
    // Clicking Play attempts a real, network-loaded HLS fetch (see this
    // file's top comment) before the start overlay clears; under full-suite
    // parallel load that can take longer than the default per-test budget,
    // so this test gets the standard 3x "slow" allowance rather than a
    // single long `expect` timeout eating the whole test's clock.
    test.slow();
    await page.goto("/?kind=long_form");

    const cardLink = page.locator(`a[href="/campaign/${BONUS_ACCURACY_CAMPAIGN_ID}"]`);
    await expect(cardLink, "the fixture campaign must be on the board").toBeVisible();
    const cardTitle = (await cardLink.textContent())?.trim();
    expect(cardTitle).toBeTruthy();

    // Real click, not page.goto: proves the board's stretched-link card
    // actually routes to this campaign's own entry card.
    await cardLink.click();
    await expect(page).toHaveURL(`/campaign/${BONUS_ACCURACY_CAMPAIGN_ID}`);

    const entryHeading = page.getByRole("heading", { level: 1 });
    await expect(entryHeading).toHaveText(cardTitle!);

    const baseRewardValue = await page
      .locator("dt", { hasText: "Reward dasar" })
      .locator("xpath=following-sibling::dd[1]")
      .textContent();
    const bonusValue = await page
      .locator("dt", { hasText: "Bonus akurasi" })
      .locator("xpath=following-sibling::dd[1]")
      .textContent();
    expect(baseRewardValue, "fixture must show a base reward").toBeTruthy();
    expect(
      bonusValue,
      "fixture must show an accuracy bonus (this is the whole point of using it)",
    ).toBeTruthy();

    const merchantName = await page.locator("p.text-xs.text-fg-subtle").first().textContent();

    // Real click into the player — this is the seam between the entry-card
    // agent's work and the player agent's work.
    await page.getByRole("link", { name: "Mulai video" }).click();
    await expect(page).toHaveURL(`/watch/${BONUS_ACCURACY_CAMPAIGN_ID}`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(cardTitle!);
    await expect(page.getByText(merchantName!.trim(), { exact: true })).toBeVisible();

    // Chapter track and accrual UI are the player's own acceptance surface
    // (YT-0412) — both must render regardless of whether real playback ever
    // starts, since they reflect chapter/reward structure computed from the
    // campaign, not from the video element.
    await expect(page.getByRole("list", { name: "Chapters" })).toBeVisible();
    await expect(page.getByRole("status").first()).toBeVisible();

    const playButton = page.getByRole("button", { name: `Play ${cardTitle}` });
    await expect(playButton).toBeVisible();
    await playButton.click();

    // BLOCKED HERE: clicking Play does start a real `<video>` load attempt
    // (this assertion — the overlay disappearing — is genuine evidence a
    // user gesture reached `handlePlay`), but the shared placeholder
    // segment does not reliably reach `loadedmetadata`/`ended` in this
    // environment, so neither real seeking nor the checkpoint hand-off via
    // `CompletionHandoff` can be driven from here. See this file's top
    // comment and the report for what that means for the acceptance
    // criterion.
    await expect(
      playButton,
      "the start overlay should clear once a play attempt begins",
    ).toBeHidden({ timeout: 20_000 });
  });

  test("the checkpoint quiz — reached directly since the real playback hand-off is blocked — produces a result distinguishing base reward from accuracy bonus", async ({
    page,
  }) => {
    await page.goto(`/watch/${BONUS_ACCURACY_CAMPAIGN_ID}/checkpoint`);

    // "Pertanyaan X dari N" tells us exactly how many questions to answer —
    // read once, up front, rather than guessing a loop bound.
    const progress = page.getByText(/^Pertanyaan \d+ dari \d+$/);
    await expect(progress).toBeVisible();
    const progressText = (await progress.textContent()) ?? "";
    const totalQuestions = Number(progressText.match(/dari (\d+)/)?.[1] ?? "0");
    expect(totalQuestions, "checkpoint must report how many questions it has").toBeGreaterThan(0);

    // Answer every question generically: click the first radio in whatever
    // radiogroup is rendered (covers multiple_choice/true_false/likert);
    // ranked auto-answers itself on mount; short_text is optional. Then
    // advance. This is real UI interaction, not a shortcut around the quiz.
    for (let questionNumber = 1; questionNumber <= totalQuestions; questionNumber += 1) {
      const nextButton = page.getByRole("button", { name: /^(Lanjut|Lihat hasil)$/ });
      await expect(nextButton).toBeVisible();
      const firstRadio = page.getByRole("radio").first();
      if (await firstRadio.isVisible().catch(() => false)) {
        await firstRadio.check();
      }
      await expect(nextButton).toBeEnabled();
      await nextButton.click();
    }

    await expect(page.getByRole("heading", { name: "Checkpoint selesai" })).toBeVisible();
    await expect(page.getByText("Reward dasar")).toBeVisible();
    await expect(page.getByText("Dijamin karena Anda menonton dan menjawab")).toBeVisible();

    // The whole point of using BONUS_ACCURACY_CAMPAIGN_ID: the result must
    // show a SEPARATE accuracy-bonus row, never folded into one number
    // (docs/tasks/phase-u-ui.md YT-0413) — a distinct heading, its own
    // correct/total/percent detail line, and its own points badge.
    await expect(page.getByText("Bonus akurasi")).toBeVisible();
    await expect(page.getByText(/% akurasi/)).toBeVisible();
    await expect(page.getByText("Total diterima")).toBeVisible();
  });
});
