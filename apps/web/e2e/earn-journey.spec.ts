import { expect, test } from "@playwright/test";
import { findBonusAccuracyCampaign } from "./find-bonus-accuracy-campaign";

/**
 * A `long_form` campaign that actually scores `base_plus_accuracy_bonus`
 * AND has a scorable checkpoint question — selected by property, not
 * pinned by id (see find-bonus-accuracy-campaign.ts for why both
 * properties are needed). `zeroRewardCampaignFixture` (a named, fixed-id
 * fixture used elsewhere) is `scoringRule: "base_only"` and can never
 * demonstrate the checkpoint result screen's base-vs-bonus distinction,
 * which is YT-0450's first acceptance criterion for the Earn journey — so
 * this walks the generated catalogue for one that does. Any change to the
 * campaign generator's draw order can shuffle WHICH campaign this is
 * without ever invalidating the test, because the property being selected
 * for is the one the test actually depends on.
 */
const BONUS_ACCURACY_CAMPAIGN_ID = findBonusAccuracyCampaign().id;

/**
 * YT-0450's first acceptance criterion, Earn leg: `/` -> a campaign's entry
 * card -> `/watch/[id]` -> real playback to completion -> the checkpoint
 * hand-off -> a result distinguishing base reward from accuracy bonus.
 * Every step below is a real click through rendered UI — no `page.goto`
 * skips any step of the journey.
 *
 * UNBLOCKED 2026-09-20. Every campaign used to point at one shared public
 * HLS placeholder whose ~59 MB segment aborted before the `<video>` element
 * ever reported a finite `duration`, so `use-watch-session.ts`'s `hasEnded`
 * could never fire and `CompletionHandoff` — the component linking
 * `/watch/[id]` into `/watch/[id]/checkpoint` — could never mount. There
 * was no real click from the player to the checkpoint.
 *
 * The player now reads `campaign.videoSource` and plays a 20-second local
 * ladder with a finite duration, and — verified here — really does reach
 * `ended` and mount `CompletionHandoff` when played through in real time.
 * This closes the gap the previous version of this file's top comment
 * flagged as still open: the hand-off is driven by a real click on
 * "Continue to questions", not by navigating to the checkpoint directly.
 *
 * Note this is playback REACHING its end, not seeking to it —
 * keyboard-seek.spec.ts found that Chrome's `ended` event fires only when
 * playback naturally arrives at the end, not when a seek lands there, so
 * this test cannot shortcut the ~20 real seconds of playback with a seek.
 *
 * PREREQUISITE: `pnpm dev:up` and `pnpm media:publish` (or `pnpm dev:fresh`).
 * The fixture is served by the local MinIO origin, not from `public/`.
 */
test.describe("Earn journey", () => {
  test("home board's card reaches the entry card, whose terms and start action reach the same campaign's player, through real playback, into the checkpoint, to a result distinguishing base reward from accuracy bonus", async ({
    page,
  }) => {
    // Clicking Play attempts a real, network-loaded HLS fetch (see this
    // file's top comment) before the start overlay clears, and this test
    // then waits out ~20 real seconds of actual playback to reach `ended`
    // for real — under full-suite parallel load that is comfortably over
    // the default per-test budget, so this gets the standard 3x "slow"
    // allowance rather than a single long `expect` timeout eating the
    // whole test's clock.
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

    // Genuine evidence a user gesture reached `handlePlay`: the start
    // overlay clears once a real play attempt begins.
    await expect(
      playButton,
      "the start overlay should clear once a play attempt begins",
    ).toBeHidden({ timeout: 20_000 });

    // Real playback, not a shortcut: wait for the actual 20-second local
    // ladder to play through to its own end. The hand-off only mounts once
    // the `<video>` element fires a genuine `ended` event — seeking to the
    // end does not fire it (see this file's top comment) — so this really
    // is the video playing out, observed through its consequence.
    const continueLink = page.getByRole("link", { name: /Continue to questions/i });
    await expect(
      continueLink,
      "playback reaching its real end must hand off to the checkpoint",
    ).toBeVisible({ timeout: 45_000 });

    // Real click into the checkpoint — the seam this file's top comment
    // says was previously unreachable by any real click.
    await continueLink.click();
    await expect(page).toHaveURL(`/watch/${BONUS_ACCURACY_CAMPAIGN_ID}/checkpoint`);

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
