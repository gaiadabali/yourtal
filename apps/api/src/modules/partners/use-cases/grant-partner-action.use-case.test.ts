import { randomUUID } from "node:crypto";
import { errAsync, okAsync } from "neverthrow";
import type { ResultAsync } from "neverthrow";
import { describe, expect, it } from "vitest";
import type { LedgerError } from "@yourtal/contracts/ledger-internal/ledger-error";
import type { Grant, GrantActionRequest } from "@yourtal/contracts/ledger-internal/rewards";
import type { LedgerInternalClient } from "../../../shared/ledger-client/ledger-internal-client";
import type { ClaimedLinkCode, LinkCodeLookup } from "../persistence/link-code-lookup";
import type { AccountAgeLookup } from "../persistence/account-age-lookup";
import type {
  NewPartnerLink,
  PartnerLink,
  PartnerLinkRepository,
} from "../persistence/partner-link.repository";
import type {
  PartnerReceiptRepository,
  ReceiptClaim,
  RecordReceiptInput,
} from "../persistence/partner-receipt.repository";
import { grantPartnerAction } from "./grant-partner-action.use-case";
import { revokePartnerLink } from "./partner-link.use-case";
import type { GrantPartnerActionDeps } from "./grant-partner-action.use-case";

/** In-memory stand-ins for the four ports; the real ones are covered by partner-link.e2e.test.ts. */
class World implements LinkCodeLookup, AccountAgeLookup, PartnerLinkRepository {
  readonly codes = new Map<string, ClaimedLinkCode>();
  readonly ageBands = new Map<string, "teen" | "adult">();
  readonly links: PartnerLink[] = [];
  readonly receipts = new Map<string, string>();
  readonly grants = new Map<string, GrantActionRequest>();
  ledgerRefusal: LedgerError | null = null;
  /** F126: accounts that have not passed the identity check. */
  readonly unchecked = new Set<string>();

  claim(code: string): Promise<ClaimedLinkCode | null> {
    const found = this.codes.get(code) ?? null;
    this.codes.delete(code);
    return Promise.resolve(found);
  }

  ageBandOf(userId: string): Promise<"teen" | "adult" | null> {
    return Promise.resolve(this.ageBands.get(userId) ?? null);
  }

  linkActive(input: NewPartnerLink): Promise<PartnerLink> {
    const active = this.links.find(
      (l) => l.partnerId === input.partnerId && l.userId === input.userId && !l.revokedAt,
    );
    if (active) return Promise.resolve(active);
    const link = { ...input, id: randomUUID(), createdAt: "2026-10-20T00:00:00Z", revokedAt: null };
    this.links.push(link);
    return Promise.resolve(link);
  }

  findById(linkId: string): Promise<PartnerLink | null> {
    return Promise.resolve(this.links.find((l) => l.id === linkId) ?? null);
  }

  revokeForPartner(partnerId: string, linkId: string): Promise<PartnerLink | null> {
    const index = this.links.findIndex((l) => l.id === linkId && l.partnerId === partnerId);
    const link = this.links[index];
    if (link === undefined) return Promise.resolve(null);
    const revoked = { ...link, revokedAt: link.revokedAt ?? "2026-10-20T02:00:00Z" };
    this.links[index] = revoked;
    return Promise.resolve(revoked);
  }

  receiptRepository(): PartnerReceiptRepository {
    return {
      claim: (input: RecordReceiptInput): Promise<ReceiptClaim> => {
        const key = `${input.partnerId}:${input.receiptHash}`;
        const prior = this.receipts.get(key);
        if (prior !== undefined) return Promise.resolve({ isNew: false, userId: prior });
        this.receipts.set(key, input.userId);
        return Promise.resolve({ isNew: true, userId: input.userId });
      },
    };
  }

  /** Same replay rule as the real ledger: one grant per idempotency key. */
  grantAction(request: GrantActionRequest): ResultAsync<Grant, LedgerError> {
    if (this.ledgerRefusal) return errAsync(this.ledgerRefusal);
    const prior = this.grants.get(request.idempotencyKey) ?? request;
    this.grants.set(request.idempotencyKey, prior);
    return okAsync({
      grantId: request.idempotencyKey,
      kind: prior.kind,
      userId: prior.userId,
      region: prior.region,
      points: prior.points,
      unlockAt: "2026-10-20T00:00:00Z",
      grantedAt: "2026-10-20T00:00:00Z",
    });
  }

  deps(): GrantPartnerActionDeps {
    const ledger: Pick<LedgerInternalClient, "grantAction"> = {
      grantAction: (request) => this.grantAction(request),
    };
    return {
      ledger: ledger as LedgerInternalClient,
      receipts: this.receiptRepository(),
      linkCodes: this,
      links: this,
      ages: this,
      receiptPoints: (region) => Promise.resolve(region === "AU" ? 1 : 10),
      identityVerdict: (userId) =>
        Promise.resolve(
          this.unchecked.has(userId)
            ? { mayEarn: false, missing: ["add_passkey"] as const }
            : { mayEarn: true },
        ),
    };
  }
}

function adultWithCode(world: World, region: "AU" | "ID" = "AU") {
  const userId = randomUUID();
  const code = randomUUID();
  world.codes.set(code, { userId, region });
  world.ageBands.set(userId, "adult");
  return { userId, code };
}

const PARTNER = "snap-app";

describe("grantPartnerAction (14.3.b)", () => {
  it("links on the first call, then earns through the link id once the code is gone", async () => {
    const world = new World();
    const { code } = adultWithCode(world);

    const first = await grantPartnerAction(world.deps(), {
      partnerId: PARTNER,
      linkCode: code,
      externalRef: "r1",
    });
    const { linkId } = first._unsafeUnwrap();
    expect(first._unsafeUnwrap()).toEqual({ granted: true, points: 1, linkId, duplicate: false });

    const reused = await grantPartnerAction(world.deps(), {
      partnerId: PARTNER,
      linkCode: code,
      externalRef: "r2",
    });
    expect(reused._unsafeUnwrapErr()).toMatchObject({ type: "invalid_link_code" });

    const later = await grantPartnerAction(world.deps(), {
      partnerId: PARTNER,
      linkId,
      externalRef: "r2",
    });
    expect(later._unsafeUnwrap()).toEqual({ granted: true, points: 1, linkId, duplicate: false });
  });

  it("refuses a teen's code without creating a link", async () => {
    const world = new World();
    const { userId, code } = adultWithCode(world);
    world.ageBands.set(userId, "teen");
    const result = await grantPartnerAction(world.deps(), {
      partnerId: PARTNER,
      linkCode: code,
      externalRef: "r1",
    });
    expect(result._unsafeUnwrapErr()).toMatchObject({ type: "teen_not_allowed" });
    expect(world.links).toEqual([]);
  });

  it("refuses unknown, other-partner and revoked links, and pays nothing", async () => {
    const world = new World();
    const { code } = adultWithCode(world);
    const linkId = (
      await grantPartnerAction(world.deps(), {
        partnerId: PARTNER,
        linkCode: code,
        externalRef: "a",
      })
    )._unsafeUnwrap().linkId;
    const paid = world.grants.size;

    const call = (partnerId: string, id: string) =>
      grantPartnerAction(world.deps(), { partnerId, linkId: id, externalRef: randomUUID() });
    expect((await call(PARTNER, randomUUID()))._unsafeUnwrapErr()).toMatchObject({
      type: "unknown_link",
    });
    expect((await call("other-partner", linkId))._unsafeUnwrapErr()).toMatchObject({
      type: "unknown_link",
    });
    const link = world.links[0];
    if (link === undefined) throw new Error("expected a link");
    world.links[0] = { ...link, revokedAt: "2026-10-20T01:00:00Z" };
    expect((await call(PARTNER, linkId))._unsafeUnwrapErr()).toMatchObject({
      type: "link_revoked",
    });
    expect(world.grants.size).toBe(paid);
  });

  it("answers a duplicate receipt with success and no second payout", async () => {
    const world = new World();
    const a = adultWithCode(world, "ID");
    const b = adultWithCode(world);
    const deps = world.deps();
    const linkA = (
      await grantPartnerAction(deps, { partnerId: PARTNER, linkCode: a.code, externalRef: "x" })
    )._unsafeUnwrap().linkId;
    const linkB = (
      await grantPartnerAction(deps, { partnerId: PARTNER, linkCode: b.code, externalRef: "y" })
    )._unsafeUnwrap().linkId;

    const again = await grantPartnerAction(deps, {
      partnerId: PARTNER,
      linkId: linkA,
      externalRef: "x",
    });
    expect(again._unsafeUnwrap()).toEqual({
      granted: true,
      points: 10,
      linkId: linkA,
      duplicate: true,
    });

    const otherAccount = await grantPartnerAction(deps, {
      partnerId: PARTNER,
      linkId: linkB,
      externalRef: "x",
    });
    expect(otherAccount._unsafeUnwrap()).toEqual({
      granted: false,
      points: 0,
      linkId: linkB,
      duplicate: true,
    });
    expect(world.grants.size).toBe(2);
  });

  it("names the link on a ledger refusal after the code was spent", async () => {
    const world = new World();
    const { code } = adultWithCode(world);
    world.ledgerRefusal = { code: "insufficient_available", message: "unfunded" };
    const result = await grantPartnerAction(world.deps(), {
      partnerId: PARTNER,
      linkCode: code,
      externalRef: "r1",
    });
    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: "insufficient_available",
      linkId: world.links[0]?.id,
    });
  });

  it("refuses a link whose account was deleted, before any revoke has run", async () => {
    const world = new World();
    const { userId, code } = adultWithCode(world);
    const deps = world.deps();
    const { linkId } = (
      await grantPartnerAction(deps, { partnerId: PARTNER, linkCode: code, externalRef: "a" })
    )._unsafeUnwrap();
    world.ageBands.delete(userId);

    const after = await grantPartnerAction(deps, { partnerId: PARTNER, linkId, externalRef: "b" });
    expect(after._unsafeUnwrapErr()).toMatchObject({ type: "link_revoked" });
    expect(world.grants.size).toBe(1);
  });
});

describe("revokePartnerLink", () => {
  it("revokes only the partner's own link, and answers a second revoke the same way", async () => {
    const world = new World();
    const { code } = adultWithCode(world);
    const { linkId } = (
      await grantPartnerAction(world.deps(), {
        partnerId: PARTNER,
        linkCode: code,
        externalRef: "a",
      })
    )._unsafeUnwrap();

    const foreign = await revokePartnerLink(world, { partnerId: "other-partner", linkId });
    expect(foreign._unsafeUnwrapErr()).toMatchObject({ type: "unknown_link" });
    expect(world.links[0]?.revokedAt).toBeNull();

    const first = (await revokePartnerLink(world, { partnerId: PARTNER, linkId }))._unsafeUnwrap();
    const second = (await revokePartnerLink(world, { partnerId: PARTNER, linkId }))._unsafeUnwrap();
    expect(first).toEqual({ linkId, revokedAt: expect.any(String) as string });
    expect(second).toEqual(first);

    const refused = await grantPartnerAction(world.deps(), {
      partnerId: PARTNER,
      linkId,
      externalRef: "b",
    });
    expect(refused._unsafeUnwrapErr()).toMatchObject({ type: "link_revoked" });
  });
});

describe("grantPartnerAction: the identity check (F126)", () => {
  it("refuses an account without the check with a stable code, records nothing and pays nothing", async () => {
    const world = new World();
    const { userId, code } = adultWithCode(world);
    world.unchecked.add(userId);

    const refused = await grantPartnerAction(world.deps(), {
      partnerId: PARTNER,
      linkCode: code,
      externalRef: "r1",
    });
    const error = refused._unsafeUnwrapErr();
    expect(error).toMatchObject({ type: "identity_check_required" });
    // The code is spent, so the partner is told the link to use next time.
    expect(error.linkId).toBe(world.links[0]?.id);
    expect(world.receipts.size).toBe(0);
    expect(world.grants.size).toBe(0);

    // Once the person passes the check, the same receipt earns once.
    world.unchecked.delete(userId);
    const paid = await grantPartnerAction(world.deps(), {
      partnerId: PARTNER,
      linkId: error.linkId ?? "",
      externalRef: "r1",
    });
    expect(paid._unsafeUnwrap()).toMatchObject({ granted: true, points: 1, duplicate: false });
    expect(world.grants.size).toBe(1);
  });
});
