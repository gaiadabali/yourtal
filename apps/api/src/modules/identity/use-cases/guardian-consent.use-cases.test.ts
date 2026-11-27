import { describe, expect, it, vi } from "vitest";
import { okAsync } from "neverthrow";
import { hashOpaqueToken } from "../../auth/crypto/opaque-token";
import type { AppDb } from "../../../shared/persistence/drizzle-client";
import type {
  LedgerBalance,
  Escrow,
  EscrowRequest,
} from "@yourtal/contracts/ledger-internal/wallet";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type {
  ConsentTransition,
  GuardianConsentRepository,
  StoredGuardianConsent,
} from "../persistence/guardian-consent.repository";
import type {
  StoredUserProfile,
  UserProfileRepository,
} from "../persistence/user-profile.repository";
import { getGuardianConsent } from "./get-guardian-consent.use-case";
import { approveGuardianConsent } from "./approve-guardian-consent.use-case";
import { revokeGuardianConsent } from "./revoke-guardian-consent.use-case";
import { decideGuardianGodNotice } from "./decide-guardian-god-notice.use-case";
import type { GodConsentRecord } from "@yourtal/consent/god-group-notice";
import type { GodConsentRepository, NewGodConsent } from "../persistence/god-consent.repository";

/**
 * Unit tests for the guardian consent use-cases (12.1.a), against
 * lightweight in-memory fakes — no Postgres. `guardian-consent.e2e.test.ts`
 * is the real-Postgres, real-HTTP round trip; this file is what proves the
 * TRANSITION rules themselves: atomic approve/revoke, idempotent re-clicks,
 * "revoked is final", and — the one thing the e2e suite's fresh accounts
 * cannot exercise with a real ledger — that revoke escrows a NON-ZERO
 * balance with the right derived idempotency key.
 */

const RAW_TOKEN = "unit-test-raw-token";
const TOKEN_HASH = hashOpaqueToken(RAW_TOKEN);
const USER_ID = "11111111-1111-4111-8111-111111111111";

function baseRow(overrides: Partial<StoredGuardianConsent> = {}): StoredGuardianConsent {
  return {
    userId: USER_ID,
    tokenHash: TOKEN_HASH,
    guardianEmail: "guardian@example.test",
    region: "AU",
    guardianConfirmedAdultAt: null,
    approvedAt: null,
    revokedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

/** A fake backed by ONE row, mutated in place — enough to exercise the atomic transition rules. */
function fakeConsents(row: StoredGuardianConsent | null): GuardianConsentRepository {
  let stored = row === null ? null : { ...row };
  return {
    create: vi.fn(async () => {}),
    findByTokenHash: (tokenHash) =>
      Promise.resolve(stored !== null && stored.tokenHash === tokenHash ? { ...stored } : null),
    findByUserId: (userId) =>
      Promise.resolve(stored !== null && stored.userId === userId ? { ...stored } : null),
    approve: (tokenHash, now): Promise<ConsentTransition> => {
      if (stored === null || stored.tokenHash !== tokenHash) {
        return Promise.resolve({ transitioned: false, reason: "not_found" });
      }
      if (stored.revokedAt !== null) {
        return Promise.resolve({ transitioned: false, reason: "already_revoked" });
      }
      if (stored.approvedAt !== null) {
        return Promise.resolve({ transitioned: false, reason: "already_granted" });
      }
      stored = { ...stored, approvedAt: now, guardianConfirmedAdultAt: now };
      return Promise.resolve({ transitioned: true, userId: stored.userId, region: stored.region });
    },
    revoke: (tokenHash, now): Promise<ConsentTransition> => {
      if (stored === null || stored.tokenHash !== tokenHash) {
        return Promise.resolve({ transitioned: false, reason: "not_found" });
      }
      if (stored.revokedAt !== null) {
        return Promise.resolve({ transitioned: false, reason: "already_revoked" });
      }
      stored = { ...stored, revokedAt: now };
      return Promise.resolve({ transitioned: true, userId: stored.userId, region: stored.region });
    },
  };
}

function fakeProfile(overrides: Partial<StoredUserProfile> = {}): StoredUserProfile {
  return {
    userId: USER_ID,
    region: "AU",
    displayLocale: "en-AU",
    displayName: "Teen Tester",
    dateOfBirth: "2012-01-01",
    timezone: "Australia/Sydney",
    parentConsentStatus: "pending",
    trustTier: 0,
    suspendedAt: null,
    ...overrides,
  };
}

function fakeProfiles(profile: StoredUserProfile | null): UserProfileRepository & {
  setParentConsentStatus: ReturnType<typeof vi.fn>;
} {
  const setParentConsentStatus = vi.fn(async () => {});
  return {
    create: vi.fn(async () => {}),
    findByUserId: (userId) =>
      Promise.resolve(profile !== null && profile.userId === userId ? profile : null),
    update: vi.fn(async () => {}),
    setParentConsentStatus,
  };
}

/** 9.1: an in-memory GOD consent log; `current` is the newest append. */
function fakeGod(initial: GodConsentRecord | null = null): GodConsentRepository & {
  appended: NewGodConsent[];
} {
  const appended: NewGodConsent[] = [];
  let current = initial;
  return {
    appended,
    append: (input, now) => {
      appended.push(input);
      current = {
        userId: input.userId,
        region: input.region,
        noticeId: "god-group-notice",
        noticeVersion: "1.0",
        decision: input.decision,
        method: input.method,
        track: input.track,
        guardianUserId: input.guardianUserId ?? null,
        recordedAt: now.toISOString(),
      };
      return Promise.resolve();
    },
    current: () => Promise.resolve(current),
    history: () => Promise.resolve(current === null ? [] : [current]),
  };
}

function guardianAccepted(): GodConsentRecord {
  return {
    userId: USER_ID,
    region: "AU",
    noticeId: "god-group-notice",
    noticeVersion: "1.0",
    decision: "accepted",
    method: "guardian",
    track: "teen",
    guardianUserId: null,
    recordedAt: "2026-01-02T00:00:00.000Z",
  };
}

const FAKE_DB: AppDb = {
  transaction: async <T>(cb: (tx: AppDb) => Promise<T>): Promise<T> => cb(FAKE_DB),
  // The withdrawal's list of live app consents: none.
  execute: () => Promise.resolve({ rows: [] }),
} as unknown as AppDb;

function zeroBalance(): LedgerBalance {
  return {
    userId: USER_ID,
    availablePoints: 0 as LedgerBalance["availablePoints"],
    pending: [],
    expiringPoints: 0 as LedgerBalance["expiringPoints"],
    expiringAt: null,
  };
}

function fakeLedger(balance: LedgerBalance): {
  client: LedgerInternalClient;
  escrowCalls: EscrowRequest[];
} {
  const escrowCalls: EscrowRequest[] = [];
  const client: Partial<LedgerInternalClient> = {
    balance: () => okAsync(balance),
    escrow: (request: EscrowRequest) => {
      escrowCalls.push(request);
      const escrow: Escrow = {
        escrowId: "escrow-1",
        userId: request.userId,
        points: request.points,
        reason: request.reason,
        state: "held",
      };
      return okAsync(escrow);
    },
  };
  return { client: client as LedgerInternalClient, escrowCalls };
}

describe("getGuardianConsent", () => {
  it("returns status/displayName/region/locale, and nothing else, for a pending link", async () => {
    const consents = fakeConsents(baseRow());
    const profiles = fakeProfiles(fakeProfile());

    const result = await getGuardianConsent(consents, profiles, RAW_TOKEN, fakeGod());

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toStrictEqual({
      status: "pending",
      displayName: "Teen Tester",
      region: "AU",
      locale: "en-AU",
      // Pending decides the GOD notice on approval, so nothing is asked separately.
      godNotice: { ask: false, decision: null },
    });
  });

  it("asks the guardian of an approved teen who has no GOD decision yet, and not once decided", async () => {
    const consents = fakeConsents(baseRow({ approvedAt: new Date("2026-01-02T00:00:00Z") }));
    const profiles = fakeProfiles(fakeProfile({ parentConsentStatus: "granted" }));

    const before = await getGuardianConsent(consents, profiles, RAW_TOKEN, fakeGod());
    expect(before._unsafeUnwrap().godNotice).toStrictEqual({ ask: true, decision: null });

    const after = await getGuardianConsent(
      consents,
      profiles,
      RAW_TOKEN,
      fakeGod(guardianAccepted()),
    );
    expect(after._unsafeUnwrap().godNotice).toStrictEqual({ ask: false, decision: "accepted" });
  });

  it("refuses an unknown token with not_found", async () => {
    const consents = fakeConsents(null);
    const profiles = fakeProfiles(null);

    const result = await getGuardianConsent(consents, profiles, "some-other-token", fakeGod());

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toStrictEqual({ type: "not_found" });
  });
});

describe("approveGuardianConsent", () => {
  it("transitions pending -> granted and writes parent_consent_status", async () => {
    const consents = fakeConsents(baseRow());
    const profiles = fakeProfiles(fakeProfile());

    const god = fakeGod();

    const result = await approveGuardianConsent(
      FAKE_DB,
      consents,
      profiles,
      RAW_TOKEN,
      new Date("2026-02-01T00:00:00Z"),
      god,
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toStrictEqual({ approved: true });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- expect() reads the mock fn's calls, never invokes it as a method
    expect(profiles.setParentConsentStatus).toHaveBeenCalledWith(USER_ID, "granted", FAKE_DB);
    // 9.1.c: the guardian's GOD acceptance lands with the approval, on the teen track.
    expect(god.appended).toStrictEqual([
      { userId: USER_ID, region: "AU", decision: "accepted", method: "guardian", track: "teen" },
    ]);
  });

  it("is idempotent — a second approve of an already-granted link still succeeds", async () => {
    const consents = fakeConsents(baseRow({ approvedAt: new Date("2026-01-02T00:00:00Z") }));
    const profiles = fakeProfiles(fakeProfile({ parentConsentStatus: "granted" }));

    const result = await approveGuardianConsent(
      FAKE_DB,
      consents,
      profiles,
      RAW_TOKEN,
      new Date(),
      fakeGod(),
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toStrictEqual({ approved: true });
    // No new write — nothing changed, so nothing to persist again.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- expect() reads the mock fn's calls, never invokes it as a method
    expect(profiles.setParentConsentStatus).not.toHaveBeenCalled();
  });

  it("refuses a revoked link — revoked is final, re-approval is out of scope", async () => {
    const consents = fakeConsents(baseRow({ revokedAt: new Date("2026-01-03T00:00:00Z") }));
    const profiles = fakeProfiles(fakeProfile({ parentConsentStatus: "revoked" }));

    const result = await approveGuardianConsent(
      FAKE_DB,
      consents,
      profiles,
      RAW_TOKEN,
      new Date(),
      fakeGod(),
    );

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toStrictEqual({ type: "already_revoked" });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- expect() reads the mock fn's calls, never invokes it as a method
    expect(profiles.setParentConsentStatus).not.toHaveBeenCalled();
  });

  it("404s an unknown token", async () => {
    const consents = fakeConsents(null);
    const profiles = fakeProfiles(null);

    const result = await approveGuardianConsent(
      FAKE_DB,
      consents,
      profiles,
      RAW_TOKEN,
      new Date(),
      fakeGod(),
    );

    expect(result._unsafeUnwrapErr()).toStrictEqual({ type: "not_found" });
  });
});

describe("revokeGuardianConsent", () => {
  it("escrows the whole balance (available + pending) with a key derived from the row, then revokes", async () => {
    const consents = fakeConsents(baseRow({ approvedAt: new Date("2026-01-02T00:00:00Z") }));
    const profiles = fakeProfiles(fakeProfile({ parentConsentStatus: "granted" }));
    const balance: LedgerBalance = {
      userId: USER_ID,
      availablePoints: 40 as LedgerBalance["availablePoints"],
      pending: [
        { points: 10 as LedgerBalance["availablePoints"], unlockAt: "2026-03-01T00:00:00Z" },
      ],
      expiringPoints: 0 as LedgerBalance["expiringPoints"],
      expiringAt: null,
    };
    const { client, escrowCalls } = fakeLedger(balance);

    const result = await revokeGuardianConsent(
      FAKE_DB,
      consents,
      profiles,
      client,
      RAW_TOKEN,
      new Date("2026-02-01T00:00:00Z"),
      [],
      fakeGod(),
    );

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toStrictEqual({ revoked: true, escrowedPoints: 50 });
    expect(escrowCalls).toHaveLength(1);
    expect(escrowCalls[0]).toMatchObject({
      userId: USER_ID,
      points: 50,
      reason: "guardian_consent_revoked",
      idempotencyKey: `guardian-consent-revoke:${USER_ID}`,
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method -- expect() reads the mock fn's calls, never invokes it as a method
    expect(profiles.setParentConsentStatus).toHaveBeenCalledWith(USER_ID, "revoked", FAKE_DB);
  });

  it("skips the ledger call entirely for a zero balance", async () => {
    const consents = fakeConsents(baseRow());
    const profiles = fakeProfiles(fakeProfile());
    const { client, escrowCalls } = fakeLedger(zeroBalance());

    const result = await revokeGuardianConsent(
      FAKE_DB,
      consents,
      profiles,
      client,
      RAW_TOKEN,
      new Date(),
      [],
      fakeGod(),
    );

    expect(result._unsafeUnwrap()).toStrictEqual({ revoked: true, escrowedPoints: 0 });
    expect(escrowCalls).toHaveLength(0);
  });

  it("is idempotent — revoking an already-revoked link escrows nothing further", async () => {
    const consents = fakeConsents(baseRow({ revokedAt: new Date("2026-01-05T00:00:00Z") }));
    const profiles = fakeProfiles(fakeProfile({ parentConsentStatus: "revoked" }));
    const { client, escrowCalls } = fakeLedger({
      userId: USER_ID,
      availablePoints: 999 as LedgerBalance["availablePoints"],
      pending: [],
      expiringPoints: 0 as LedgerBalance["expiringPoints"],
      expiringAt: null,
    });

    const result = await revokeGuardianConsent(
      FAKE_DB,
      consents,
      profiles,
      client,
      RAW_TOKEN,
      new Date(),
      [],
      fakeGod(),
    );

    expect(result._unsafeUnwrap()).toStrictEqual({ revoked: true, escrowedPoints: 0 });
    expect(escrowCalls).toHaveLength(0);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- expect() reads the mock fn's calls, never invokes it as a method
    expect(profiles.setParentConsentStatus).not.toHaveBeenCalled();
  });

  it("404s an unknown token", async () => {
    const consents = fakeConsents(null);
    const profiles = fakeProfiles(null);
    const { client } = fakeLedger(zeroBalance());

    const result = await revokeGuardianConsent(
      FAKE_DB,
      consents,
      profiles,
      client,
      RAW_TOKEN,
      new Date(),
      [],
      fakeGod(),
    );

    expect(result._unsafeUnwrapErr()).toStrictEqual({ type: "not_found" });
  });
});

describe("9.1: the GOD notice on the guardian's link", () => {
  it("withdrawing approval also withdraws an accepted GOD notice", async () => {
    const consents = fakeConsents(baseRow({ approvedAt: new Date("2026-01-02T00:00:00Z") }));
    const profiles = fakeProfiles(fakeProfile({ parentConsentStatus: "granted" }));
    const { client } = fakeLedger(zeroBalance());
    const god = fakeGod(guardianAccepted());

    const result = await revokeGuardianConsent(
      FAKE_DB,
      consents,
      profiles,
      client,
      RAW_TOKEN,
      new Date(),
      [],
      god,
    );

    expect(result.isOk()).toBe(true);
    expect(god.appended).toStrictEqual([
      { userId: USER_ID, region: "AU", decision: "withdrawn", method: "guardian", track: "teen" },
    ]);
  });

  it.each(["accepted", "declined"] as const)(
    "records the guardian's %s for an approved teen",
    async (decision) => {
      const consents = fakeConsents(baseRow({ approvedAt: new Date("2026-01-02T00:00:00Z") }));
      const god = fakeGod();

      const result = await decideGuardianGodNotice(consents, god, RAW_TOKEN, decision, new Date());

      expect(result._unsafeUnwrap()).toStrictEqual({ decision });
      expect(god.appended).toStrictEqual([
        { userId: USER_ID, region: "AU", decision, method: "guardian", track: "teen" },
      ]);
    },
  );

  it("refuses a pending or revoked link, and an unknown token", async () => {
    const god = fakeGod();
    const pending = await decideGuardianGodNotice(
      fakeConsents(baseRow()),
      god,
      RAW_TOKEN,
      "accepted",
      new Date(),
    );
    expect(pending._unsafeUnwrapErr()).toStrictEqual({ type: "not_granted" });

    const revoked = await decideGuardianGodNotice(
      fakeConsents(baseRow({ revokedAt: new Date("2026-01-03T00:00:00Z") })),
      god,
      RAW_TOKEN,
      "accepted",
      new Date(),
    );
    expect(revoked._unsafeUnwrapErr()).toStrictEqual({ type: "not_granted" });

    const unknown = await decideGuardianGodNotice(
      fakeConsents(null),
      god,
      RAW_TOKEN,
      "accepted",
      new Date(),
    );
    expect(unknown._unsafeUnwrapErr()).toStrictEqual({ type: "not_found" });
    expect(god.appended).toEqual([]);
  });
});
