import { describe, expect, it } from "vitest";
import { DEMO_OTP_CODE, isOtpCodeCorrect } from "./otp-mock-service";

describe("isOtpCodeCorrect", () => {
  it("accepts the documented demo code", () => {
    expect(isOtpCodeCorrect(DEMO_OTP_CODE)).toBe(true);
  });

  it("rejects any other code", () => {
    expect(isOtpCodeCorrect("000000")).toBe(false);
    expect(isOtpCodeCorrect("")).toBe(false);
  });

  it("tolerates surrounding whitespace from a fumbled paste", () => {
    expect(isOtpCodeCorrect(`  ${DEMO_OTP_CODE}  `)).toBe(true);
  });
});
