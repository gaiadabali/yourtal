import { describe, expect, it, vi } from "vitest";
import type { OidcAccount } from "./claims";
import type { SignInClient } from "./clients";
import { CLIENTS, isSignInClient } from "./clients";
import type { AppConsent } from "./oidc-store";
import type { SignInInput, TeenInviteChecker } from "./sign-in-checks";
import { NO_TEEN_INVITES, decideSignIn, signInTooOld } from "./sign-in-checks";

function signInClient(clientId: string): SignInClient {
  const client = CLIENTS.find((candidate) => candidate.clientId === clientId);
  if (client === undefined || !isSignInClient(client)) throw new Error(clientId);
  return client;
}

const SNAPAPP = signInClient("snapapp-staging-web");
const FTR = signInClient("ftr-web");
const NOW = new Date("2026-10-21T00:00:00Z");
const SCOPES = ["openid", "email", "profile", "account"];

const ADULT: OidcAccount = {
  userId: "u-1",
  displayName: "Ana",
  region: "AU",
  dateOfBirth: "1990-01-01",
  email: "ana@example.com",
  emailVerified: true,
  suspended: false,
};
const TEEN: OidcAccount = { ...ADULT, dateOfBirth: "2011-01-01" };
const CONSENTED: AppConsent = {
  scopes: SCOPES,
  policyVersionId: "au-2026-09-01",
  grantedVia: "consent_screen",
  inviteId: null,
  endedAt: null,
};
const PENDING = { allowed: true, inviteId: "inv-1", parentName: "Pat", pending: true } as const;
const STANDING = { ...PENDING, pending: false } as const;
const invites = (answer: Awaited<ReturnType<TeenInviteChecker["check"]>>): TeenInviteChecker => ({
  check: () => Promise.resolve(answer),
});

function input(overrides: Partial<SignInInput> = {}): SignInInput {
  return {
    account: ADULT,
    client: SNAPAPP,
    scopes: SCOPES,
    prompts: new Set(),
    consent: null,
    policyVersionId: "au-2026-09-01",
    teenInviteCode: undefined,
    teenInvites: NO_TEEN_INVITES,
    signInAgain: false,
    now: NOW,
    ...overrides,
  };
}

async function screen(overrides: Partial<SignInInput> = {}) {
  const state = await decideSignIn(input(overrides));
  return state.screen === "refused" ? `refused:${state.refusal}` : state.screen;
}

describe("the docs/26 §1.5 checks", () => {
  it("with no YourTal session: sign in, or sign up when the app sent prompt=create", async () => {
    expect(await screen({ account: null })).toBe("login");
    expect(await screen({ account: null, prompts: new Set(["create"]) })).toBe("create");
  });

  it("1. an unverified email goes to the verify step, before anything else", async () => {
    const unverified = { ...ADULT, emailVerified: false, suspended: true, region: "ID" as const };
    expect(await screen({ account: unverified, client: FTR })).toBe("verify_email");
    expect(await screen({ account: { ...ADULT, email: null } })).toBe("verify_email");
  });

  it("2. a suspended account is on hold, before region and age", async () => {
    const held = { ...TEEN, suspended: true, region: "ID" as const };
    expect(await screen({ account: held, client: FTR })).toBe("refused:account_on_hold");
  });

  it("3. FTR takes Australia only; SnapApp takes both regions", async () => {
    const indonesian = { ...ADULT, region: "ID" as const };
    expect(await screen({ account: indonesian, client: FTR })).toBe("refused:region_not_supported");
    expect(await screen({ account: indonesian, client: SNAPAPP })).toBe("consent");
  });

  it("3 before 4: an Indonesian teen at FTR hears about the region", async () => {
    const teen = { ...TEEN, region: "ID" as const };
    expect(await screen({ account: teen, client: FTR })).toBe("refused:region_not_supported");
  });

  it("4. FTR refuses teens outright", async () => {
    expect(await screen({ account: TEEN, client: FTR })).toBe("refused:teen_not_allowed");
  });

  it("4. SnapApp refuses a teen without a good invite, and says why", async () => {
    const state = await decideSignIn(
      input({
        account: TEEN,
        teenInviteCode: "abc",
        teenInvites: invites({ allowed: false, problem: "wrong_inviter" }),
      }),
    );
    expect(state).toMatchObject({
      screen: "refused",
      refusal: "teen_invite_required",
      inviteProblem: "wrong_inviter",
    });
  });

  it("4. the teen invite check decides for SnapApp, and is told the invite code", async () => {
    const check = vi.fn<TeenInviteChecker["check"]>(() => Promise.resolve(PENDING));
    expect(await screen({ account: TEEN, teenInviteCode: "abc", teenInvites: { check } })).toBe(
      "consent",
    );
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u-1", inviteCode: "abc", client: SNAPAPP }),
    );
  });

  it("4. adults never reach the teen invite seam", async () => {
    const check = vi.fn<TeenInviteChecker["check"]>();
    await decideSignIn(input({ teenInvites: { check } }));
    expect(check).not.toHaveBeenCalled();
  });

  it("5. the first sign-in to an app asks for consent; a later one only to continue", async () => {
    expect(await screen()).toBe("consent");
    expect(await screen({ consent: CONSENTED })).toBe("continue");
  });

  it("5. consent is asked again for a new scope, new wording, an ended consent or prompt=consent", async () => {
    expect(await screen({ consent: { ...CONSENTED, scopes: ["openid", "account"] } })).toBe(
      "consent",
    );
    expect(await screen({ consent: CONSENTED, policyVersionId: "au-2027-01-01" })).toBe("consent");
    expect(await screen({ consent: { ...CONSENTED, endedAt: NOW } })).toBe("consent");
    expect(await screen({ consent: CONSENTED, prompts: new Set(["consent"]) })).toBe("consent");
  });

  it("5. a teen agrees on the consent screen for a pending invite, then only continues under it", async () => {
    const teenConsent: AppConsent = {
      ...CONSENTED,
      grantedVia: "guardian_invite",
      inviteId: "inv-1",
    };
    const teen = { account: TEEN, consent: teenConsent };
    expect(await screen({ ...teen, teenInvites: invites(PENDING) })).toBe("consent");
    expect(await screen({ ...teen, teenInvites: invites(STANDING) })).toBe("continue");
    const other = { ...STANDING, inviteId: "inv-2" };
    expect(await screen({ ...teen, teenInvites: invites(other) })).toBe("consent");
    const state = await decideSignIn(input({ ...teen, teenInvites: invites(STANDING) }));
    expect(state).toMatchObject({ invite: STANDING, sharing: { ageBand: "teen" } });
  });

  it("5. an adult whose consent came from a guardian's invite agrees for themselves", async () => {
    expect(await screen({ consent: { ...CONSENTED, grantedVia: "guardian_invite" } })).toBe(
      "consent",
    );
  });

  it("lists what the app will get, from the scopes, with the person's age band and region", async () => {
    const state = await decideSignIn(input());
    expect(state.screen === "consent" && state.sharing).toEqual({
      claims: ["name", "email", "age_band", "region"],
      ageBand: "adult",
      region: "AU",
    });
  });
});

describe("a fresh sign-in when the app asks for one", () => {
  const seconds = (date: Date) => date.getTime() / 1000;
  const started = new Date(NOW.getTime() - 60_000);
  const tooOld = (authTime: Date, prompts: string[], maxAge?: number) =>
    signInTooOld({
      authTime,
      interactionStartedAt: seconds(started),
      prompts: new Set(prompts),
      maxAge,
      now: NOW,
    });

  it("prompt=login: only a sign-in after this sign-in to the app began counts", () => {
    expect(tooOld(new Date(started.getTime() - 1), ["login"])).toBe(true);
    expect(tooOld(started, ["login"])).toBe(false);
    expect(tooOld(new Date(NOW.getTime() - 1000), ["login"])).toBe(false);
    expect(tooOld(new Date(started.getTime() - 1), [])).toBe(false);
  });

  it("max_age: at most that many whole seconds old, as auth_time counts them", () => {
    const twelveHours = 12 * 3600;
    expect(tooOld(new Date(NOW.getTime() - twelveHours * 1000), [], twelveHours)).toBe(false);
    expect(tooOld(new Date(NOW.getTime() - twelveHours * 1000 - 1000), [], twelveHours)).toBe(true);
    // 999 ms ago fell in the previous whole second, so auth_time is already a second old.
    expect(tooOld(new Date(NOW.getTime() - 999), [], 0)).toBe(true);
    // A sign-in after the interaction began still has to meet max_age.
    expect(tooOld(new Date(NOW.getTime() - 30_000), [], 10)).toBe(true);
  });

  it("asks again when a value it needs is missing", () => {
    const at = new Date(NOW.getTime() - 1000);
    expect(
      signInTooOld({
        authTime: at,
        interactionStartedAt: Number.NaN,
        prompts: new Set(["login"]),
        maxAge: undefined,
        now: NOW,
      }),
    ).toBe(true);
    expect(tooOld(at, [], Number.NaN)).toBe(true);
    expect(tooOld(new Date(Number.NaN), [], 60)).toBe(true);
  });

  it("is asked for once the person may sign in to the app, before consent", async () => {
    expect(await screen({ signInAgain: true })).toBe("sign_in_again");
    expect(await screen({ signInAgain: true, consent: CONSENTED })).toBe("sign_in_again");
    expect(await screen({ signInAgain: true, account: null })).toBe("login");
    expect(await screen({ signInAgain: true, account: { ...ADULT, suspended: true } })).toBe(
      "refused:account_on_hold",
    );
  });
});

describe("the send screen (docs/30 §5)", () => {
  const SEND = {
    financialYear: "2025-26",
    lineCount: 7,
    to: {
      clientId: FTR.clientId,
      name: FTR.name,
      operator: FTR.operator,
      externalOperator: FTR.externalOperator,
      privacyUrl: FTR.privacyUrl,
      termsUrl: FTR.termsUrl,
      returnHost: FTR.returnHost,
    },
  };

  it("shows send instead of continue once the app's consent stands and the transfer passes", async () => {
    const checkSend = vi.fn(() => Promise.resolve({ ok: true, send: SEND } as const));
    const state = await decideSignIn(input({ consent: CONSENTED, checkSend }));
    expect(state).toMatchObject({ screen: "send", send: SEND });
    expect(checkSend).toHaveBeenCalledWith(ADULT);
  });

  it("refuses with send_refused and the problem when the transfer does not pass", async () => {
    for (const problem of ["expired", "wrong_account", "not_allowed", "not_connected"] as const) {
      const state = await decideSignIn(
        input({ consent: CONSENTED, checkSend: () => Promise.resolve({ ok: false, problem }) }),
      );
      expect(state).toMatchObject({
        screen: "refused",
        refusal: "send_refused",
        sendProblem: problem,
        inviteProblem: null,
      });
    }
  });

  it("asks for consent first, and checks no transfer before it or before the sign-in checks", async () => {
    const checkSend = vi.fn(() => Promise.resolve({ ok: true, send: SEND } as const));
    expect(await screen({ checkSend })).toBe("consent");
    expect(await screen({ consent: CONSENTED, signInAgain: true, checkSend })).toBe(
      "sign_in_again",
    );
    expect(await screen({ account: { ...ADULT, suspended: true }, checkSend })).toBe(
      "refused:account_on_hold",
    );
    expect(checkSend).not.toHaveBeenCalled();
  });
});

// Staging test kit (M3): a password-less demo session reaches SnapApp's staging clients only.
describe("a demo-made session", () => {
  it("is refused by FTR and by any client outside snapapp-staging-*", async () => {
    expect(await screen({ client: FTR, demoSession: true })).toBe(
      "refused:demo_sign_in_not_allowed",
    );
    for (const client of CLIENTS.filter(isSignInClient)) {
      const expected = client.clientId.startsWith("snapapp-staging-")
        ? "consent"
        : "refused:demo_sign_in_not_allowed";
      expect(await screen({ client, demoSession: true }), client.clientId).toBe(expected);
    }
  });

  it("goes on to SnapApp staging, and a normal session still reaches FTR", async () => {
    expect(await screen({ client: SNAPAPP, demoSession: true })).toBe("consent");
    expect(await screen({ client: FTR, demoSession: false })).toBe("consent");
  });
});
