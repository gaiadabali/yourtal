import { describe, expect, it, vi } from "vitest";
import type { OidcAccount } from "./claims";
import type { SignInClient } from "./clients";
import { CLIENTS, isSignInClient } from "./clients";
import type { AppConsent } from "./oidc-store";
import type { SignInInput, TeenInviteChecker } from "./sign-in-checks";
import { NO_TEEN_INVITES_YET, decideSignIn } from "./sign-in-checks";

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
  endedAt: null,
};

function input(overrides: Partial<SignInInput> = {}): SignInInput {
  return {
    account: ADULT,
    client: SNAPAPP,
    scopes: SCOPES,
    prompts: new Set(),
    consent: null,
    policyVersionId: "au-2026-09-01",
    teenInviteCode: undefined,
    teenInvites: NO_TEEN_INVITES_YET,
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

  it("4. SnapApp needs a teen invite, and none exists yet", async () => {
    expect(await screen({ account: TEEN, teenInviteCode: "abc" })).toBe(
      "refused:teen_invite_required",
    );
  });

  it("4. the teen invite seam decides for SnapApp, and is told the invite code", async () => {
    const check = vi.fn<TeenInviteChecker["check"]>(() => Promise.resolve({ allowed: true }));
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
