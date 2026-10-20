import { beforeEach, describe, expect, it } from "vitest";
import {
  PASSWORD_CREDENTIAL_KIND,
  TOTP_CREDENTIAL_KIND,
} from "../persistence/credential.repository";
import { parseAmr } from "../session/amr";
import { InMemoryFactorStore } from "./factor-store";
import { SecondFactorGate } from "./second-factor-gate";
import { InMemoryCredentialRepository } from "./testing/in-memory-repositories";
import { FACTORS_CONFIG, InMemoryThrottle, RecordingSessionIssuer } from "./testing/fakes";
import { totpCodeAt } from "./totp-code";
import { TotpService } from "./totp.service";

const USER = "user-totp";
const T0 = new Date("2026-10-21T00:00:00Z");
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

let credentials: InMemoryCredentialRepository;
let store: InMemoryFactorStore;
let totp: TotpService;
let issuer: RecordingSessionIssuer;
let throttle: InMemoryThrottle;
let gate: SecondFactorGate;

beforeEach(async () => {
  credentials = new InMemoryCredentialRepository();
  store = new InMemoryFactorStore();
  throttle = new InMemoryThrottle();
  totp = new TotpService(FACTORS_CONFIG, credentials, store, throttle.asThrottle());
  issuer = new RecordingSessionIssuer();
  gate = new SecondFactorGate(totp, issuer.asIssuer(), store);
  await credentials.create({
    userId: USER,
    kind: PASSWORD_CREDENTIAL_KIND,
    identifier: "ana@example.com",
    secretHash: "argon2-not-used-here",
  });
});

/** Enrols and confirms an authenticator app; returns its seed. */
async function switchOnTotp(): Promise<string> {
  const enrolled = await totp.enrol(USER);
  if (enrolled.isErr()) throw new Error(enrolled.error.type);
  const confirmed = await totp.confirm(USER, totpCodeAt(enrolled.value.secret, T0), T0);
  expect(confirmed.isOk()).toBe(true);
  return enrolled.value.secret;
}

describe("amr for each way in", () => {
  it("a password alone is a session with amr pwd", async () => {
    const signIn = await gate.afterPassword(USER, T0);
    expect(signIn.kind).toBe("session");
    expect(issuer.issued).toEqual([{ userId: USER, amr: ["pwd"] }]);
  });

  it("a password and a code is pwd, otp and mfa", async () => {
    const seed = await switchOnTotp();
    const signIn = await gate.afterPassword(USER, later(60));
    expect(signIn.kind).toBe("second_factor");
    expect(issuer.issued).toEqual([]);
    if (signIn.kind !== "second_factor") return;

    const done = await gate.completeWithTotp(
      signIn.pendingToken,
      totpCodeAt(seed, later(60)),
      later(60),
    );
    expect(done.isOk()).toBe(true);
    expect(issuer.issued).toEqual([{ userId: USER, amr: ["pwd", "otp", "mfa"] }]);
  });

  it("reads stored amr back, dropping anything unknown", () => {
    expect(parseAmr(["hwk"])).toEqual(["hwk"]);
    expect(parseAmr(["pwd", "otp", "mfa"])).toEqual(["pwd", "otp", "mfa"]);
    expect(parseAmr(["sms", "hwk"])).toEqual(["hwk"]);
    expect(parseAmr([])).toEqual(["pwd"]);
  });
});

describe("the code step after a password", () => {
  it("is single-use: the same pending token cannot mint a second session", async () => {
    const seed = await switchOnTotp();
    const signIn = await gate.afterPassword(USER, later(60));
    if (signIn.kind !== "second_factor") throw new Error("expected a code step");
    const first = await gate.completeWithTotp(
      signIn.pendingToken,
      totpCodeAt(seed, later(60)),
      later(60),
    );
    expect(first.isOk()).toBe(true);
    const again = await gate.completeWithTotp(
      signIn.pendingToken,
      totpCodeAt(seed, later(90)),
      later(90),
    );
    expect(again.isErr() && again.error.type).toBe("factor_invalid");
    expect(issuer.issued).toHaveLength(1);
  });

  it("refuses a code already used, even on a new pending sign-in", async () => {
    const seed = await switchOnTotp();
    const code = totpCodeAt(seed, later(60));
    const a = await gate.afterPassword(USER, later(60));
    const b = await gate.afterPassword(USER, later(61));
    if (a.kind !== "second_factor" || b.kind !== "second_factor")
      throw new Error("expected code steps");
    expect((await gate.completeWithTotp(a.pendingToken, code, later(61))).isOk()).toBe(true);
    const replay = await gate.completeWithTotp(b.pendingToken, code, later(62));
    expect(replay.isErr() && replay.error.type).toBe("factor_invalid");
  });

  it("drops the pending sign-in after five wrong codes", async () => {
    const seed = await switchOnTotp();
    const signIn = await gate.afterPassword(USER, later(60));
    if (signIn.kind !== "second_factor") throw new Error("expected a code step");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await gate.completeWithTotp(signIn.pendingToken, "000000", later(60));
      expect(wrong.isErr()).toBe(true);
    }
    // Clear the per-account throttle, so what refuses below is the dropped token.
    await throttle.reset("account", `totp:${USER}`);
    const right = await gate.completeWithTotp(
      signIn.pendingToken,
      totpCodeAt(seed, later(60)),
      later(60),
    );
    expect(right.isErr()).toBe(true);
    expect(issuer.issued).toEqual([]);
  });

  it("refuses an unknown pending token", async () => {
    const done = await gate.completeWithTotp("not-a-real-pending-token", "123456", T0);
    expect(done.isErr() && done.error.type).toBe("factor_invalid");
  });
});

describe("enrolment", () => {
  it("is off until a first code confirms it, and stores the seed sealed", async () => {
    const enrolled = await totp.enrol(USER);
    if (enrolled.isErr()) throw new Error(enrolled.error.type);
    expect(await totp.isEnabled(USER)).toBe(false);
    const row = await credentials.findByUserAndKind(USER, TOTP_CREDENTIAL_KIND);
    expect(row?.secretHash).not.toContain(enrolled.value.secret);
    expect(enrolled.value.otpauthUri).toContain("ana%40example.com");

    expect((await totp.confirm(USER, "000000", T0)).isErr()).toBe(true);
    expect(await totp.isEnabled(USER)).toBe(false);
    expect((await totp.confirm(USER, totpCodeAt(enrolled.value.secret, T0), T0)).isOk()).toBe(true);
    expect(await totp.isEnabled(USER)).toBe(true);
  });

  it("will not replace an app that is switched on", async () => {
    await switchOnTotp();
    const again = await totp.enrol(USER);
    expect(again.isErr() && again.error.type).toBe("totp_already_enabled");
  });

  it("locks out guessing: the sixth try is throttled even with the right code", async () => {
    const seed = await switchOnTotp();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await totp.verify(USER, "000000", later(60))).isErr()).toBe(true);
    }
    const right = await totp.verify(USER, totpCodeAt(seed, later(60)), later(60));
    expect(right.isErr() && right.error.type).toBe("throttled");
  });
});
