import { afterEach, describe, expect, it } from "vitest";
import { measureOnboardingDuration, recordOnboardingMark } from "./onboarding-timing";

/**
 * jsdom (this suite's environment) cannot simulate a throttled network or
 * real wall-clock delay — see this module's own doc comment. What these
 * tests verify is the instrumentation contract itself: marks are recorded,
 * a measure between two real marks succeeds, a measure against a missing
 * mark degrades to `null` rather than throwing, and nothing here can ever
 * break the onboarding flow it observes.
 */
describe("onboarding timing instrumentation", () => {
  afterEach(() => {
    window.performance.clearMarks();
    window.performance.clearMeasures();
  });

  it("records a mark and measures a real duration between two marks", () => {
    recordOnboardingMark("signup-start");
    recordOnboardingMark("signup-complete");

    const duration = measureOnboardingDuration(
      "yourtal:test-signup",
      "signup-start",
      "signup-complete",
    );
    expect(typeof duration).toBe("number");
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it("returns null instead of throwing when a referenced mark was never recorded", () => {
    const duration = measureOnboardingDuration(
      "yourtal:test-missing",
      "interests-start",
      "interests-complete",
    );
    expect(duration).toBeNull();
  });

  it("never throws even if called before any DOM/window setup would normally exist", () => {
    expect(() => recordOnboardingMark("interests-start")).not.toThrow();
  });
});
