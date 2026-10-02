import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { REGIONS, apiRegister, useSession, type RegionCase } from "./demo";
import {
  callerFor,
  closeDb,
  db,
  demoBusinessId,
  demoCaller,
  msg,
  one,
  requireBusinessEnv,
  staffCaller,
} from "./business";

const STAFF = REGIONS[0];
const SECONDS = 75; // a minute or more is asked one question (questionsAskedFor)

/** A 75 s 1080p clip, so the ladder has something above 720p to cap. */
function sourceVideo(): string {
  const file = path.join(tmpdir(), "yourtal-j03-1080p-75s.mp4");
  if (!existsSync(file)) {
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc2=size=1920x1080:rate=25:duration=${SECONDS}`,
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${SECONDS}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "36",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      file,
    ]);
  }
  return file;
}

const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function addTrueFalse(page: Page, r: RegionCase, prompt: string) {
  await page.getByRole("button", { name: msg(r, "studio", "questionBank.addQuestion") }).click();
  const kind = msg(r, "studio", "questionBank.type.true_false.label").toLowerCase();
  await page
    .getByRole("button", {
      name: msg(r, "studio", "questionBank.addTypeButton").replace("{type}", kind),
    })
    .click();
  await page.getByLabel(msg(r, "studio", "questionBank.promptLabel")).fill(prompt);
  await page
    .getByRole("radio", { name: msg(r, "studio", "questionBank.trueFalse.true"), exact: true })
    .check();
  await page.getByRole("button", { name: msg(r, "studio", "questionBank.saveQuestion") }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

/**
 * Journey 3 (product-intent §2.2): the Marketer authors a campaign in Studio:
 * uploads a video (straight to object storage; the worker transcodes it to an
 * HLS ladder capped at 720p), writes the question bank, sets the reward from a
 * funded allocation with an accuracy bonus, targeting, schedule and Open View.
 * The automated screen refuses a blocked title; a moderator approves it in
 * the staff console and it goes live, in its own region only. Checks the
 * media, campaign, reward and question rows and the staff audit event.
 */
test.afterAll(closeDb);

for (const r of REGIONS) {
  test(`J3 ${r.region}: a marketer authors a campaign; screen, moderator, live`, async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(420_000);
    requireBusinessEnv();
    const marketer = await demoCaller(request, "member", r);
    const businessId = await demoBusinessId(marketer);
    const title = `Journey 3 ${r.region} ${Date.now().toString(36)}`;
    const t = (key: string) => msg(r, "studio", `campaignBuilder.${key}`);

    await useSession(page.context(), baseURL!, marketer.token, r);
    await page.goto(`/studio/campaigns?business=${businessId}`);
    const existing = new Set(
      (await marketer.get<{ id: string }[]>(`/api/${businessId}/studio/campaigns`)).map(
        (c) => c.id,
      ),
    );
    await page.getByRole("button", { name: t("list.newCampaign") }).click();
    await expect(page.getByLabel(t("details.titleLabel"), { exact: true })).toBeVisible();
    const created = (
      await marketer.get<{ id: string }[]>(`/api/${businessId}/studio/campaigns`)
    ).filter((c) => !existing.has(c.id));
    expect(created).toHaveLength(1);
    const campaignId = created[0]!.id;

    // Details: a title the automated screen will block, schedule, audience, Open View.
    await page.getByLabel(t("details.titleLabel"), { exact: true }).fill(`${title} sim-block-me`);
    await page
      .getByLabel(t("details.synopsisLabel"), { exact: true })
      .fill("Two coffees for one, all week.");
    await page
      .getByLabel(t("details.categoryLabel"), { exact: true })
      .selectOption("food-and-drink");
    await page.getByLabel(t("details.audienceLabel"), { exact: true }).selectOption("all_ages");
    await page.getByLabel(t("details.startsAtLabel"), { exact: true }).fill(isoDay(0));
    await page.getByLabel(t("details.endsAtLabel"), { exact: true }).fill(isoDay(30));
    await page.getByRole("switch", { name: t("details.openViewingLabel") }).click();

    // Video: straight to object storage; the worker transcodes it.
    await page.getByRole("tab", { name: t("sections.video") }).click();
    await page.getByLabel(t("upload.videoFileLabel"), { exact: true }).setInputFiles(sourceVideo());
    await expect(page.getByText(t("upload.statusReady"))).toBeVisible({ timeout: 240_000 });
    const media = await one<{ status: string; duration: number; hls: string; renditions: unknown }>(
      `SELECT status, duration_seconds AS duration, hls_url AS hls, rendition_bytes AS renditions
         FROM studio.media_assets WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [campaignId],
    );
    expect(media.status).toBe("ready");
    expect(media.duration).toBe(SECONDS);
    expect(Object.keys(media.renditions as object).sort()).toEqual(["v360", "v540", "v720"]);
    const master = await request.get(media.hls);
    if (master.ok()) {
      const heights = [...(await master.text()).matchAll(/RESOLUTION=\d+x(\d+)/g)].map((m) =>
        Number(m[1]),
      );
      expect(Math.max(...heights)).toBe(720);
    }

    // Targeting: a declared interest from the taxonomy.
    await page.getByRole("tab", { name: t("sections.targeting") }).click();
    await page
      .getByRole("button", { name: msg(r, "taxonomy", "node.coffee"), exact: true })
      .click();

    // Questions: 3 for the 1 asked (at least 3x), each passing the PII screen.
    await page.getByRole("tab", { name: t("sections.questions") }).click();
    for (const n of [1, 2, 3])
      await addTrueFalse(page, r, `The offer in the video is two for one (${n})?`);

    // Reward: from a funded allocation, with an accuracy bonus within 40%.
    await page.getByRole("tab", { name: t("sections.reward") }).click();
    const allocation = page.getByLabel(t("reward.allocationLabel"), { exact: true });
    await expect(allocation).toBeEnabled();
    // The newest partner allocation with room for this campaign.
    const funding = await marketer.get<{ allocationId: string; remainingPoints: number }[]>(
      `/api/${businessId}/studio/campaign-funding`,
    );
    const pick = funding.find((a) => a.remainingPoints >= 1_000);
    expect(pick, "the demo business has no funded points left").toBeDefined();
    await allocation.selectOption(pick!.allocationId);
    await page
      .getByLabel(t("reward.scoringRuleLabel"), { exact: true })
      .selectOption("base_plus_accuracy_bonus");
    await page.getByLabel(t("reward.rewardLabel"), { exact: true }).fill("5");
    await page.getByLabel(t("reward.accuracyBonusLabel"), { exact: true }).fill("2");
    await page.getByRole("button", { name: t("reward.saveReward") }).click();
    await expect(page.getByText(t("reward.rewardValueLabel"))).toBeVisible();

    // The automated screen refuses the blocked title; it stays a draft.
    await page.getByRole("button", { name: t("status.submitForReview") }).click();
    await expect(page.getByText(/content rules/)).toBeVisible();
    const blocked = await one<{ state: string; title: string }>(
      `SELECT lifecycle_state AS state, title FROM campaign.campaigns WHERE id = $1`,
      [campaignId],
    );
    expect(blocked).toEqual({ state: "draft", title: `${title} sim-block-me` });

    // Fixed, it goes to review; submit saved the details first.
    await page.getByRole("tab", { name: t("sections.details") }).click();
    await page.getByLabel(t("details.titleLabel"), { exact: true }).fill(title);
    await page.getByRole("button", { name: t("status.submitForReview") }).click();
    await expect
      .poll(
        async () =>
          (
            await one<{ state: string }>(
              `SELECT lifecycle_state AS state FROM campaign.campaigns WHERE id = $1`,
              [campaignId],
            )
          ).state,
        { timeout: 20_000 },
      )
      .toBe("in_review");
    await expect(
      page.getByText(t("status.label.in_review"), { exact: true }).first(),
    ).toBeVisible();
    const submitted = await one<{
      state: string;
      title: string;
      open_viewing: boolean;
      audience: string;
      interests: string[];
      region: string;
      reward_points: number;
      question_count: number;
      starts: string;
    }>(
      `SELECT lifecycle_state AS state, title, open_viewing, audience, declared_interests AS interests,
              region, reward_points, question_count, to_char(starts_at, 'YYYY-MM-DD') AS starts
         FROM campaign.campaigns WHERE id = $1`,
      [campaignId],
    );
    expect(submitted).toMatchObject({
      state: "in_review",
      title,
      open_viewing: true,
      audience: "all_ages",
      interests: ["coffee"],
      region: r.region,
    });
    const reward = await one<{ base: number; bonus: number; allocation: string }>(
      `SELECT reward_points_per_completion::int AS base, accuracy_bonus_points::int AS bonus, allocation_id AS allocation
         FROM campaign.reward_config WHERE campaign_id = $1`,
      [campaignId],
    );
    expect(reward).toEqual({ base: 5, bonus: 2, allocation: pick!.allocationId });
    const fundedBy = await one<{ funder: string; type: string }>(
      `SELECT funder_id AS funder, funder_type AS type FROM ledger.allocation WHERE id = $1`,
      [reward.allocation],
    );
    expect(fundedBy).toEqual({ funder: businessId, type: "partner" });
    const { rows: questions } = await db().query<{ status: string }>(
      `SELECT status FROM campaign.question WHERE campaign_id = $1`,
      [campaignId],
    );
    expect(questions).toHaveLength(3);

    // A moderator approves it in the staff console; it goes live.
    const moderator = await staffCaller(request, "moderator");
    await page.context().clearCookies();
    await useSession(page.context(), baseURL!, moderator.token, STAFF);
    await page.goto("/staff/moderation");
    const row = page.getByRole("row").filter({ hasText: title });
    await row.getByRole("button", { name: msg(STAFF, "staff", "moderation.approveCta") }).click();
    await page
      .getByLabel(msg(STAFF, "staff", "dialog.reasonLabel"))
      .fill("Creative and questions check out.");
    await page
      .getByRole("button", { name: msg(STAFF, "staff", "moderation.approveCampaignSubmit") })
      .click();
    await expect(page.getByText(title)).toHaveCount(0);
    const live = await one<{ state: string; published: boolean }>(
      `SELECT lifecycle_state AS state, published_at IS NOT NULL AS published FROM campaign.campaigns WHERE id = $1`,
      [campaignId],
    );
    expect(live).toEqual({ state: "live", published: true });
    const audit = await one<{ actor: string; reason: string }>(
      `SELECT actor_user_id AS actor, reason FROM staff.audit_event
        WHERE action = 'campaign_moderation.approve' AND target_id = $1`,
      [campaignId],
    );
    expect(audit).toEqual({ actor: moderator.userId, reason: "Creative and questions check out." });

    // Live in its own region, invisible from the other.
    const viewer = callerFor(request, await apiRegister(request, r, "j03-viewer"));
    const seen = await viewer.get<{
      id: string;
      openViewing: boolean;
      durationSeconds: number;
      chapters: unknown[];
      region: string;
    }>(`/api/campaigns/${campaignId}`);
    expect(seen).toMatchObject({
      id: campaignId,
      openViewing: true,
      durationSeconds: SECONDS,
      region: r.region,
    });
    expect(seen.chapters).toHaveLength(1);
    const other = REGIONS.find((x) => x.region !== r.region)!;
    const outsider = await apiRegister(request, other, "j03-outsider");
    const crossed = await request.get(
      `${process.env["JOURNEY_API_URL"]}/api/campaigns/${campaignId}`,
      {
        headers: { authorization: `Bearer ${outsider.token}` },
      },
    );
    expect([403, 404]).toContain(crossed.status());
  });
}
