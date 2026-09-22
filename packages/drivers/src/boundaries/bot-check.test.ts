import { describe, expect, it } from "vitest";
import { SIMULATED_BOT_TOKENS, createSimulatedBotCheck } from "./bot-check";

/**
 * YT-0538, criterion 1: bot check returns pass, fail and expired-token, and
 * the verify step is real code even when the token is simulated.
 *
 * `registry.test.ts` already proves the three named tokens answer correctly.
 * What is added here is the adversarial half of "real code": a verify step
 * that merely recognised three magic strings and defaulted everything else
 * to a pass would satisfy that test too. These prove the default is a
 * REFUSAL, and that near-misses of the real tokens do not get treated as
 * the real thing.
 */

describe("the verify step is real code, not three strings and a default pass", () => {
  it("rejects a token that only LOOKS like the pass token", async () => {
    const driver = createSimulatedBotCheck();
    const verdict = (await driver.verify(`${SIMULATED_BOT_TOKENS.pass}-tampered`))._unsafeUnwrap();
    expect(verdict).toStrictEqual({ passed: false, reason: "malformed_token" });
  });

  it("rejects the empty string rather than defaulting to pass", async () => {
    const driver = createSimulatedBotCheck();
    const verdict = (await driver.verify(""))._unsafeUnwrap();
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toBe("malformed_token");
  });

  it("rejects a token from a DIFFERENT boundary's vocabulary, not just gibberish", async () => {
    const driver = createSimulatedBotCheck();
    // A string that is a plausible token shape, just not one this boundary issued.
    const verdict = (await driver.verify("otp_1"))._unsafeUnwrap();
    expect(verdict).toStrictEqual({ passed: false, reason: "malformed_token" });
  });

  it("answers pass, fail and expired-token by causing each, not by configuring one", async () => {
    const driver = createSimulatedBotCheck();
    const pass = (await driver.verify(SIMULATED_BOT_TOKENS.pass))._unsafeUnwrap();
    const fail = (await driver.verify(SIMULATED_BOT_TOKENS.fail))._unsafeUnwrap();
    const expired = (await driver.verify(SIMULATED_BOT_TOKENS.expired))._unsafeUnwrap();

    expect(pass).toStrictEqual({ passed: true, reason: "human" });
    expect(fail).toStrictEqual({ passed: false, reason: "failed_challenge" });
    expect(expired).toStrictEqual({ passed: false, reason: "expired_token" });
  });

  it("a failed or expired challenge is a real ANSWER (ok), never an outage (err)", async () => {
    const driver = createSimulatedBotCheck();
    const fail = await driver.verify(SIMULATED_BOT_TOKENS.fail);
    const expired = await driver.verify(SIMULATED_BOT_TOKENS.expired);
    // A caller that only checks for a thrown/err outage on a bot would wave
    // the bot through — this is the case that catches that caller.
    expect(fail.isOk()).toBe(true);
    expect(expired.isOk()).toBe(true);
  });
});
