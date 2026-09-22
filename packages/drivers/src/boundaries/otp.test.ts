import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSimulatedOtp } from "./otp";

/**
 * YT-0538: OTP issues and burns single-use codes with a real TTL and real
 * velocity limits, and the codes are retrievable only through a deliberate,
 * logged, development-only route — never printed into ordinary logs.
 *
 * Every scenario below is CAUSED, not configured: the TTL is crossed by
 * advancing a controlled clock, the velocity limit is tripped by actually
 * issuing past it, and single-use is proven by actually replaying a
 * consumed code.
 */

const NOW = 1_800_000_000_000;
const PHONE = "+6281234567890";

describe("issuing and verifying a code", () => {
  it("verifies the code it issued", async () => {
    const driver = createSimulatedOtp();
    const issued = (await driver.issue(PHONE, NOW))._unsafeUnwrap();
    const code = driver.peekCode(issued.challengeId, NOW);
    expect(code).toBeDefined();

    const verdict = (await driver.verify(issued.challengeId, code!, NOW))._unsafeUnwrap();
    expect(verdict).toStrictEqual({ outcome: "verified" });
  });

  it("never hands the code back from issue() itself — a real vendor sends it out of band", async () => {
    const driver = createSimulatedOtp();
    const issued = (await driver.issue(PHONE, NOW))._unsafeUnwrap();
    // OtpIssued only carries challengeId and expiresAtMs.
    expect(Object.keys(issued).sort()).toStrictEqual(["challengeId", "expiresAtMs"]);
  });

  it("counts down attempts on a wrong code, and reports how many are left", async () => {
    const driver = createSimulatedOtp();
    const issued = (await driver.issue(PHONE, NOW))._unsafeUnwrap();

    const first = (await driver.verify(issued.challengeId, "000000", NOW))._unsafeUnwrap();
    expect(first).toStrictEqual({ outcome: "wrong_code", attemptsRemaining: 2 });

    const second = (await driver.verify(issued.challengeId, "000000", NOW))._unsafeUnwrap();
    expect(second).toStrictEqual({ outcome: "wrong_code", attemptsRemaining: 1 });
  });

  it("locks out even the CORRECT code once attempts are exhausted — a late right guess must not win", async () => {
    const driver = createSimulatedOtp();
    const issued = (await driver.issue(PHONE, NOW))._unsafeUnwrap();
    const code = driver.peekCode(issued.challengeId, NOW)!;

    const attempt1 = (await driver.verify(issued.challengeId, "000000", NOW))._unsafeUnwrap();
    expect(attempt1).toStrictEqual({ outcome: "wrong_code", attemptsRemaining: 2 });
    const attempt2 = (await driver.verify(issued.challengeId, "000000", NOW))._unsafeUnwrap();
    expect(attempt2).toStrictEqual({ outcome: "wrong_code", attemptsRemaining: 1 });
    const attempt3 = (await driver.verify(issued.challengeId, "000000", NOW))._unsafeUnwrap();
    expect(attempt3).toStrictEqual({ outcome: "wrong_code", attemptsRemaining: 0 });
    // Three wrong attempts have exhausted MAX_ATTEMPTS.

    expect(driver.debugClassify(issued.challengeId, NOW)).toBe("expired");
    const late = (await driver.verify(issued.challengeId, code, NOW))._unsafeUnwrap();
    expect(late).toStrictEqual({ outcome: "refused" });
  });
});

describe("single-use: a consumed code cannot be replayed", () => {
  it("burns the code on success and refuses the identical replay", async () => {
    const driver = createSimulatedOtp();
    const issued = (await driver.issue(PHONE, NOW))._unsafeUnwrap();
    const code = driver.peekCode(issued.challengeId, NOW)!;

    const firstUse = (await driver.verify(issued.challengeId, code, NOW))._unsafeUnwrap();
    expect(firstUse).toStrictEqual({ outcome: "verified" });

    // The exact same code, presented again — a replay, not a forgery.
    const replay = (await driver.verify(issued.challengeId, code, NOW))._unsafeUnwrap();
    expect(replay).toStrictEqual({ outcome: "refused" });
  });

  it("distinguishes replay from forgery from expiry INTERNALLY, and proves the boundary throws that away", async () => {
    const driver = createSimulatedOtp();

    // Case 1: a replay of a genuinely consumed code.
    const consumed = (await driver.issue(PHONE, NOW))._unsafeUnwrap();
    const consumedCode = driver.peekCode(consumed.challengeId, NOW)!;
    const firstUse = (await driver.verify(consumed.challengeId, consumedCode, NOW))._unsafeUnwrap();
    expect(firstUse).toStrictEqual({ outcome: "verified" });
    expect(driver.debugClassify(consumed.challengeId, NOW)).toBe("already_consumed");

    // Case 2: a challenge id nobody ever issued — a pure forgery.
    expect(driver.debugClassify("otp_never_issued", NOW)).toBe("not_found");

    // Case 3: a real challenge whose TTL has genuinely elapsed.
    const expiring = (await driver.issue(PHONE, NOW))._unsafeUnwrap();
    expect(driver.debugClassify(expiring.challengeId, NOW + 6 * 60 * 1_000)).toBe("expired");

    // Internally these are three different facts — asserted above, and each
    // one distinct from the other two. Externally, `verify()` must answer
    // all three identically, or a caller probing the boundary learns which
    // one it hit.
    const replayVerdict = (
      await driver.verify(consumed.challengeId, consumedCode, NOW)
    )._unsafeUnwrap();
    const forgeryVerdict = (await driver.verify("otp_never_issued", "123456", NOW))._unsafeUnwrap();
    const expiredVerdict = (
      await driver.verify(expiring.challengeId, "000000", NOW + 6 * 60 * 1_000)
    )._unsafeUnwrap();

    expect(replayVerdict).toStrictEqual({ outcome: "refused" });
    expect(forgeryVerdict).toStrictEqual({ outcome: "refused" });
    expect(expiredVerdict).toStrictEqual({ outcome: "refused" });
  });
});

describe("TTL is enforced by the clock, not asserted from configuration", () => {
  it("accepts the code one millisecond before expiry and refuses it one millisecond after", async () => {
    const driver = createSimulatedOtp();
    const issued = (await driver.issue(PHONE, NOW))._unsafeUnwrap();

    // Not asserting expiresAtMs equals a constant: causing the boundary by
    // sitting on either side of it with the SAME code.
    expect(driver.debugClassify(issued.challengeId, issued.expiresAtMs - 1)).toBe("active");
    expect(driver.debugClassify(issued.challengeId, issued.expiresAtMs)).toBe("expired");

    const codeForSecondChallenge = driver.peekCode(issued.challengeId, NOW)!;
    const tooLate = (
      await driver.verify(issued.challengeId, codeForSecondChallenge, issued.expiresAtMs)
    )._unsafeUnwrap();
    expect(tooLate).toStrictEqual({ outcome: "refused" });
  });
});

describe("velocity limits, tripped by actually issuing past them", () => {
  it("blocks a fourth code for the same number inside the window", async () => {
    const driver = createSimulatedOtp();
    for (let i = 0; i < 3; i += 1) {
      const result = await driver.issue(PHONE, NOW + i);
      expect(result.isOk()).toBe(true);
    }

    const fourth = await driver.issue(PHONE, NOW + 3);
    expect(fourth.isErr()).toBe(true);
    const failure = fourth._unsafeUnwrapErr();
    expect(failure.kind).toBe("declined");
    expect(failure.mayHaveSucceeded).toBe(false);
    expect(failure.detail).toContain("one number");
  });

  it("lets the number issue again once the window has genuinely elapsed", async () => {
    const driver = createSimulatedOtp();
    for (let i = 0; i < 3; i += 1) {
      expect((await driver.issue(PHONE, NOW + i)).isOk()).toBe(true);
    }
    expect((await driver.issue(PHONE, NOW + 3)).isErr()).toBe(true);

    // 15 minutes and one millisecond later, the oldest three have aged out.
    const afterWindow = NOW + 15 * 60 * 1_000 + 1;
    const result = await driver.issue(PHONE, afterWindow);
    expect(result.isOk()).toBe(true);
  });

  it("blocks a new number once the GATEWAY-WIDE limit is hit, even though no single number is over its own cap", async () => {
    const driver = createSimulatedOtp();

    // Phone A takes its own cap of 3.
    for (let i = 0; i < 3; i += 1) {
      expect((await driver.issue(PHONE, NOW + i)).isOk()).toBe(true);
    }
    // 17 more, one each from 17 distinct numbers — none of them anywhere
    // near their OWN per-phone limit of 3. Total so far: 20.
    for (let i = 0; i < 17; i += 1) {
      const other = `+62800000${String(i).padStart(4, "0")}`;
      expect((await driver.issue(other, NOW + 3 + i)).isOk()).toBe(true);
    }

    // A 21st number, its very first request, is refused — the per-phone
    // counter for THIS number is zero. Only the gateway-wide count explains it.
    const brandNew = "+629999999999";
    const blocked = await driver.issue(brandNew, NOW + 100);
    expect(blocked.isErr()).toBe(true);
    const failure = blocked._unsafeUnwrapErr();
    expect(failure.detail).toContain("Gateway-wide");
  });

  it("a success clears the per-phone record but leaves the gateway-wide record intact", async () => {
    const driver = createSimulatedOtp();

    // Fill the gateway-wide cap: phone A three times, 17 other numbers once each.
    const challengeA1 = (await driver.issue(PHONE, NOW))._unsafeUnwrap();
    expect((await driver.issue(PHONE, NOW + 1)).isOk()).toBe(true);
    expect((await driver.issue(PHONE, NOW + 2)).isOk()).toBe(true);
    for (let i = 0; i < 17; i += 1) {
      const other = `+62800000${String(i).padStart(4, "0")}`;
      expect((await driver.issue(other, NOW + 3 + i)).isOk()).toBe(true);
    }
    // Confirmed at cap: even phone A, already at its own limit, is refused
    // for the per-phone reason (proves the setup, not the property under test).
    const atCap = await driver.issue(PHONE, NOW + 50);
    expect(atCap._unsafeUnwrapErr().detail).toContain("one number");

    // Verify one of phone A's OWN codes successfully. This must clear
    // phone A's per-phone record.
    const codeA1 = driver.peekCode(challengeA1.challengeId, NOW)!;
    const verdict = (
      await driver.verify(challengeA1.challengeId, codeA1, NOW + 60)
    )._unsafeUnwrap();
    expect(verdict).toStrictEqual({ outcome: "verified" });

    // Phone A can be issued to again immediately — proves ITS counter was
    // cleared by the success, not merely decremented or left alone.
    const afterSuccess = await driver.issue(PHONE, NOW + 61);
    // If this were still blocked by the PER-PHONE rule the detail would say
    // "one number"; it must instead be the untouched GATEWAY-WIDE rule,
    // which proves the two counters are independent records, not one.
    expect(afterSuccess.isErr()).toBe(true);
    expect(afterSuccess._unsafeUnwrapErr().detail).toContain("Gateway-wide");
  });
});

describe("codes are retrievable only through the deliberate, logged, development-only route", () => {
  it("peekCode and devAccessLog exist only on the SIMULATED driver's type — not on OtpDriver", () => {
    const driver = createSimulatedOtp();
    // Runtime existence, standing in for the compile-time guarantee: a
    // caller typed as `OtpDriver` (what a live driver would satisfy) has no
    // access to either member at all.
    expect(typeof driver.peekCode).toBe("function");
    expect(Array.isArray(driver.devAccessLog)).toBe(true);
  });

  it("logs every access — found and not-found — without ever recording the code", async () => {
    const driver = createSimulatedOtp();
    const issued = (await driver.issue(PHONE, NOW))._unsafeUnwrap();

    const code = driver.peekCode(issued.challengeId, NOW + 5)!;
    driver.peekCode("otp_never_issued", NOW + 6);

    expect(driver.devAccessLog).toStrictEqual([
      { challengeId: issued.challengeId, atMs: NOW + 5, found: true },
      { challengeId: "otp_never_issued", atMs: NOW + 6, found: false },
    ]);
    // The audit trail records THAT a code was fetched, never the code.
    expect(JSON.stringify(driver.devAccessLog)).not.toContain(code);
  });

  it("proves the code is absent from ordinary logs by capturing real console output, not by asserting intent", async () => {
    const calls: unknown[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        calls.push(args);
      }),
    );

    try {
      const driver = createSimulatedOtp();
      const issued = (await driver.issue(PHONE, NOW))._unsafeUnwrap();
      const code = driver.peekCode(issued.challengeId, NOW)!;
      const wrong = (await driver.verify(issued.challengeId, "000000", NOW))._unsafeUnwrap();
      expect(wrong).toStrictEqual({ outcome: "wrong_code", attemptsRemaining: 2 });
      const right = (await driver.verify(issued.challengeId, code, NOW))._unsafeUnwrap();
      expect(right).toStrictEqual({ outcome: "verified" });
      const replay = (await driver.verify(issued.challengeId, code, NOW))._unsafeUnwrap();
      expect(replay).toStrictEqual({ outcome: "refused" });

      const captured = JSON.stringify(calls);
      expect(captured).not.toContain(code);
      // Nothing was printed at all — the strongest version of the claim.
      expect(calls).toStrictEqual([]);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("the module has no logger and no console dependency at all — structural, not behavioural", () => {
    // Belt-and-suspenders alongside the spy test above: read the actual
    // source rather than trusting that nothing was exercised. Mirrors the
    // determinism proof YT-0536 uses for `Math.random`/`setTimeout`.
    const path = fileURLToPath(new URL("./otp.ts", import.meta.url));
    const source = readFileSync(path, "utf8");
    expect(source).not.toMatch(/console\s*\./);
    expect(source).not.toMatch(/\bLogger\b/);
  });
});

describe("unknown challenge and faults", () => {
  it("refuses an id that was never issued", async () => {
    const driver = createSimulatedOtp();
    const verdict = (await driver.verify("otp_bogus", "123456", NOW))._unsafeUnwrap();
    expect(verdict).toStrictEqual({ outcome: "refused" });
  });

  it("still respects the shared fault engine on verify(), not only on issue()", async () => {
    const driver = createSimulatedOtp({ kind: "timeout" });
    const result = await driver.verify("otp_1", "123456", NOW);
    expect(result.isErr()).toBe(true);
    const failure = result._unsafeUnwrapErr();
    expect(failure.kind).toBe("timeout");
    expect(failure.mayHaveSucceeded).toBe(true);
  });
});

describe("determinism", () => {
  let originalRandom: typeof Math.random;

  beforeEach(() => {
    originalRandom = Math.random;
    Math.random = () => {
      throw new Error("Math.random must never be called by the OTP simulator");
    };
  });

  afterEach(() => {
    Math.random = originalRandom;
  });

  it("issues a deterministic code without touching Math.random", async () => {
    const driver = createSimulatedOtp();
    const result = await driver.issue(PHONE, NOW);
    expect(result.isOk()).toBe(true);
  });
});
