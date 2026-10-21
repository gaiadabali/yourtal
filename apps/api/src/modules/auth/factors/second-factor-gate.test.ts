import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PASSWORD_CREDENTIAL_KIND,
  TOTP_CREDENTIAL_KIND,
} from "../persistence/credential.repository";
import { parseAmr } from "../session/amr";
import { RecordingFactorNotifier } from "./factor-notifier";
import { InMemoryFactorStore } from "./factor-store";
import { SecondFactorGate } from "./second-factor-gate";
import {
  InMemoryCredentialRepository,
  InMemoryPasskeyRepository,
} from "./testing/in-memory-repositories";
import { FactorWindow } from "./factor-window";
import type { SessionService } from "../session/session.service";
import { FACTORS_CONFIG, InMemoryThrottle, RecordingSessionIssuer } from "./testing/fakes";
import { totpCodeAt } from "./totp-code";
import { hashOpaqueToken as hashOf } from "../crypto/opaque-token";
import { TotpService } from "./totp.service";

const USER = "user-totp";
const T0 = new Date("2026-10-21T00:00:00Z");
const later = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

let credentials: InMemoryCredentialRepository;
let store: InMemoryFactorStore;
let totp: TotpService;
let issuer: RecordingSessionIssuer;
let throttle: InMemoryThrottle;
let notifier: RecordingFactorNotifier;
let passkeys: InMemoryPasskeyRepository;
let window: FactorWindow;
let revoked: string[];
let gate: SecondFactorGate;

beforeEach(async () => {
  credentials = new InMemoryCredentialRepository();
  store = new InMemoryFactorStore();
  throttle = new InMemoryThrottle();
  totp = new TotpService(FACTORS_CONFIG, credentials, store, throttle.asThrottle());
  issuer = new RecordingSessionIssuer();
  notifier = new RecordingFactorNotifier();
  passkeys = new InMemoryPasskeyRepository(credentials);
  revoked = [];
  window = new FactorWindow(credentials, passkeys, {
    revokeAllForUser: (userId: string) => {
      revoked.push(userId);
      return Promise.resolve();
    },
  } as unknown as SessionService);
  gate = new SecondFactorGate(totp, issuer.asIssuer(), store, notifier, window);
  await credentials.create({
    userId: USER,
    kind: PASSWORD_CREDENTIAL_KIND,
    identifier: "ana@example.com",
    secretHash: "argon2-not-used-here",
  });
});

/** The enrolling session's token hash: an unfinished enrolment is tied to it. */
const SESSION = "session-hash-1";

/** Enrols and confirms an authenticator app; returns its seed. */
async function switchOnTotp(at = T0): Promise<string> {
  const enrolled = await totp.enrol(USER, SESSION);
  if (enrolled.isErr()) throw new Error(enrolled.error.type);
  const code = totpCodeAt(enrolled.value.secret, at);
  const confirmed = await totp.confirm(USER, SESSION, code, at);
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
    const enrolled = await totp.enrol(USER, SESSION);
    if (enrolled.isErr()) throw new Error(enrolled.error.type);
    expect(await totp.isEnabled(USER)).toBe(false);
    // Nothing in the database until the first code; the seed waits sealed.
    expect(await credentials.findByUserAndKind(USER, TOTP_CREDENTIAL_KIND)).toBeNull();
    expect(store.enrolments.get(SESSION)?.sealedSeed).not.toContain(enrolled.value.secret);
    expect(enrolled.value.otpauthUri).toContain("ana%40example.com");

    const code = totpCodeAt(enrolled.value.secret, T0);
    expect((await totp.confirm(USER, SESSION, "000000", T0)).isErr()).toBe(true);
    // Another session cannot finish this enrolment.
    const elsewhere = await totp.confirm(USER, "another-session", code, T0);
    expect(elsewhere.isErr() && elsewhere.error.type).toBe("factor_invalid");
    expect(await totp.isEnabled(USER)).toBe(false);
    expect((await totp.confirm(USER, SESSION, code, T0)).isOk()).toBe(true);
    expect(await totp.isEnabled(USER)).toBe(true);
    const row = await credentials.findByUserAndKind(USER, TOTP_CREDENTIAL_KIND);
    expect(row?.secretHash).not.toContain(enrolled.value.secret);
  });

  it("will not replace an app that is switched on", async () => {
    await switchOnTotp();
    const again = await totp.enrol(USER, SESSION);
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

describe("guess limits under parallel requests", () => {
  it("checks at most five codes per account however many arrive at once", async () => {
    await switchOnTotp();
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, () => totp.verify(USER, "000000", later(60))),
    );
    const types = outcomes.map((outcome) => (outcome.isErr() ? outcome.error.type : "ok"));
    expect(types.filter((type) => type === "factor_invalid")).toHaveLength(5);
    expect(types.filter((type) => type === "throttled")).toHaveLength(15);
  });

  it("lets one pending sign-in reach the code check at most five times", async () => {
    await switchOnTotp();
    const signIn = await gate.afterPassword(USER, later(60));
    if (signIn.kind !== "second_factor") throw new Error("expected a code step");
    const verify = vi.spyOn(totp, "verify");
    await Promise.all(
      Array.from({ length: 20 }, () =>
        gate.completeWithTotp(signIn.pendingToken, "000000", later(60)),
      ),
    );
    expect(verify.mock.calls.length).toBeLessThanOrEqual(5);
    expect(await store.readPending(hashOf(signIn.pendingToken))).toBeNull();
  });
});

describe("a code step is used once, and never an earlier one (RFC 6238 5.2)", () => {
  it("refuses the same step, and an earlier step still inside the drift window", async () => {
    const seed = await switchOnTotp();
    expect((await totp.verify(USER, totpCodeAt(seed, later(90)), later(90))).isOk()).toBe(true);
    const same = await totp.verify(USER, totpCodeAt(seed, later(90)), later(91));
    expect(same.isErr() && same.error.type).toBe("factor_invalid");
    const earlier = await totp.verify(USER, totpCodeAt(seed, later(60)), later(91));
    expect(earlier.isErr() && earlier.error.type).toBe("factor_invalid");
    expect((await totp.verify(USER, totpCodeAt(seed, later(120)), later(121))).isOk()).toBe(true);
  });
});

describe("authenticator apps switched off on this deployment", () => {
  it("does not lock an account with an app out of password sign-in", async () => {
    await switchOnTotp();
    const factors = FACTORS_CONFIG.authFactors;
    if (factors === undefined) throw new Error("test config has no factors");
    const off = new TotpService(
      {
        authFactors: { rpId: factors.rpId, rpName: factors.rpName, origins: factors.origins },
      } as never,
      credentials,
      store,
      throttle.asThrottle(),
    );
    const offGate = new SecondFactorGate(off, issuer.asIssuer(), store, notifier, window);
    expect(off.available()).toBe(false);
    const signIn = await offGate.afterPassword(USER, later(60));
    expect(signIn.kind).toBe("session");
    expect(issuer.issued.at(-1)).toEqual({ userId: USER, amr: ["pwd"] });
    const enrol = await off.enrol(USER, SESSION);
    expect(enrol.isErr() && enrol.error.type).toBe("authenticator_unavailable");
  });
});

describe("a password reset", () => {
  it("tells the person what can still sign them in, then asks for the code", async () => {
    await switchOnTotp();
    const signIn = await gate.afterPasswordReset(USER, later(60));
    expect(signIn.kind).toBe("second_factor");
    expect(notifier.sent).toEqual([{ userId: USER, notice: "reset_summary" }]);
  });
});

describe("the account's factor window and a password reset", () => {
  const HOUR = 60 * 60;

  it("inside the window removes every factor, ends every session, and asks for no code", async () => {
    await switchOnTotp();
    await window.openForFirstFactor(USER, T0);
    await passkeys.create(
      {
        credentialId: "planted",
        userId: USER,
        publicKey: Buffer.from("key"),
        signCount: 0,
        transports: [],
        deviceType: "multiDevice",
        backedUp: true,
        name: "Planted",
      },
      "handle",
    );
    const signIn = await gate.afterPasswordReset(USER, later(71 * HOUR));
    expect(signIn.kind).toBe("session");
    expect(issuer.issued.at(-1)).toEqual({ userId: USER, amr: ["pwd"] });
    expect(await totp.isEnabled(USER)).toBe(false);
    expect(await passkeys.listForUser(USER)).toEqual([]);
    expect(revoked).toEqual([USER]);
    expect(await window.isOpen(USER, later(71 * HOUR))).toBe(false);
    expect(notifier.sent.map((sent) => sent.notice)).toEqual([
      { kind: "factors_removed_after_reset" },
      "reset_summary",
    ]);
  });

  it("after 72 hours leaves the factors and asks for the code", async () => {
    await switchOnTotp();
    await window.openForFirstFactor(USER, T0);
    const signIn = await gate.afterPasswordReset(USER, later(73 * HOUR));
    expect(signIn.kind).toBe("second_factor");
    expect(await totp.isEnabled(USER)).toBe(true);
    expect(revoked).toEqual([]);
  });

  it("does nothing on an account whose window was never opened", async () => {
    await switchOnTotp();
    const signIn = await gate.afterPasswordReset(USER, later(HOUR));
    expect(signIn.kind).toBe("second_factor");
    expect(await totp.isEnabled(USER)).toBe(true);
  });

  it("closes when the account has no factor left", async () => {
    await switchOnTotp();
    await window.openForFirstFactor(USER, T0);
    await window.closeIfNoFactors(USER);
    expect(await window.isOpen(USER, later(60))).toBe(true);
    expect((await totp.remove(USER)).isOk()).toBe(true);
    await window.closeIfNoFactors(USER);
    expect(await window.isOpen(USER, later(60))).toBe(false);
  });
});
