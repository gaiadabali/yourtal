import { randomUUID } from "node:crypto";
import type { Campaign } from "@yourtal/contracts/campaign";
import { NotFoundException } from "@nestjs/common";
import { beforeAll, describe, expect, it } from "vitest";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { CampaignController } from "./campaign.controller";
import type { CampaignRepository } from "./persistence/campaign.repository";
import { DrizzleCampaignRepository } from "./persistence/drizzle-campaign.repository";

/**
 * `CampaignController`. YT-0553.
 *
 * ## Why this file exists
 *
 * The campaign routes shipped with no test of any kind while the watch half
 * shipped with fourteen. `watch.controller.test.ts` does cover the
 * REPOSITORY — visible states, assembly, a missing id — but nothing anywhere
 * constructed a `CampaignController`. So the two things the controller adds
 * on top of the repository were asserted by nobody:
 *
 *   1. the `limit` clamp, which the code itself calls a denial-of-service
 *      guard requiring no authentication, and
 *   2. the deliberate 404 for a campaign that EXISTS but is not public.
 *
 * Both read as obviously correct. That is the problem: this project's
 * recurring failure (docs/13c) is a control that was built, reviewed and
 * then never exercised, and a route proved only by reading it is one step
 * weaker again. Found by `yourtal-24` auditing YT-0553 on 2026-09-20.
 *
 * ## Proved by breaking it, and the second attempt is the instructive one
 *
 * Removing the `Math.min` clamp turns exactly the two clamp tests red.
 *
 * The draft tests took three tries, and the failures were mine, not theirs.
 * Adding `draft` to `VISIBLE_STATES` alone: still green. Making
 * `publicStatusOf` return `active` for a draft alone: still green. **A
 * campaign that is not public is hidden by TWO independent controls, and
 * either one alone is sufficient** — the repository filters `draft` out in
 * SQL, so `publicStatusOf` never sees it; and `publicStatusOf` returns
 * `undefined`, so `assemble` drops the row even if the SQL lets it through.
 * Each masks the other, so a single-point sabotage cannot move these tests.
 *
 * Breaking BOTH at once turns exactly the three draft tests red. So they do
 * discriminate — but on the composite guarantee, not on either layer.
 *
 * **Worth knowing before you trust a green here.** Defence in depth is the
 * right design and nothing below argues otherwise. But it means a future
 * change that removes ONE belt leaves this file green while halving the
 * protection, and the convention in this repo is to prove a control by
 * breaking it. If you delete one of the two, the honest move is to add a
 * test that pins the remaining one directly rather than reading this green
 * as cover.
 */

/**
 * `TEST_DATABASE_URL` first, for the reason `watch.controller.test.ts` gives
 * at length: `vitest.config.ts` sets `env.DATABASE_URL`, which OVERRIDES a
 * value passed on the command line, so a sabotage aimed at `DATABASE_URL`
 * comes back green and reads as proof of the opposite. That is YT-0558.
 * `TEST_DATABASE_URL` is the handle a deliberate break can actually reach.
 *
 * YT-0547: `owner` used to be the bare `OWNER_URL` literal, unconditionally
 * — the one connection in this file that did NOT read an override. That was
 * invisible for as long as every package's tests shared one real database,
 * because the literal and `db`'s fallback pointed at the same place anyway.
 * It stopped being invisible the moment `db` started following
 * `TEST_DATABASE_URL` into `yourtal_test_api`
 * (`packages/db/scripts/with-test-db.mjs`) while `owner` kept writing the
 * `beforeAll` fixture into the real `yourtal` instead: the THIRD test below
 * flips this row to `live` and reads it back through `db`, and a write that
 * landed in a different database is indistinguishable from a write that
 * never happened — the controller correctly 404s a row it never received.
 * `DATABASE_OWNER_URL` is the same override `store-db.test-helper.ts` and
 * `with-test-db.mjs` already use for exactly this connection.
 *
 * YT-0571: no literal fallback for either anymore — `vitest.config.ts`'s
 * `setupFiles` already refuses to run this suite unless both name a
 * `yourtal_test_*` database, so `DATABASE_URL`/`DATABASE_OWNER_URL` are as
 * safe a fallback as the literals used to be, without being a real dev URL.
 */
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
const owner = createAppDb(process.env["DATABASE_OWNER_URL"]!);
const campaigns = new DrizzleCampaignRepository(db);
const controller = new CampaignController(campaigns);

/**
 * Records the limit it was handed and returns nothing.
 *
 * The clamp is arithmetic on an untrusted string, so the assertion that
 * matters is "what number reached the repository", and a real database
 * cannot answer that — asking for 1,000,000 rows from a seeded catalogue of
 * a few dozen returns the same rows as asking for 100, and the test would
 * pass with the clamp deleted.
 */
class LimitRecordingRepository implements CampaignRepository {
  public lastLimit: number | null = null;

  // Not `async`: these have nothing to await, and `require-await` is right
  // to say so. The interface returns promises, so they resolve explicitly.
  listVisible(limit: number): Promise<Campaign[]> {
    this.lastLimit = limit;
    return Promise.resolve([]);
  }
  findVisibleById(): Promise<Campaign | null> {
    return Promise.resolve(null);
  }
  currentTermsVersion(): Promise<number | null> {
    return Promise.resolve(null);
  }
  isLive(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

/** A draft that is complete in every other respect. Assembled in `beforeAll`. */
const draftId = randomUUID();
const merchantId = randomUUID();

beforeAll(async () => {
  // Owner, because the app role has no INSERT on the authoring tables — that
  // grant boundary is the point of YT-0554 and this test works around it
  // rather than widening it.
  await owner.execute(`DELETE FROM campaign.video_source WHERE campaign_id = '${draftId}'`);
  await owner.execute(`DELETE FROM campaign.campaigns WHERE id = '${draftId}'`);

  await owner.execute(`
    INSERT INTO campaign.campaigns (
      id, kind, title, merchant_id, merchant_name, synopsis,
      duration_seconds, estimated_data_mb, reward_points, question_count,
      scoring_rule, lifecycle_state, published_at
    ) VALUES (
      '${draftId}', 'quick', 'Unpublished draft', '${merchantId}', 'A Merchant',
      'Should never reach a viewer.', 30, 1.5, 100, 0,
      'base_only', 'draft', now()
    )`);

  // Given a video source too, so that when this row is later flipped to
  // `live` it genuinely serves. Without that, a 404 proves only that the
  // row was unparseable — which is a different bug with the same symptom.
  await owner.execute(`
    INSERT INTO campaign.video_source (campaign_id, kind, manifest_url)
    VALUES ('${draftId}', 'hls', 'http://localhost:9000/test/draft.m3u8')`);
});

describe("the limit is clamped, because it is an unauthenticated cost", () => {
  it("defaults when absent", async () => {
    const repo = new LimitRecordingRepository();
    await new CampaignController(repo).list(undefined);
    expect(repo.lastLimit).toBe(30);
  });

  it("CLAMPS a caller asking for a million rows", async () => {
    const repo = new LimitRecordingRepository();
    await new CampaignController(repo).list("1000000");
    // The whole point of the guard. Delete the `Math.min` and this is the
    // only test in the repository that goes red.
    expect(repo.lastLimit).toBe(100);
  });

  it("raises a zero or negative limit to one, rather than passing it through", async () => {
    const repo = new LimitRecordingRepository();
    await new CampaignController(repo).list("0");
    expect(repo.lastLimit).toBe(1);

    const negative = new LimitRecordingRepository();
    await new CampaignController(negative).list("-5");
    expect(negative.lastLimit).toBe(1);
  });

  it("falls back to the default for a limit that is not a number", async () => {
    const repo = new LimitRecordingRepository();
    await new CampaignController(repo).list("; DROP TABLE campaigns");
    expect(repo.lastLimit).toBe(30);
  });

  it("returns the list under a `campaigns` key", async () => {
    const result = await controller.list(undefined);
    expect(Array.isArray(result.campaigns)).toBe(true);
  });
});

describe("a campaign that is not public is reported as missing, not as forbidden", () => {
  it("404s a draft that exists", async () => {
    // Distinguishing "no such campaign" from "not published yet" would tell
    // an outsider that a draft with this id exists, which is a disclosure
    // dressed as helpfulness. The existing repository test only covers a
    // random uuid — that proves the missing case and says nothing about
    // this one.
    await expect(controller.get(draftId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("gives a draft and a genuinely absent campaign the SAME answer", async () => {
    const forDraft = await controller.get(draftId).catch((error: unknown) => error);
    const forMissing = await controller.get(randomUUID()).catch((error: unknown) => error);

    expect(String(forDraft)).toBe(String(forMissing));
  });

  it("serves the very same row once it is live, so the 404 was about state", async () => {
    // Without this, every assertion above would also pass on a row that was
    // simply malformed, and the test would be proving the wrong mechanism.
    await owner.execute(
      `UPDATE campaign.campaigns SET lifecycle_state = 'live' WHERE id = '${draftId}'`,
    );
    try {
      const served = await controller.get(draftId);
      expect(served.id).toBe(draftId);
      // The authoring state is unrepresentable in the response type, so the
      // derived status is what a viewer sees.
      expect(["active", "paused", "ended"]).toContain(served.status);
    } finally {
      await owner.execute(
        `UPDATE campaign.campaigns SET lifecycle_state = 'draft' WHERE id = '${draftId}'`,
      );
    }
  });

  it("keeps the draft off the list as well as out of a direct read", async () => {
    const { campaigns: listed } = await controller.list("100");
    expect(listed.map((campaign) => campaign.id)).not.toContain(draftId);
  });
});
