import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Principal } from "@yourtal/authz/principal";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { coveredSeconds } from "@yourtal/contracts/watch/coverage";
import { createAppDb } from "../../shared/persistence/drizzle-client";
import { FakeLedgerClient } from "../../shared/ledger-client/fake-ledger-client";
import type {
  UserProfileRepository,
  StoredUserProfile,
} from "../identity/persistence/user-profile.repository";
import { DrizzleCampaignRepository } from "../campaign/persistence/drizzle-campaign.repository";
import { DrizzleWatchSessionRepository } from "./persistence/drizzle-watch-session.repository";
import { StubDeliveryCoverageReader } from "./delivery-coverage";
import { WatchController } from "./watch.controller";

/** A profile for whatever userId this suite invents — none of these are real registered accounts. */
class FakeProfiles implements UserProfileRepository {
  create(): Promise<void> {
    return Promise.resolve();
  }
  findByUserId(userId: string): Promise<StoredUserProfile | null> {
    return Promise.resolve({
      userId,
      region: "ID",
      displayLocale: "id-ID",
      displayName: "Test viewer",
      dateOfBirth: "1990-01-01",
      timezone: "Asia/Jakarta",
      guardianEmail: null,
      parentConsentStatus: "not_required",
      trustTier: 3,
      suspendedAt: null,
    });
  }
  update(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * The watch routes, against real Postgres and the seeded catalogue. YT-0553.
 *
 * The test that matters is the scrub: a client that reports one span at the
 * end and asks to complete is refused, by the server, on coverage. That is
 * decision O-4 enforced where a browser cannot argue with it — risk 43
 * exists because a player spec asserted the opposite and passed only
 * because Chrome declines to fire `ended` on a seek.
 */

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
 *
 * No literal fallback for either connection (YT-0571). `owner` used to be a
 * BARE `OWNER_URL` literal with no env read at all — the one connection in
 * this file that always hit the real dev `yourtal` regardless of which
 * database `db` was pointed at, invisible only because `with-test-db.mjs`
 * did not exist yet. `vitest.config.ts`'s `setupFiles` now refuses to run
 * this suite unless `DATABASE_URL`/`DATABASE_OWNER_URL` both name a
 * `yourtal_test_*` database, so reading them here is safe.
 */
const db = createAppDb(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]!);
const owner = createAppDb(process.env["DATABASE_OWNER_URL"]!);
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
const controller = new WatchController(
  principals,
  sessions,
  campaigns,
  new FakeLedgerClient(db),
  new FakeProfiles(),
  "test-attestation-secret-not-a-real-one",
  "test-checkpoint-secret-not-a-real-one",
  new StubDeliveryCoverageReader(),
);

let longFormId = "";
let durationSeconds = 0;
let otherCampaignId = "";

beforeAll(async () => {
  const visible = await campaigns.listVisible(50);
  const longForm = visible.find((campaign) => campaign.kind === "long_form");
  expect(longForm, "the seeded catalogue should contain a live long-form campaign").toBeDefined();
  longFormId = longForm?.id ?? "";
  durationSeconds = longForm?.durationSeconds ?? 0;

  const another = visible.find((campaign) => campaign.id !== longFormId);
  expect(another, "the seeded catalogue should contain a second live campaign").toBeDefined();
  otherCampaignId = another?.id ?? "";
});

/**
 * 5.1.b changes what `start()` on the SAME campaign does: it now reactivates
 * the one open session for (user, campaign, terms version) rather than
 * always minting a fresh one, so coverage recorded in an earlier test would
 * otherwise leak into the next one through session reuse. Each test in this
 * file wants a genuinely blank slate unless it says otherwise, so this wipes
 * every session between tests — owner, because the app role deliberately has
 * no DELETE on `watch.session` (a session is the record of an attempt, and
 * one that can be erased is not a record; the grant is the feature, and the
 * test works around it rather than widening it).
 */
beforeEach(async () => {
  await owner.execute(`DELETE FROM watch.session WHERE user_id = '${userId}'`);
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

  it("REACTIVATES the same session on a second start of the SAME campaign (5.1.b)", async () => {
    // Refusing would strand somebody who closed a tab, and creating a
    // second row (the old behaviour) would forfeit the first one's
    // coverage. Neither happens: the exact same open row comes back.
    const first = await controller.start(request, { campaignId: longFormId });
    const second = await controller.start(request, { campaignId: longFormId });

    expect(second.session.id).toBe(first.session.id);
    expect(second.session.state).toBe("active");
  });

  it("PARKS the first session (resumable) rather than superseding it, when a second campaign starts", async () => {
    const first = await controller.start(request, { campaignId: longFormId });
    await controller.progress(request, first.session.id, {
      fromSeconds: 0,
      toSeconds: 2,
      reportedAt: new Date().toISOString(),
    });

    const second = await controller.start(request, { campaignId: otherCampaignId });
    expect(second.session.id).not.toBe(first.session.id);
    expect((await sessions.findById(first.session.id))?.state).toBe("parked");
    expect((await sessions.findById(second.session.id))?.state).toBe("active");

    // Resuming the first campaign reactivates the SAME row and keeps its
    // coverage — the Check in 5.1.e.
    const resumed = await controller.start(request, { campaignId: longFormId });
    expect(resumed.session.id).toBe(first.session.id);
    expect(resumed.session.state).toBe("active");
    expect(coveredSeconds(await sessions.coverageFor(first.session.id))).toBe(2);
    expect((await sessions.findById(second.session.id))?.state).toBe("parked");
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
      [
        "complete",
        "constructor",
        "decideEarningOutcome",
        "loadOwnSession",
        "progress",
        "resume",
        "start",
      ].sort(),
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
