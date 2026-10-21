import { beforeEach, describe, expect, it } from "vitest";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { PASSWORD_CREDENTIAL_KIND } from "../persistence/credential.repository";
import { InMemoryFactorStore } from "./factor-store";
import { PasskeyService } from "./passkey.service";
import { SoftAuthenticator } from "./testing/soft-authenticator";
import {
  InMemoryCredentialRepository,
  InMemoryPasskeyRepository,
} from "./testing/in-memory-repositories";
import { FACTORS_CONFIG, TEST_ORIGIN, TEST_RP_ID } from "./testing/fakes";

const ANA = "user-ana";
const BUDI = "user-budi";
const NOW = new Date("2026-10-21T00:00:00Z");

let credentials: InMemoryCredentialRepository;
let passkeys: InMemoryPasskeyRepository;
let service: PasskeyService;

beforeEach(async () => {
  credentials = new InMemoryCredentialRepository();
  passkeys = new InMemoryPasskeyRepository(credentials);
  service = new PasskeyService(FACTORS_CONFIG, passkeys, credentials, new InMemoryFactorStore());
  for (const [userId, email] of [
    [ANA, "ana@example.com"],
    [BUDI, "budi@example.com"],
  ] as const) {
    await credentials.create({
      userId,
      kind: PASSWORD_CREDENTIAL_KIND,
      identifier: email,
      secretHash: "argon2-not-used-here",
    });
  }
});

/** Registers a fresh software passkey to `userId` and returns it. */
async function registered(userId: string): Promise<SoftAuthenticator> {
  const device = new SoftAuthenticator(TEST_RP_ID, TEST_ORIGIN);
  const options = await service.registrationOptions(userId);
  if (options.isErr()) throw new Error(options.error.type);
  const done = await service.register(userId, device.register(options.value), "Phone", NOW);
  if (done.isErr()) throw new Error(done.error.type);
  return device;
}

async function signInOptions(): Promise<{
  challengeId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}> {
  const ceremony = await service.signInOptions();
  if (ceremony.isErr()) throw new Error(ceremony.error.type);
  return ceremony.value;
}

describe("registering a passkey", () => {
  it("stores the key under a random user handle, never the user id", async () => {
    const options = await service.registrationOptions(ANA);
    if (options.isErr()) throw new Error(options.error.type);
    expect(options.value.rp).toEqual({ name: "YourTal", id: TEST_RP_ID });
    expect(options.value.user.name).toBe("ana@example.com");
    expect(Buffer.from(options.value.user.id, "base64url").toString("utf8")).not.toContain(ANA);
    expect(options.value.authenticatorSelection).toMatchObject({
      residentKey: "required",
      userVerification: "required",
    });

    const device = new SoftAuthenticator(TEST_RP_ID, TEST_ORIGIN);
    const done = await service.register(ANA, device.register(options.value), "Phone", NOW);
    expect(done.isOk()).toBe(true);
    const [stored] = await passkeys.listForUser(ANA);
    expect(stored).toMatchObject({
      credentialId: device.credentialId,
      name: "Phone",
      backedUp: true,
    });
  });

  it("refuses an answer from another origin, and the challenge is then spent", async () => {
    const options = await service.registrationOptions(ANA);
    if (options.isErr()) throw new Error(options.error.type);
    const phishing = new SoftAuthenticator(TEST_RP_ID, "https://yourtal.test.evil.example");
    const refused = await service.register(ANA, phishing.register(options.value), undefined, NOW);
    expect(refused.isErr() && refused.error.type).toBe("factor_invalid");

    const honest = new SoftAuthenticator(TEST_RP_ID, TEST_ORIGIN);
    const late = await service.register(ANA, honest.register(options.value), undefined, NOW);
    expect(late.isErr() && late.error.type).toBe("factor_invalid");
    expect(await passkeys.listForUser(ANA)).toHaveLength(0);
  });

  it("asks the authenticator to skip keys the account already has", async () => {
    const device = await registered(ANA);
    const options = await service.registrationOptions(ANA);
    if (options.isErr()) throw new Error(options.error.type);
    expect(options.value.excludeCredentials?.map((c) => c.id)).toEqual([device.credentialId]);
  });
});

describe("signing in with a passkey", () => {
  it("proves the account that owns the key, with no email asked first", async () => {
    const device = await registered(ANA);
    const { challengeId, options } = await signInOptions();
    expect(options.allowCredentials ?? []).toEqual([]);
    expect(options.userVerification).toBe("required");

    const proved = await service.signIn(challengeId, device.assert(options), NOW);
    expect(proved.isOk() && proved.value).toBe(ANA);
    const [stored] = await passkeys.listForUser(ANA);
    expect(stored?.lastUsedAt).toEqual(NOW);
    expect(stored?.signCount).toBe(1);
  });

  it("answers each challenge once", async () => {
    const device = await registered(ANA);
    const { challengeId, options } = await signInOptions();
    const response = device.assert(options);
    expect((await service.signIn(challengeId, response, NOW)).isOk()).toBe(true);
    const replay = await service.signIn(challengeId, response, NOW);
    expect(replay.isErr() && replay.error.type).toBe("factor_invalid");
  });

  it.each([
    ["another origin", { origin: "https://evil.example" }],
    ["another relying party", { rpId: "evil.example" }],
    ["no user verification", { userVerified: false }],
    ["a counter that went backwards", { counter: 0 }],
    ["a user handle for someone else", { userHandle: "c29tZW9uZS1lbHNl" }],
  ])("refuses %s", async (_label, overrides) => {
    const device = await registered(ANA);
    const first = await signInOptions();
    expect(
      (await service.signIn(first.challengeId, device.assert(first.options), NOW)).isOk(),
    ).toBe(true);
    const { challengeId, options } = await signInOptions();
    const refused = await service.signIn(challengeId, device.assert(options, overrides), NOW);
    expect(refused.isErr() && refused.error.type).toBe("factor_invalid");
  });

  it("refuses a key nobody registered", async () => {
    const stranger = new SoftAuthenticator(TEST_RP_ID, TEST_ORIGIN);
    const { challengeId, options } = await signInOptions();
    const refused = await service.signIn(challengeId, stranger.assert(options), NOW);
    expect(refused.isErr() && refused.error.type).toBe("factor_invalid");
  });
});

describe("proving a passkey again (step-up)", () => {
  it("accepts only the signed-in account's own key", async () => {
    const anaKey = await registered(ANA);
    const budiKey = await registered(BUDI);
    const ceremony = await service.stepUpOptions(ANA);
    if (ceremony.isErr()) throw new Error(ceremony.error.type);
    expect(ceremony.value.options.allowCredentials?.map((c) => c.id)).toEqual([
      anaKey.credentialId,
    ]);

    const wrongOwner = await service.stepUp(
      ANA,
      ceremony.value.challengeId,
      budiKey.assert(ceremony.value.options),
      NOW,
    );
    expect(wrongOwner.isErr() && wrongOwner.error.type).toBe("factor_invalid");

    const again = await service.stepUpOptions(ANA);
    if (again.isErr()) throw new Error(again.error.type);
    const own = await service.stepUp(
      ANA,
      again.value.challengeId,
      anaKey.assert(again.value.options),
      NOW,
    );
    expect(own.isOk()).toBe(true);
  });

  it("will not answer a sign-in challenge as a step-up, or the reverse", async () => {
    const device = await registered(ANA);
    const stepUp = await service.stepUpOptions(ANA);
    if (stepUp.isErr()) throw new Error(stepUp.error.type);
    const asSignIn = await service.signIn(
      stepUp.value.challengeId,
      device.assert(stepUp.value.options),
      NOW,
    );
    expect(asSignIn.isErr()).toBe(true);
    const signIn = await signInOptions();
    const asStepUp = await service.stepUp(
      ANA,
      signIn.challengeId,
      device.assert(signIn.options),
      NOW,
    );
    expect(asStepUp.isErr()).toBe(true);
  });
});

describe("removing a passkey", () => {
  it("removes it, and refuses the last way in for an account with no password", async () => {
    const first = await registered(ANA);
    const second = await registered(ANA);
    await credentials.deleteByUserAndKind(ANA, PASSWORD_CREDENTIAL_KIND);

    expect((await service.remove(ANA, first.credentialId)).isOk()).toBe(true);
    const last = await service.remove(ANA, second.credentialId);
    expect(last.isErr() && last.error.type).toBe("last_sign_in_method");
    expect(await passkeys.listForUser(ANA)).toHaveLength(1);
  });

  it("removes the last passkey when a password remains, and never someone else's", async () => {
    const device = await registered(ANA);
    const notYours = await service.remove(BUDI, device.credentialId);
    expect(notYours.isErr() && notYours.error.type).toBe("passkey_not_found");
    expect((await service.remove(ANA, device.credentialId)).isOk()).toBe(true);
    expect(await passkeys.listForUser(ANA)).toHaveLength(0);
  });
});

describe("the account's passkey marker row", () => {
  it("is written with the first passkey, not when options are asked for", async () => {
    const options = await service.registrationOptions(ANA);
    expect(options.isOk()).toBe(true);
    expect(await passkeys.userHandleOf(ANA)).toBeNull();
    await registered(ANA);
    expect(await passkeys.userHandleOf(ANA)).not.toBeNull();
  });
});

describe("the signature counter", () => {
  it("counts once when two sign-ins race with the same counter", async () => {
    const device = await registered(ANA);
    const first = await signInOptions();
    const second = await signInOptions();
    const a = device.assert(first.options, { counter: 5 });
    const b = device.assert(second.options, { counter: 5 });
    const outcomes = await Promise.all([
      service.signIn(first.challengeId, a, NOW),
      service.signIn(second.challengeId, b, NOW),
    ]);
    expect(outcomes.filter((outcome) => outcome.isOk())).toHaveLength(1);
  });
});
