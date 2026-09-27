import { describe, expect, it } from "vitest";
import { ONBOARDING_STEPS, onboardingStepIndex } from "./onboarding-steps";

describe("onboarding step order", () => {
  it("is consent, interests, follow, done — always, even for a run that skips interests", () => {
    expect(ONBOARDING_STEPS).toEqual(["consent", "interests", "follow", "done"]);
  });

  it("indexes each step by its own key", () => {
    expect(onboardingStepIndex("consent")).toBe(0);
    expect(onboardingStepIndex("interests")).toBe(1);
    expect(onboardingStepIndex("follow")).toBe(2);
    expect(onboardingStepIndex("done")).toBe(3);
  });
});
