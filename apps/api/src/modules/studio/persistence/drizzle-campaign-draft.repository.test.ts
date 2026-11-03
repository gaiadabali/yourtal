import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStudioMediaDb } from "../media/persistence/drizzle-client";
import { createFixtureBusinessAndCampaign } from "../media/persistence/media-asset-db.test-helper";
import { DrizzleCampaignDraftRepository } from "./drizzle-campaign-draft.repository";

describe("DrizzleCampaignDraftRepository rename", () => {
  const url = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"] ?? "";
  const pool = new Pool({ connectionString: url });
  let businessId: string;
  let campaignId: string;
  let cleanup: () => Promise<void>;
  let repo: DrizzleCampaignDraftRepository;

  const chapterTitles = async () =>
    (
      await pool.query<{ title: string }>(
        "SELECT title FROM campaign.chapter WHERE campaign_id = $1 ORDER BY ordinal",
        [campaignId],
      )
    ).rows.map((row) => row.title);

  beforeAll(async () => {
    const fixture = await createFixtureBusinessAndCampaign(url);
    ({ businessId, campaignId, cleanup } = fixture);
    repo = new DrizzleCampaignDraftRepository(createStudioMediaDb(url));
    await pool.query(
      `INSERT INTO campaign.chapter (campaign_id, ordinal, title, start_seconds, reward_weight)
       VALUES ($1, 0, 'Test Campaign', 0, 1)`,
      [campaignId],
    );
  });

  afterAll(async () => {
    await pool.query("DELETE FROM campaign.chapter WHERE campaign_id = $1", [campaignId]);
    await cleanup();
    await pool.end();
  });

  it("renames the whole-video chapter with the campaign", async () => {
    await repo.update(businessId, campaignId, { title: "Renamed" });
    expect(await chapterTitles()).toEqual(["Renamed"]);
  });

  it("leaves a chapter the author has already retitled alone", async () => {
    await pool.query("UPDATE campaign.chapter SET title = 'My intro' WHERE campaign_id = $1", [
      campaignId,
    ]);
    await repo.update(businessId, campaignId, { title: "Renamed again" });
    expect(await chapterTitles()).toEqual(["My intro"]);
  });

  it("does not retitle when the campaign has several chapters", async () => {
    await pool.query(`UPDATE campaign.chapter SET title = 'Renamed again' WHERE campaign_id = $1`, [
      campaignId,
    ]);
    await pool.query(
      `INSERT INTO campaign.chapter (campaign_id, ordinal, title, start_seconds, reward_weight)
       VALUES ($1, 1, 'Second', 60, 1)`,
      [campaignId],
    );
    await repo.update(businessId, campaignId, { title: "Third name" });
    expect(await chapterTitles()).toEqual(["Renamed again", "Second"]);
    await pool.query("DELETE FROM campaign.chapter WHERE campaign_id = $1 AND ordinal = 1", [
      campaignId,
    ]);
  });

  it("never touches another business's campaign", async () => {
    await pool.query("UPDATE campaign.chapter SET title = 'Third name' WHERE campaign_id = $1", [
      campaignId,
    ]);
    // Matches the campaign's title, so only the business check can stop it.
    await pool.query("UPDATE campaign.campaigns SET title = 'Third name' WHERE id = $1", [
      campaignId,
    ]);
    const result = await repo.update("00000000-0000-4000-8000-000000000000", campaignId, {
      title: "Hijacked",
    });
    expect(result).toBeNull();
    expect(await chapterTitles()).toEqual(["Third name"]);
  });
});
