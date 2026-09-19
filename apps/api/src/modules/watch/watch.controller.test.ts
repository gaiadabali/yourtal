import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Principal } from "@yourtal/authz/principal";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { DrizzleCampaignRepository } from "../campaign/persistence/drizzle-campaign.repository";
import { DrizzleWatchSessionRepository } from "./persistence/drizzle-watch-session.repository";
import { WatchController } from "./watch.controller";

/**
 * The watch routes, against real Postgres and the seeded catalogue. YT-0553.
 *
 * The test that matters is the scrub: a client that reports one span at the
 * end and asks to complete is refused, by the server, on coverage. That is
 * decision O-4 enforced where a browser cannot argue with it — risk 43
 * exists because a player spec asserted the opposite and passed only
 * because Chrome declines to fire `ended` on a seek.
 */

const APP_URL = "postgres://yourtal_app:app_local_only@127.0.0.1:26432/yourtal";
const OWNER_URL = "postgres://yourtal:yourtal_local_only@127.0.0.1:26432/yourtal";

/**
 * `TEST_DATABASE_URL` first, matching `business-db.test-helper.ts`.
 *
 * Not a preference — it is what makes the wiring provable. `vitest.config.ts`
 * sets `env.DATABASE_URL`, and that OVERRIDES a value passed on the command
 * line, so pointing `DATABASE_URL` at a dead host proves nothing here: the
 * config quietly restores the working one and the suite passes either way.
 * I ran exactly that check and it came back green, which would have been a
 * false proof reported as a real one.
 *
 * `TEST_DATABASE_URL` is not set by the config, so it is the handle a
 * deliberate break can actually reach.
 */
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? APP_URL);
const owner = createAppDb(OWNER_URL);
const campaigns = new DrizzleCampaignRepository(db);
const sessions = new DrizzleWatchSessionRepository(db);

const userId = "00000000-0000-4000-8000-0000000f0001";
const principal: Principal = {
  id: userId,
  roles: ["user"],
  attr: { jurisdiction: "ID", businessRoles: {}, isSuspended: false },
};
const principals = { resolve: vi.fn().mockReturnValue(principal) };
const request = {} as FastifyRequest;
const controller = new WatchController(principals, sessions, campaigns);

let longFormId = "";
let durationSeconds = 0;

beforeAll(async () => {
  // Owner, because the app role deliberately has no DELETE on `watch.session`
  // — a session is the record of an attempt, and one that can be erased is
  // not a record. The grant is the feature; the test works around it rather
  // than widening it.
  await owner.execute(`DELETE FROM watch.session WHERE user_id = '${userId}'`);

  const visible = await campaigns.listVisible(50);
  const longForm = visible.find((campaign) => campaign.kind === "long_form");
  expect(longForm, "the seeded catalogue should contain a live long-form campaign").toBeDefined();
  longFormId = longForm?.id ?? "";
  durationSeconds = longForm?.durationSeconds ?? 0;
});

describe("campaign reads never leak the authoring state", () => {
  it("returns only campaigns a viewer may see", async () => {
    const visible = await campaigns.listVisible(50);
    expect(visible.length).toBeGreaterThan(0);
    for (const campaign of visible) {
      // `Campaign["status"]` has no value capable of expressing `draft`,
      // `in_review` or `rejected` — the leak is unrepresentable rather than
      // filtered, and this asserts the mapping actually happened.
      expect(["active", "paused", "ended"]).toContain(campaign.status);
    }
  });

  it("assembles chapters and a video source, so the row parses as a Campaign", async () => {
    // YT-0548 was exactly this failing silently for weeks, because nothing
    // ever read a campaign back out of Postgres.
    const campaign = await campaigns.findVisibleById(longFormId);
    expect(campaign?.videoSource.manifestUrl).toContain("http");
    expect(campaign?.chapters.length).toBeGreaterThan(0);
  });

  it("does not find a campaign that is not public", async () => {
    expect(await campaigns.findVisibleById(randomUUID())).toBeNull();
  });
});

describe("starting a watch session", () => {
  it("creates one against the campaign's current terms", async () => {
    const started = await controller.start(request, { campaignId: longFormId });
    expect(started.session.state).toBe("active");
    expect(started.session.termsVersion).toBeGreaterThanOrEqual(1);
    expect(started.durationSeconds).toBe(durationSeconds);
  });

  it("supersedes the previous session rather than refusing a second", async () => {
    // Refusing would strand somebody who closed a tab. The old attempt is
    // kept, not deleted — its coverage is evidence.
    const first = await controller.start(request, { campaignId: longFormId });
    const second = await controller.start(request, { campaignId: longFormId });

    expect(second.session.id).not.toBe(first.session.id);
    expect((await sessions.findById(first.session.id))?.state).toBe("superseded");
    expect((await sessions.findById(second.session.id))?.state).toBe("active");
  });

  it("refuses a campaign that does not exist", async () => {
    await expect(controller.start(request, { campaignId: randomUUID() })).rejects.toThrow(
      /No such campaign/,
    );
  });
});

describe("progress reports are judged by the server's clock", () => {
  it("accepts a span that fits in the elapsed time", async () => {
    const started = await controller.start(request, { campaignId: longFormId });
    const result = await controller.progress(request, started.session.id, {
      fromSeconds: 0,
      toSeconds: 2,
      reportedAt: new Date().toISOString(),
    });
    expect(result.accepted).toBe(true);
    expect(result.coveredSeconds).toBe(2);
  });

  it("REFUSES more playback than wall-clock time has passed", async () => {
    // The check that needs no client cooperation. A session started a
    // moment ago cannot have played the whole video.
    //
    // The span is the campaign's full duration rather than an arbitrary 600
    // seconds: the bounds check runs first, so a larger number would be
    // refused as past-the-end and this would pass for the wrong reason —
    // proving the wrong guard.
    const started = await controller.start(request, { campaignId: longFormId });
    await expect(
      controller.progress(request, started.session.id, {
        fromSeconds: 0,
        toSeconds: durationSeconds,
        reportedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/Impossible at 1x/);
  });

  it("REFUSES a position past the end of the campaign", async () => {
    const started = await controller.start(request, { campaignId: longFormId });
    await expect(
      controller.progress(request, started.session.id, {
        fromSeconds: 0,
        toSeconds: durationSeconds + 500,
        reportedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow(/past the campaign/);
  });

  it("ignores the client's own timestamp", async () => {
    // `reportedAt` an hour in the future must not widen the window the
    // server measures against. If it did, a client could claim any span.
    const started = await controller.start(request, { campaignId: longFormId });
    await expect(
      controller.progress(request, started.session.id, {
        fromSeconds: 0,
        toSeconds: durationSeconds,
        reportedAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ).rejects.toThrow(/Impossible at 1x/);
  });
});

describe("completion is decided by coverage, not by the client", () => {
  it("REFUSES a scrub to the end", async () => {
    // THE test. The client reports one short span at the very end — exactly
    // what dragging a seek bar produces — and asks to complete. The server
    // reads what was actually covered and refuses, naming the gap.
    const started = await controller.start(request, { campaignId: longFormId });
    await controller.progress(request, started.session.id, {
      fromSeconds: durationSeconds - 2,
      toSeconds: durationSeconds,
      reportedAt: new Date().toISOString(),
    });

    await expect(controller.complete(request, started.session.id)).rejects.toThrow(
      /have not been watched/,
    );
  });

  it("REFUSES a session with no coverage at all", async () => {
    const started = await controller.start(request, { campaignId: longFormId });
    await expect(controller.complete(request, started.session.id)).rejects.toThrow(
      new RegExp(`${String(durationSeconds)}s of the video have not been watched`),
    );
  });

  it("has no endpoint that accepts a claim of completion", () => {
    // Stated as an assertion so it cannot be added quietly later. Every
    // method either reports observed playback or asks a question; none
    // takes a "finished" flag.
    const methods = Object.getOwnPropertyNames(WatchController.prototype);
    expect(methods.sort()).toStrictEqual(
      ["complete", "constructor", "loadOwnSession", "progress", "resume", "start"].sort(),
    );
  });
});

describe("a session belongs to one user", () => {
  it("reports someone else's session as missing, not forbidden", async () => {
    // A 403 would confirm the id exists.
    const started = await controller.start(request, { campaignId: longFormId });
    principals.resolve.mockReturnValueOnce({ ...principal, id: randomUUID() });

    await expect(controller.resume(request, started.session.id)).rejects.toThrow(
      /No such watch session/,
    );
  });
});
