import { describe, expect, it } from "vitest";
import { mapStudioErrorToHttpException } from "./to-http-exception";

interface Body {
  code: string;
  message: string;
  maxPoints?: number;
  durationSeconds?: number;
  hasBonus?: boolean;
  missing?: string[];
}

const bodyOf = (error: Parameters<typeof mapStudioErrorToHttpException>[0]) =>
  mapStudioErrorToHttpException(error).getResponse() as Body;

describe("reward_exceeds_ceiling (B4: the limit is per minute, so say this campaign's)", () => {
  const twentySeconds = {
    type: "reward_exceeds_ceiling",
    ceilingPointsPerMinute: 8,
    durationSeconds: 20,
    maxPoints: 2,
    hasBonus: false,
  } as const;

  it("states the limit for the video's length, not the per-minute figure", () => {
    const body = bodyOf(twentySeconds);
    expect(body.message).toBe(
      "A 20-second video can pay at most 2 points to each viewer. Lower the reward to 2 or less.",
    );
    expect(body.message).not.toMatch(/8-point/);
  });

  it("carries no internal code, and no accuracy bonus for a fixed reward", () => {
    const { message } = bodyOf(twentySeconds);
    expect(message).not.toMatch(/F14|ceiling|bonus/i);
  });

  it("mentions the bonus, and adds the two together, only when there is one", () => {
    expect(bodyOf({ ...twentySeconds, hasBonus: true, maxPoints: 1 }).message).toBe(
      "A 20-second video can pay at most 1 point to each viewer, reward and accuracy bonus together. Lower them so they add up to 1 or less.",
    );
  });

  it("gives the console the numbers to word it in the author's language", () => {
    expect(bodyOf(twentySeconds)).toMatchObject({
      code: "reward_exceeds_ceiling",
      maxPoints: 2,
      durationSeconds: 20,
      hasBonus: false,
    });
  });

  it("says a very short video cannot pay a reward", () => {
    expect(bodyOf({ ...twentySeconds, durationSeconds: 5, maxPoints: 0 }).message).toBe(
      "A 5-second video is too short to pay a reward.",
    );
  });

  it("speaks of minutes for a long video", () => {
    expect(bodyOf({ ...twentySeconds, durationSeconds: 1_200, maxPoints: 160 }).message).toMatch(
      /^A 20-minute video can pay at most 160 points/,
    );
  });
});

describe("campaign_not_ready", () => {
  it("is a 400 that lists each gap and the question counts", () => {
    const exception = mapStudioErrorToHttpException({
      type: "campaign_not_ready",
      missing: ["video", "questions"],
      message: "This campaign can't go to review yet.",
      questionsNeeded: 3,
      questionsHave: 1,
    });
    expect(exception.getStatus()).toBe(400);
    expect(exception.getResponse()).toMatchObject({
      code: "campaign_not_ready",
      missing: ["video", "questions"],
      questionsNeeded: 3,
      questionsHave: 1,
    });
  });
});
